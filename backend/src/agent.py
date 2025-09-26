import os
import logging
import json
from typing import Any
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from openai import AsyncOpenAI
from agents import (
    Agent,
    function_tool,
    RunContextWrapper,
    set_default_openai_client,
    set_default_openai_api,
    set_tracing_disabled,
)

current_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.dirname(current_dir)
# Load env from backend/.env first, then fallback to src/.env without overriding
load_dotenv(os.path.join(root_dir, ".env"), override=False)
load_dotenv(os.path.join(current_dir, ".env"), override=False)


"""OpenAI-only configuration (Gateway or OpenAI API).

We support either:
- AI Gateway: provide AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.
- OpenAI: provide OPENAI_API_KEY (and optionally OPENAI_BASE_URL).
"""

logger = logging.getLogger("ide_agent.agent")

api_key = os.getenv("AI_GATEWAY_API_KEY") or os.getenv("VERCEL_OIDC_TOKEN")
# base_url = "https://ai-gateway.vercel.sh/v1"
base_url = "http://localhost:3004/v1"
if not api_key:
    raise ValueError("AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN is not set")

client = AsyncOpenAI(api_key=api_key, base_url=base_url)
set_default_openai_client(client=client, use_for_tracing=False)
set_default_openai_api("chat_completions")
set_tracing_disabled(disabled=True)


instructions = """
You are an IDE assistant that helps with coding tasks over an entire project (multiple files).
Always start with a brief plan for anything non-trivial.

You will be given a project file tree and a query. The project is presented as a list of files
with their full paths and contents, each file rendered with line numbers for easy reference.

Your job is to either respond to the query with an answer, or use the available tools to propose
edits to a specific file. When editing, you MUST specify which file you are editing via `file_path`,
and you MUST target a concrete range of lines and provide the replacement text. Do not include line
numbers in the replacement text itself.

You can also create new files when needed. Use the `create_file` tool with a `file_path` and the
full initial contents of the file. Prefer small, focused files and idiomatic structure.

When code is shown to you as:
[1]def hello_world():
[2]    print("Hello, world!")

This means the code is actually:
def hello_world():
    print("Hello, world!")

In your final response, clearly and concisely explain what you did without writing any code snippets.
The UI will show diffs to the user.
\n
Available tools for project changes:
- create_file(file_path, content): create or overwrite a file.
- edit_code(file_path, find, find_start_line, find_end_line, replace): scoped edit in an existing file.
- delete_file(file_path): remove a file from the project.
- rename_file(old_path, new_path): move or rename a single file.
- create_folder(folder_path): declare a folder (UI-only; no files created).
- delete_folder(folder_path): remove a folder and its files.
- rename_folder(old_path, new_path): move/rename a folder and its files.
"""


def display_code_with_line_numbers(code: str) -> str:
    return "\n".join([f"[{i + 1}]{line}" for i, line in enumerate(code.split("\n"))])


def build_project_input(
    query: str, project: dict[str, str], prior_assistant_messages: list[Any] | None = None
) -> str:
    """Render a multi-file project into a single prompt-friendly string.

    The format lists all file paths first, then prints each file's contents with line numbers.
    """
    prior_block = ""
    if prior_assistant_messages:
        # Accept either list[str] (legacy assistant-only) or list[dict{role,content}] (full dialogue)
        if isinstance(prior_assistant_messages[0] if len(prior_assistant_messages) > 0 else None, dict):
            lines: list[str] = []
            for m in prior_assistant_messages:  # type: ignore[assignment]
                role = str(m.get("role", ""))
                content = str(m.get("content", ""))
                if not content:
                    continue
                lines.append(f"- {role}: {content}")
            if lines:
                prior_block = (
                    "\n---\nPrevious conversation (for context):\n" + "\n".join(lines) + "\n"
                )
        else:
            joined = "\n\n".join([f"- {m}" for m in prior_assistant_messages])
            prior_block = (
                f"\n---\nPrevious assistant answers (for context only):\n{joined}\n"
            )

    file_list = "\n".join(sorted(project.keys()))
    files_rendered: list[str] = []
    for path in sorted(project.keys()):
        content = project[path]
        files_rendered.append(
            f"FILE: {path}\n{display_code_with_line_numbers(content)}"
        )

    return (
        "Project files (paths):\n"
        f"{file_list}\n---\n"
        "Project contents (with line numbers):\n"
        f"\n\n".join(files_rendered)
        + "\n---\n"
        + f"Query: {query}{prior_block}"
        + "\n---\nGuidance: When proposing edits, call the edit tool with the target file_path, the line range, and your replacement text."
    )


class IDEContext(BaseModel):
    """State container for an IDE agent run.

    Attributes:
        project: Mapping of file paths to file contents.
        exec_result: Optional code execution result returned by the UI.
        events: Structured tool events accumulated during a run.
        defer_requested: True if the agent requested code execution and paused.
        base_payload: Original request payload fields used for resume tokens.
    """

    project: dict[str, str]
    exec_result: str | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)
    defer_requested: bool = False
    base_payload: dict[str, Any] = Field(default_factory=dict)


