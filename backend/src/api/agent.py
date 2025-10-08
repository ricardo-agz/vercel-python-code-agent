import asyncio
import logging
import time
import traceback
import uuid
from typing import Any, AsyncGenerator

from pydantic import BaseModel
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from agents import Runner
from src.agent import build_project_input, ide_agent, IDEContext, create_ide_agent
from src.auth import make_stream_token, read_stream_token
from src.sse import (
    SSE_HEADERS,
    sse_format,
    emit_event,
    tool_started_sse,
    tool_completed_sse,
)
from src.api.auth import require_vercel_user


logger = logging.getLogger("ide_agent.api.runs")


router = APIRouter(
    prefix="/api/runs", tags=["runs"], dependencies=[Depends(require_vercel_user)]
)


ALLOWED_TURNS = 30
SLEEP_INTERVAL_SECONDS = 0.05


class RunRequest(BaseModel):
    """Payload to start a new agent run and get an SSE resume token."""

    user_id: str
    message_history: list[dict[str, str]]
    query: str
    project: dict[str, str]
    model: str | None = None


def make_task_id() -> str:
    return f"task_{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}"


async def run_agent_flow(
    payload: dict[str, Any], task_id: str
) -> AsyncGenerator[str, None]:
    """Run the agent and stream tool progress as SSE chunks."""
    try:
        logger.info(
            "run[%s] start model=%s project_files=%d history=%d",
            task_id,
            payload.get("model"),
            len(payload.get("project", {})),
            len(payload.get("message_history", [])),
        )
    except Exception:
        pass

    base_payload = {
        "user_id": payload["user_id"],
        "query": payload["query"],
        "project": payload["project"],
        "message_history": payload.get("message_history", []),
        "model": payload.get("model"),
    }

    history = payload.get("message_history", [])
    assistant_only = [
        m["content"]
        for m in history
        if m.get("role") == "assistant" and m.get("content")
    ]
    input_text = build_project_input(
        payload["query"], payload["project"], history or assistant_only
    )

    context = IDEContext(project=payload["project"], base_payload=base_payload)

    selected_model = payload.get("model")
    agent_instance = create_ide_agent(selected_model) if selected_model else ide_agent

    run_task = asyncio.create_task(
        Runner.run(
            agent_instance,
            input=input_text,
            context=context,
            max_turns=ALLOWED_TURNS,
        )
    )
    yield sse_format(emit_event(task_id, "run_log", data="Agent run scheduled"))

    last_idx = 0
    result = None
    try:
        while not run_task.done():
            while last_idx < len(context.events):
                ev = context.events[last_idx]
                last_idx += 1
                if ev.get("phase") == "started":
                    yield tool_started_sse(task_id, ev)
                elif ev.get("phase") == "completed":
                    yield tool_completed_sse(task_id, ev, base_payload, context.project)
            await asyncio.sleep(SLEEP_INTERVAL_SECONDS)

        result = await run_task
    except Exception as e:
        logger.error("run[%s] error: %s", task_id, str(e))
        tb = traceback.format_exc(limit=10)
        yield sse_format(
            emit_event(task_id, "run_log", data=f"Exception: {str(e)}\n{tb}")
        )
        yield sse_format(emit_event(task_id, "run_failed", error=str(e)))
        return

    while last_idx < len(context.events):
        ev = context.events[last_idx]
        last_idx += 1
        if ev.get("phase") == "started":
            yield tool_started_sse(task_id, ev)
        elif ev.get("phase") == "completed":
            yield tool_completed_sse(task_id, ev, base_payload, context.project)

    if context.defer_requested:
        return

    if result and result.final_output:
        yield sse_format(
            emit_event(task_id, "agent_output", data=str(result.final_output))
        )
    else:
        logger.warning("run[%s] completed with no output", task_id)
        yield sse_format(
            emit_event(task_id, "run_log", data="No final_output produced")
        )
        yield sse_format(emit_event(task_id, "run_failed", error="No output produced."))


@router.post("")
async def create_run(request: RunRequest) -> dict[str, Any]:
    task_id = make_task_id()
    try:
        logger.info(
            "create_run[%s] model=%s query_len=%d files=%d",
            task_id,
            request.model,
            len(request.query or ""),
            len(request.project or {}),
        )
    except Exception:
        pass

    stream_token = make_stream_token(
        {
            "user_id": request.user_id,
            "message_history": request.message_history,
            "query": request.query,
            "project": request.project,
            "model": request.model,
        }
    )
    return {"task_id": task_id, "stream_token": stream_token}


@router.get("/{run_id}/events")
async def run_events(run_id: str, token: str):
    payload = read_stream_token(token)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            async for chunk in run_agent_flow(payload, run_id):
                yield chunk
        except Exception as e:
            logger.error("run_events[%s] error: %s", run_id, str(e))
            tb = traceback.format_exc(limit=10)
            yield sse_format(
                emit_event(run_id, "run_log", data=f"stream exception: {str(e)}\n{tb}")
            )
            yield sse_format(emit_event(run_id, "run_failed", error=str(e)))

    return StreamingResponse(event_generator(), headers=SSE_HEADERS)


@router.get("/{run_id}/resume")
async def resume_run(run_id: str, token: str, result: str):
    base = read_stream_token(token)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            base_payload = {
                "user_id": base["user_id"],
                "query": base["query"],
                "project": base["project"],
                "message_history": base.get("message_history", []),
                "model": base.get("model"),
            }
            context = IDEContext(
                project=base.get("project", {}),
                base_payload=base_payload,
                exec_result=result,
            )
            history = base.get("message_history", [])
            assistant_only = [
                m["content"]
                for m in history
                if m.get("role") == "assistant" and m.get("content")
            ]
            input_text = build_project_input(
                base["query"], base["project"], history or assistant_only
            )
            selected_model = base.get("model")
            agent_instance = (
                create_ide_agent(selected_model) if selected_model else ide_agent
            )
            run_result = await Runner.run(
                agent_instance,
                input=input_text,
                context=context,
                max_turns=ALLOWED_TURNS,
            )

            for ev in context.events:
                if ev.get("phase") == "started":
                    yield tool_started_sse(run_id, ev)
                elif ev.get("phase") == "completed":
                    yield tool_completed_sse(run_id, ev, base_payload, context.project)

            if run_result.final_output:
                yield sse_format(
                    emit_event(
                        run_id, "agent_output", data=str(run_result.final_output)
                    )
                )
            else:
                yield sse_format(
                    emit_event(run_id, "run_failed", error="No output produced.")
                )
        except Exception as e:
            yield sse_format(emit_event(run_id, "run_failed", error=str(e)))

    return StreamingResponse(event_generator(), headers=SSE_HEADERS)
