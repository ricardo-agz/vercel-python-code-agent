import json
import time
from typing import Any

from src.auth import make_stream_token


SSE_HEADERS: dict[str, str] = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def sse_format(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event)}\n\n"


def emit_event(
    task_id: str, event_type: str, data: Any = None, error: Any = None
) -> dict[str, Any]:
    return {
        "event_type": event_type,
        "task_id": task_id,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        "data": data,
        "error": error,
    }


def tool_started_sse(task_id: str, ev: dict[str, Any]) -> str:
    return sse_format(
        emit_event(
            task_id,
            "progress_update_tool_action_started",
            data={
                "args": [
                    {
                        "id": ev["tool_id"],
                        "function": {
                            "name": ev["name"],
                            "arguments": ev.get("arguments"),
                        },
                    }
                ]
            },
        )
    )


def tool_completed_sse(
    task_id: str,
    ev: dict[str, Any],
    base_payload: dict[str, Any],
    project: dict[str, str],
) -> str:
    output_data: Any = ev.get("output_data")
    if ev.get("name") == "request_code_execution" and isinstance(output_data, dict):
        token_payload = {
            "user_id": base_payload["user_id"],
            "message_history": base_payload.get("message_history", []),
            "query": base_payload["query"],
            "project": project,
            # Preserve model selection for resume flows if present
            **(
                {"model": base_payload.get("model")}
                if base_payload.get("model")
                else {}
            ),
        }
        output_data = {**output_data, "resume_token": make_stream_token(token_payload)}

    return sse_format(
        emit_event(
            task_id,
            "progress_update_tool_action_completed",
            data={
                "result": {
                    "tool_call": {
                        "id": ev["tool_id"],
                        "function": {
                            "name": ev["name"],
                            "arguments": ev.get("arguments"),
                        },
                    },
                    "output_data": output_data,
                }
            },
        )
    )