def _perform_edit_code(file_content: str, args: dict[str, Any]) -> dict[str, Any]:
    lines = file_content.split("\n")
    start_idx = int(args["find_start_line"]) - 1
    end_idx = int(args["find_end_line"]) - 1
    if start_idx < 0 or end_idx >= len(lines) or start_idx > end_idx:
        return {
            "error": "Line numbers out of range or invalid",
            "total_lines": len(lines),
        }
    existing_text = "\n".join(lines[start_idx : end_idx + 1])
    if str(args["find"]) not in existing_text:
        return {
            "error": "Find text not found at specified lines",
            "existing_text": existing_text,
        }
    new_text = existing_text.replace(str(args["find"]), str(args["replace"]))
    new_lines = lines[:start_idx] + new_text.split("\n") + lines[end_idx + 1 :]
    new_code = "\n".join(new_lines)
    return {
        "find": str(args["find"]),
        "find_start_line": int(args["find_start_line"]),
        "find_end_line": int(args["find_end_line"]),
        "replace": str(args["replace"]),
        "old_text": existing_text,
        "new_text": new_text,
        "new_code": new_code,
    }


@function_tool
async def think(ctx: RunContextWrapper[IDEContext], thoughts: str) -> str:
    """Think deeply about the task and plan next steps.

    Args:
        thoughts: The plan or reasoning the assistant wants to record.
    """
    tool_id = f"tc_{len(ctx.context.events)+1}"
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "think",
            "arguments": {"thoughts": thoughts},
        }
    )
    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "think",
            "output_data": thoughts,
        }
    )
    return thoughts


@function_tool
async def edit_code(
    ctx: RunContextWrapper[IDEContext],
    file_path: str,
    find: str,
    find_start_line: int,
    find_end_line: int,
    replace: str,
) -> str:
    """Edit a specific file between the specified line numbers, replacing occurrences of 'find' with 'replace'.

    Args:
        file_path: The path of the file to edit within the project
        find: The text to find and replace
        find_start_line: The start line number where the 'find' text is located (1-based)
        find_end_line: The end line number where the 'find' text is located (1-based)
        replace: The text to replace 'find' with
    """
    tool_id = f"tc_{len(ctx.context.events)+1}"
    args = {
        "file_path": file_path,
        "find": find,
        "find_start_line": find_start_line,
        "find_end_line": find_end_line,
        "replace": replace,
    }
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "edit_code",
            "arguments": args,
        }
    )
    if file_path not in ctx.context.project:
        output = {"error": f"File not found: {file_path}"}
    else:
        output = _perform_edit_code(ctx.context.project[file_path], args)
        if "new_code" in output:
            ctx.context.project[file_path] = output["new_code"]
            # enrich output with file info for the UI
            output = {
                **output,
                "file_path": file_path,
                "new_file_content": output["new_code"],
            }
    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "edit_code",
            "output_data": output,
        }
    )
    return json.dumps(output)


@function_tool
async def request_code_execution(
    ctx: RunContextWrapper[IDEContext], response_on_reject: str
) -> str:
    """Request the UI to execute the current code and provide the output.

    Args:
        response_on_reject: Message the agent should send if the user rejects executing code.
    """
    tool_id = f"tc_{len(ctx.context.events)+1}"
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "request_code_execution",
            "arguments": {"response_on_reject": response_on_reject},
        }
    )

    if ctx.context.exec_result is not None:
        output_data = {"result": ctx.context.exec_result}
        ctx.context.events.append(
            {
                "phase": "completed",
                "tool_id": tool_id,
                "name": "request_code_execution",
                "output_data": output_data,
            }
        )
        return ctx.context.exec_result

    # defer and let the server generate a resume token
    ctx.context.defer_requested = True
    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "request_code_execution",
            "output_data": {"response_on_reject": response_on_reject},
        }
    )
    return "EXECUTION_REQUESTED"


@function_tool
async def create_file(
    ctx: RunContextWrapper[IDEContext], file_path: str, content: str
) -> str:
    """Create a new file in the project.

    Args:
        file_path: The path of the file to create
        content: The full content of the new file
    """
    tool_id = f"tc_{len(ctx.context.events)+1}"
    args = {"file_path": file_path, "content": content}
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "create_file",
            "arguments": args,
        }
    )

    if file_path in ctx.context.project:
        output = {"error": f"File already exists: {file_path}", "file_path": file_path}
    else:
        ctx.context.project[file_path] = str(content)
        output = {
            "file_path": file_path,
            "new_file_content": str(content),
            "created": True,
        }

    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "create_file",
            "output_data": output,
        }
    )
    return json.dumps(output)


# -------------------------
# File/folder FS operations
# -------------------------

