import os
import json
import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from openai import AsyncOpenAI

from src.agent import display_code_with_line_numbers, _perform_edit_code
from src.api.auth import require_vercel_user


client = AsyncOpenAI(
    api_key=os.getenv("AI_GATEWAY_API_KEY") or os.getenv("VERCEL_OIDC_TOKEN") or os.getenv("OPENAI_API_KEY"), 
    base_url=os.getenv("AI_GATEWAY_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "https://ai-gateway.vercel.sh/v1"
)


logger = logging.getLogger("ide_agent.api.inline_fix")

router = APIRouter(
    prefix="/api/inline-fix", tags=["inline-fix"], dependencies=[Depends(require_vercel_user)]
)


class InlineFixRequest(BaseModel):
    user_id: str
    project: Dict[str, str]
    file_path: str
    start_line: int = Field(..., ge=1)
    end_line: int = Field(..., ge=1)
    instruction: str
    selected_code: str = ""
    model: str | None = None


class InlineFixResponse(BaseModel):
    ok: bool
    file_path: str | None = None
    new_file_content: str | None = None
    details: Dict[str, Any] | None = None
    error: str | None = None


def _build_messages(req: InlineFixRequest) -> list[dict[str, str]]:
    code = req.project.get(req.file_path, "")
    context = (
        f"You are an inline code editor. Apply a precise edit to the file within the given line range.\n"
        f"File: {req.file_path}\n"
        f"Allowed edit range: lines {req.start_line}-{req.end_line}\n"
        "Rules: only operate within the range; keep surrounding code unchanged; preserve formatting and indentation.\n"
        "Call the edit_code tool with: find (exact current text in the range), find_start_line, find_end_line, replace (new text).\n"
        "Use the smallest necessary range.\n"
    )
    file_block = display_code_with_line_numbers(code)
    selection_hint = (
        f"\nSelected text (for reference):\n{req.selected_code}\n" if req.selected_code else ""
    )
    return [
        {"role": "system", "content": context},
        {
            "role": "user",
            "content": (
                f"Instruction: {req.instruction}\n\n"
                f"File contents with line numbers:\n{file_block}{selection_hint}"
            ),
        },
    ]


@router.post("")
async def inline_fix(req: InlineFixRequest) -> InlineFixResponse:
    if req.file_path not in req.project:
        return InlineFixResponse(ok=False, error=f"File not found: {req.file_path}")

    model = req.model or os.getenv("DEFAULT_MODEL") or "anthropic/claude-sonnet-4.5"
    messages = _build_messages(req)
    tools = [
        {
            "type": "function",
            "function": {
                "name": "edit_code",
                "description": "Replace exact text within [find_start_line, find_end_line] of the current file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "find": {"type": "string", "description": "Exact existing text to replace within the range"},
                        "find_start_line": {"type": "integer", "minimum": 1},
                        "find_end_line": {"type": "integer", "minimum": 1},
                        "replace": {"type": "string", "description": "Replacement text (no line numbers)"},
                    },
                    "required": ["find", "find_start_line", "find_end_line", "replace"],
                },
            },
        }
    ]

    try:
        completion = await client.chat.completions.create(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice="required",
        )
        choice = completion.choices[0]
        msg = getattr(choice, "message", None)
        tool_calls = getattr(msg, "tool_calls", None) if msg else None
        if not tool_calls:
            return InlineFixResponse(
                ok=False,
                error="Model did not provide an edit_code tool call.",
                details={"raw": completion.model_dump_json() if hasattr(completion, "model_dump_json") else str(completion)},
            )

        call = tool_calls[0]
        args_str = getattr(call.function, "arguments", "{}")
        try:
            args = json.loads(args_str)
        except Exception:
            args = {}

        # Ensure bounds use request's range by default
        args.setdefault("find_start_line", int(req.start_line))
        args.setdefault("find_end_line", int(req.end_line))
        if "find" not in args and req.selected_code:
            args["find"] = req.selected_code

        file_content = req.project[req.file_path]
        result = _perform_edit_code(file_content, args)
        if "new_code" not in result:
            return InlineFixResponse(ok=False, error=result.get("error") or "Invalid edit request", details=result)  # type: ignore[arg-type]

        new_content = result["new_code"]
        return InlineFixResponse(
            ok=True,
            file_path=req.file_path,
            new_file_content=new_content,
            details={k: v for k, v in result.items() if k != "new_code"},
        )
    except Exception as e:
        logger.exception("inline_fix failed")
        return InlineFixResponse(ok=False, error=str(e))


