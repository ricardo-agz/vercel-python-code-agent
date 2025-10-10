import os
import asyncio
import logging
import traceback
from typing import Any, AsyncGenerator
from agents import Agent, Runner

from src.agent.tools import (
    think,
    edit_code,
    create_file,
    delete_file,
    rename_file,
    create_folder,
    delete_folder,
    rename_folder,
    request_code_execution,
    sandbox_create,
    sandbox_stop,
    sandbox_run,
    sandbox_set_env,
    sandbox_show_preview,
)
from src.agent.context import IDEContext
from src.sse import (
    sse_format,
    emit_event,
    tool_started_sse,
    tool_completed_sse,
)
from src.agent.utils import build_project_input, make_ignore_predicate


logger = logging.getLogger("ide_agent.agent")


ALLOWED_TURNS = 50
SLEEP_INTERVAL_SECONDS = 0.05


with open(os.path.join(os.path.dirname(__file__), "_prompt.md"), "r") as f:
    instructions = f.read()


def create_ide_agent(model: str | None = None) -> Agent:
    """Factory to construct the IDE Agent with an optional model override.

    If model is provided, attempt to set it on the Agent. If the underlying
    Agent class does not accept a model parameter, gracefully ignore it.
    """
    base_kwargs = {
        "name": "IDE Agent",
        "instructions": instructions,
        "tools": [
            # think,
            edit_code,
            create_file,
            delete_file,
            rename_file,
            create_folder,
            delete_folder,
            rename_folder,
            request_code_execution,
            # Sandbox controls
            sandbox_create,
            sandbox_stop,
            sandbox_run,
            sandbox_set_env,
            sandbox_show_preview,
        ],
    }
    if model:
        try:
            formatted_model = f"litellm/vercel_ai_gateway/{model}"
            return Agent(**base_kwargs, model=formatted_model)
        except TypeError:
            return Agent(**base_kwargs)
    return Agent(**base_kwargs)


# Default agent used when no model is specified
ide_agent = create_ide_agent()


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

    # Filter project using ignore patterns from .agentignore/.gitignore and defaults
    original_project = payload.get("project", {}) or {}
    is_ignored = make_ignore_predicate(original_project)
    filtered_project = {
        p: c
        for p, c in original_project.items()
        if (not is_ignored(p)) or (p in {".gitignore", ".agentignore"})
    }

    base_payload = {
        "user_id": payload["user_id"],
        "query": payload["query"],
        "project": filtered_project,
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
        payload["query"], filtered_project, history or assistant_only
    )

    context = IDEContext(project=filtered_project, base_payload=base_payload)

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
                elif ev.get("phase") == "log":
                    yield sse_format(
                        emit_event(
                            task_id,
                            "progress_update_tool_action_log",
                            data={
                                "id": ev.get("tool_id"),
                                "name": ev.get("name"),
                                "data": ev.get("data"),
                            },
                        )
                    )
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
        elif ev.get("phase") == "log":
            yield sse_format(
                emit_event(
                    task_id,
                    "progress_update_tool_action_log",
                    data={
                        "id": ev.get("tool_id"),
                        "name": ev.get("name"),
                        "data": ev.get("data"),
                    },
                )
            )

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


async def resume_agent_flow(
    base: dict[str, Any], task_id: str, exec_result: str
) -> AsyncGenerator[str, None]:
    """Resume the agent run after code execution and stream SSE chunks.

    Reconstructs the agent context with the provided execution result, runs the
    agent, emits tool events, and finally yields the agent's final output (or an
    error event if none was produced).
    """
    try:
        logger.info(
            "resume[%s] model=%s files=%d history=%d",
            task_id,
            base.get("model"),
            len(base.get("project", {})),
            len(base.get("message_history", [])),
        )
    except Exception:
        pass

    # Filter project on resume as well (the resume token may carry previous project)
    original_project = base.get("project", {}) or {}
    is_ignored = make_ignore_predicate(original_project)
    filtered_project = {
        p: c
        for p, c in original_project.items()
        if (not is_ignored(p)) or (p in {".gitignore", ".agentignore"})
    }

    base_payload = {
        "user_id": base["user_id"],
        "query": base["query"],
        "project": filtered_project,
        "message_history": base.get("message_history", []),
        "model": base.get("model"),
    }

    # Truncate very large execution logs to keep prompts under token limits
    trimmed_result = exec_result or ""
    if len(trimmed_result) > 100_000:
        trimmed_result = trimmed_result[-100_000:]

    context = IDEContext(
        project=filtered_project,
        base_payload=base_payload,
        exec_result=trimmed_result,
    )

    history = base.get("message_history", [])
    assistant_only = [
        m["content"] for m in history if m.get("role") == "assistant" and m.get("content")
    ]
    input_text = build_project_input(base["query"], filtered_project, history or assistant_only)

    selected_model = base.get("model")
    agent_instance = create_ide_agent(selected_model) if selected_model else ide_agent

    try:
        run_result = await Runner.run(
            agent_instance,
            input=input_text,
            context=context,
            max_turns=ALLOWED_TURNS,
        )

        for ev in context.events:
            if ev.get("phase") == "started":
                yield tool_started_sse(task_id, ev)
            elif ev.get("phase") == "completed":
                yield tool_completed_sse(task_id, ev, base_payload, context.project)
            elif ev.get("phase") == "log":
                yield sse_format(
                    emit_event(
                        task_id,
                        "progress_update_tool_action_log",
                        data={
                            "id": ev.get("tool_id"),
                            "name": ev.get("name"),
                            "data": ev.get("data"),
                        },
                    )
                )
            elif ev.get("phase") == "log":
                yield sse_format(
                    emit_event(task_id, "run_log", data=str(ev.get("data", "")))
                )

        if run_result.final_output:
            yield sse_format(
                emit_event(task_id, "agent_output", data=str(run_result.final_output))
            )
        else:
            yield sse_format(
                emit_event(task_id, "run_failed", error="No output produced.")
            )
    except Exception as e:
        yield sse_format(emit_event(task_id, "run_failed", error=str(e)))