@function_tool
async def delete_file(
    ctx: RunContextWrapper[IDEContext], file_path: str
) -> str:
    """Delete a file from the project if it exists."""
    tool_id = f"tc_{len(ctx.context.events)+1}"
    args = {"file_path": file_path}
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "delete_file",
            "arguments": args,
        }
    )

    if file_path not in ctx.context.project:
        output = {"error": f"File not found: {file_path}", "file_path": file_path}
    else:
        # delete the file
        del ctx.context.project[file_path]
        output = {"file_path": file_path, "deleted": True}

    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "delete_file",
            "output_data": output,
        }
    )
    return json.dumps(output)


@function_tool
async def rename_file(
    ctx: RunContextWrapper[IDEContext], old_path: str, new_path: str
) -> str:
    """Rename or move a file from old_path to new_path."""
    tool_id = f"tc_{len(ctx.context.events)+1}"
    args = {"old_path": old_path, "new_path": new_path}
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "rename_file",
            "arguments": args,
        }
    )

    if old_path not in ctx.context.project:
        output = {"error": f"File not found: {old_path}", "old_path": old_path, "new_path": new_path}
    else:
        content = ctx.context.project[old_path]
        overwritten = new_path in ctx.context.project
        if overwritten:
            # Overwrite destination
            ctx.context.project[new_path] = content
        else:
            ctx.context.project[new_path] = content
        del ctx.context.project[old_path]
        output = {
            "old_path": old_path,
            "new_path": new_path,
            "renamed": True,
            **({"overwritten": True} if overwritten else {}),
        }

    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "rename_file",
            "output_data": output,
        }
    )
    return json.dumps(output)


@function_tool
async def create_folder(
    ctx: RunContextWrapper[IDEContext], folder_path: str
) -> str:
    """Declare a new folder in the virtual project (no file creation)."""
    tool_id = f"tc_{len(ctx.context.events)+1}"
    args = {"folder_path": folder_path}
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "create_folder",
            "arguments": args,
        }
    )

    # Folders are not tracked in project mapping; just emit event for UI
    # But validate that it does not conflict with existing file
    conflict = folder_path in ctx.context.project
    if conflict:
        output = {"error": f"Conflicts with existing file: {folder_path}", "folder_path": folder_path}
    else:
        output = {"folder_path": folder_path, "created": True}

    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "create_folder",
            "output_data": output,
        }
    )
    return json.dumps(output)


@function_tool
async def delete_folder(
    ctx: RunContextWrapper[IDEContext], folder_path: str
) -> str:
    """Delete a folder and any files within it from the project mapping."""
    tool_id = f"tc_{len(ctx.context.events)+1}"
    args = {"folder_path": folder_path}
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "delete_folder",
            "arguments": args,
        }
    )

    normalized = folder_path.rstrip("/")
    removed = 0
    remaining: dict[str, str] = {}
    for path, content in ctx.context.project.items():
        if path == normalized or path.startswith(normalized + "/"):
            removed += 1
            continue
        remaining[path] = content
    ctx.context.project = remaining

    output = {"folder_path": folder_path, "deleted": True, "removed_files": removed}

    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "delete_folder",
            "output_data": output,
        }
    )
    return json.dumps(output)


@function_tool
async def rename_folder(
    ctx: RunContextWrapper[IDEContext], old_path: str, new_path: str
) -> str:
    """Rename or move a folder; updates all files under the folder path."""
    tool_id = f"tc_{len(ctx.context.events)+1}"
    args = {"old_path": old_path, "new_path": new_path}
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "rename_folder",
            "arguments": args,
        }
    )

    old_norm = old_path.rstrip("/")
    new_norm = new_path.rstrip("/")
    moved = 0
    next_project: dict[str, str] = {}
    for path, content in ctx.context.project.items():
        if path == old_norm or path.startswith(old_norm + "/"):
            suffix = path[len(old_norm):]
            new_file_path = (new_norm + suffix).lstrip("/")
            next_project[new_file_path] = content
            moved += 1
        else:
            next_project[path] = content
    ctx.context.project = next_project

    output = {
        "old_path": old_path,
        "new_path": new_path,
        "renamed": True,
        "moved_files": moved,
    }

    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "rename_folder",
            "output_data": output,
        }
    )
    return json.dumps(output)

def create_ide_agent(model: str | None = None) -> Agent:
    """Factory to construct the IDE Agent with an optional model override.

    If model is provided, attempt to set it on the Agent. If the underlying
    Agent class does not accept a model parameter, gracefully ignore it.
    """
    base_kwargs = {
        "name": "IDE Agent",
        "instructions": instructions,
        "tools": [
            think,
            edit_code,
            create_file,
            delete_file,
            rename_file,
            create_folder,
            delete_folder,
            rename_folder,
            request_code_execution,
        ],
    }
    if model:
        try:
            return Agent(**base_kwargs, model=model)
        except TypeError:
            return Agent(**base_kwargs)
    return Agent(**base_kwargs)


# Default agent used when no model is specified
ide_agent = create_ide_agent()
