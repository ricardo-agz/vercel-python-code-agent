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


instructions = """
You are an IDE assistant that improves code across a multi-file project.

What you can do
- Read the "Project files (paths)" and "Project contents (with line numbers)" sections.
- Propose concrete edits using the provided tools. Do not write code blocks in chat; the UI shows diffs.
- Make small, targeted changes; avoid unrelated refactors or reformatting.
- Preserve existing indentation, style, and structure. Do not add or remove blank lines unnecessarily.
- If multiple non-adjacent edits are needed, make multiple scoped edits rather than a whole-file rewrite.
- When unsure about intent, prefer a minimal safe change and briefly note assumptions.
- When the user explicitly requests a new feature, large refactor, or a rebuild, you MAY add substantial new code, move files/folders, or delete/replace existing code to fulfill the request.

How to work
- Start non-trivial tasks with a short plan: goals, files to touch, and risks.
- Use think() to record that plan succinctly (3–7 bullets). Keep it brief.
- Use edit_code() for precise changes: set an exact line range and provide a replace string that matches only that range.
- For multi-line updates, set find to the exact current text within the chosen range and replace with the full new text for that same range.
- Use create_file() to add new files, and rename_file()/rename_folder() to move things. Use delete_* sparingly and only when clearly safe.
- Ask for request_code_execution() to run or preview the project when runtime feedback is needed; include what will be executed and what success looks like in your surrounding message.
- For large refactors or rebuilds:
  - Outline a stepwise plan in think() first.
  - Prefer archiving via rename_file/rename_folder (e.g., move to a `legacy/` path) before destructive deletes, unless the user explicitly asks to remove code.
  - Create new files and modules with create_file() and adjust imports/usages with edit_code().
  - Keep the project runnable after each major step; use request_code_execution() to validate.

Output rules
- For answers only: reply concisely and skimmably.
- For code changes: summarize the edits you made (files, rationale, risks) without any code blocks. The UI shows diffs.
- Never include line numbers in replacement text. Always preserve file formatting and imports.
- If a tool call fails (e.g., file not found or text not matched), adjust your selection and try again with a narrower, exact range.
 - For large refactors/rebuilds: list major files created, moved, or deleted, note entry points, and mention any follow-up actions the user should take (e.g., install deps, restart dev server).

Available tools (high level):
- think(thoughts): jot a brief plan.
- edit_code(file_path, find, find_start_line, find_end_line, replace): make a scoped, in-place change.
- create_file(file_path, content): add a new file with full content.
- delete_file(file_path): remove an existing file (use with caution).
- rename_file(old_path, new_path): move or rename a file and then update imports with edits.
- create_folder(folder_path): declare a folder (UI only; files control structure).
- delete_folder(folder_path): remove a folder and its files (use with caution).
- rename_folder(old_path, new_path): move a folder and all files under it.
- request_code_execution(response_on_reject): ask the UI to run code; you'll resume with the result.

Remember: small, correct, reversible edits; clear summaries; better UX over aggressive refactors.
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
        + "\n---\nGuidance: For code changes, always call edit_code(file_path, find, find_start_line, find_end_line, replace) with an exact line range and the precise text to replace. Do not include line numbers in replacement text. For multiple non-adjacent changes, call edit_code multiple times. Preserve existing formatting and make minimal, targeted edits.\nIf the user requests a new feature, large refactor, or rebuild, you may also use create_file, rename_file/rename_folder, and delete_file/delete_folder. Prefer archiving via rename into a 'legacy/' path over deletion unless the user explicitly wants removal. After moves, update imports/usages with edit_code, and consider request_code_execution to validate."
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
    """Record a concise plan for the current task.

    Use this before non-trivial changes to outline intent (3–7 short bullets).
    Keep it brief and high-signal; do not include secrets or sensitive data.

    Args:
        thoughts: Short plan or reasoning to log.
    Returns:
        The recorded plan text.
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
    """Make a precise, in-place change within a file.

    Behavior:
    - Operates only on lines [find_start_line, find_end_line] (1-based, inclusive).
    - 'find' must appear within that range; only that matched text is replaced.
    - 'replace' is the full new text for the matched portion; no line numbers.
    - Content outside the selected range is preserved exactly.

    Guidelines:
    - Choose the smallest line range that brackets the intended change.
    - For multiple non-adjacent edits, call this tool multiple times.
    - Preserve formatting, imports, and surrounding structure.

    Args:
        file_path: Project-relative file path.
        find: Exact text to replace within the specified range.
        find_start_line: Start line (1-based, inclusive).
        find_end_line: End line (1-based, inclusive).
        replace: Replacement text (no line numbers).
    Returns:
        JSON string describing the edit or an error.
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
    """Ask the UI to execute code and return output.

    Use when runtime feedback is needed (tests, dev server, script). If execution
    is not yet available, the run will defer and resume later with the result.

    Args:
        response_on_reject: Fallback message if the user declines execution.
    Returns:
        'EXECUTION_REQUESTED' when deferred, or the execution result string when resumed.
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
    """Create a new file with the provided content (for new features or rebuilds).

    Guidelines:
    - Provide the full file contents. Create siblings/modules as needed.
    - Prefer small, focused files in idiomatic locations.
    - Does not overwrite an existing file; returns an error instead. Use rename_* to archive or move old files first.

    Args:
        file_path: Project-relative path for the new file.
        content: Full content of the file.
    Returns:
        JSON string describing the creation or an error.
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
    """Delete an existing file (use sparingly; archive first when possible).

    Use with caution. Prefer edits or renames when appropriate. For rebuilds, consider moving old code into a `legacy/` path instead of deleting unless the user insists on removal.

    Args:
        file_path: Path of the file to remove.
    Returns:
        JSON string indicating deletion or an error.
    """
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
    """Rename or move a file.

    Behavior:
    - Moves content from old_path to new_path; may overwrite if destination exists.
    - Does not automatically update imports/references; follow up with edit_code().

    Args:
        old_path: Current file path.
        new_path: Destination path.
    Returns:
        JSON string describing the rename or an error.
    """
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
    """Declare a folder in the virtual project (no files created).

    This is a UI-level structure; it does not write files. Fails if a file with
    the same path exists.

    Args:
        folder_path: Folder path to declare.
    Returns:
        JSON string indicating creation or an error.
    """
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
    """Delete a folder and all files beneath it in the project mapping (for large cleanups only).

    Use with caution; this removes every file under the path. Prefer rename_folder to archive first when possible.

    Args:
        folder_path: Folder path to remove.
    Returns:
        JSON string including count of removed files.
    """
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
    """Rename or move a folder and all contained files.

    Behavior:
    - Rewrites affected file paths by replacing prefix old_path with new_path.
    - Does not update imports or references; follow up with edit_code() as needed.

    Args:
        old_path: Existing folder path.
        new_path: New folder path.
    Returns:
        JSON string describing the rename.
    """
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
            formatted_model = f"litellm/vercel_ai_gateway/{model}"
            return Agent(**base_kwargs, model=formatted_model)
        except TypeError:
            return Agent(**base_kwargs)
    return Agent(**base_kwargs)


# Default agent used when no model is specified
ide_agent = create_ide_agent()
