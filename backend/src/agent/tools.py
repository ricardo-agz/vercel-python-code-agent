import json
import asyncio
import time
from typing import Any, Dict, Optional, List
from urllib.parse import urlparse
from vercel.sandbox import Sandbox
from agents import function_tool, RunContextWrapper
from src.agent.context import IDEContext
from src.agent.utils import make_ignore_predicate


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
async def delete_file(ctx: RunContextWrapper[IDEContext], file_path: str) -> str:
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
        output = {
            "error": f"File not found: {old_path}",
            "old_path": old_path,
            "new_path": new_path,
        }
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
async def create_folder(ctx: RunContextWrapper[IDEContext], folder_path: str) -> str:
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
        output = {
            "error": f"Conflicts with existing file: {folder_path}",
            "folder_path": folder_path,
        }
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
async def delete_folder(ctx: RunContextWrapper[IDEContext], folder_path: str) -> str:
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


# -------------------------
# Sandbox management tools
# -------------------------


_SANDBOX_CACHE: Dict[str, Sandbox] = {}


def _normalize_sandbox_name(ctx: RunContextWrapper[IDEContext], name: Optional[str]) -> str:
    """Resolve the effective sandbox name.

    Prefers the provided name; otherwise uses the active name if set; otherwise "default".
    Also sets the active name if not set previously.
    """
    n = (name or ctx.context.active_sandbox or "default").strip() or "default"
    if not ctx.context.active_sandbox:
        ctx.context.active_sandbox = n
    return n


async def _snapshot_files_into_context_named(
    ctx: RunContextWrapper[IDEContext], sandbox: Sandbox, name: str
) -> None:
    """Snapshot filesystem and record both global (back-compat) and per-sandbox state."""
    try:
        cmd_ls = await sandbox.run_command(
            "bash",
            [
                "-lc",
                (
                    f"cd {sandbox.sandbox.cwd} && "
                    "find . \\( -path './.git/*' -o -path './node_modules/*' -o -path './vendor/*' -o -path './.bundle/*' -o -path './.cache/*' -o -path './tmp/*' -o -path './log/*' -o -path './logs/*' \\) -prune -o -type f -printf '%P\t%T@\t%s\n' 2>/dev/null | sort"
                ),
            ],
        )
        out = await cmd_ls.stdout()
        current: dict[str, str] = {}
        files: list[str] = []
        for line in (out or "").splitlines():
            try:
                rel, mtime, size = line.split("\t", 2)
            except ValueError:
                continue
            files.append(rel)
            current[rel] = f"{mtime} {size}"
        # Filter out ignored paths
        try:
            is_ignored = make_ignore_predicate(ctx.context.project or {})
            filtered_files = [p for p in files if not is_ignored(p)]
            filtered_current: dict[str, str] = {p: meta for p, meta in current.items() if not is_ignored(p)}
        except Exception:
            filtered_files = files
            filtered_current = current
        # Back-compat single-sandbox fields
        ctx.context.sandbox_files = filtered_files
        ctx.context.sandbox_file_meta = filtered_current
        # Per-sandbox maps
        ctx.context.sandbox_files_map[name] = filtered_files
        ctx.context.sandbox_file_meta_map[name] = filtered_current
    except Exception:
        # Non-fatal
        pass


async def _get_sandbox_by_name(
    ctx: RunContextWrapper[IDEContext], name: str
) -> Sandbox:
    """Get or create a sandbox by name; maintains back-compat fields as well."""
    # If we have a mapping, fetch from cache or remote
    sid = (ctx.context.sandbox_name_to_id or {}).get(name)
    if sid and sid in _SANDBOX_CACHE:
        return _SANDBOX_CACHE[sid]
    if sid:
        fetched = await Sandbox.get(sandbox_id=sid)
        _SANDBOX_CACHE[sid] = fetched
        return fetched
    # If no mapping but legacy single-sandbox exists and name is default, adopt it
    if (not sid) and (name == "default") and ctx.context.sandbox_id:
        sid = ctx.context.sandbox_id
        if sid in _SANDBOX_CACHE:
            ctx.context.sandbox_name_to_id[name] = sid
            return _SANDBOX_CACHE[sid]
        fetched = await Sandbox.get(sandbox_id=sid)
        _SANDBOX_CACHE[sid] = fetched
        ctx.context.sandbox_name_to_id[name] = sid
        return fetched
    # Create a new sandbox with stored preferences or legacy defaults
    runtime = (ctx.context.sandbox_runtime_map or {}).get(name) or ctx.context.sandbox_runtime
    ports = (ctx.context.sandbox_ports_map or {}).get(name) or ctx.context.sandbox_ports
    sandbox = await Sandbox.create(
        timeout=600_000,
        runtime=runtime,
        ports=ports,
    )
    ctx.context.sandbox_name_to_id[name] = sandbox.sandbox_id
    ctx.context.active_sandbox = name
    # Update legacy single-sandbox fields for back-compat
    ctx.context.sandbox_id = sandbox.sandbox_id
    ctx.context.sandbox_runtime = runtime
    ctx.context.sandbox_ports = ports
    _SANDBOX_CACHE[sandbox.sandbox_id] = sandbox
    try:
        await _sync_project_files(ctx, sandbox)
        await _snapshot_files_into_context_named(ctx, sandbox, name)
    except Exception:
        pass
    return sandbox

async def _sync_project_files(ctx: RunContextWrapper[IDEContext], sandbox: Sandbox) -> int:
    to_write: list[dict[str, Any]] = []
    written = 0
    project = ctx.context.project or {}
    for path, content in project.items():
        p = str(path).lstrip("./")
        if not p:
            continue
        try:
            b = content.encode("utf-8")
        except Exception:
            b = bytes(str(content), "utf-8")
        to_write.append({"path": p, "content": b})
        written += 1
    for i in range(0, len(to_write), 64):
        chunk = to_write[i : i + 64]
        await sandbox.write_files(chunk)
    return written


async def _snapshot_files_into_context(ctx: RunContextWrapper[IDEContext], sandbox: Sandbox) -> None:
    try:
        cmd_ls = await sandbox.run_command(
            "bash",
            [
                "-lc",
                (
                    f"cd {sandbox.sandbox.cwd} && "
                    "find . \\( -path './.git/*' -o -path './node_modules/*' -o -path './vendor/*' -o -path './.bundle/*' -o -path './.cache/*' -o -path './tmp/*' -o -path './log/*' -o -path './logs/*' \\) -prune -o -type f -printf '%P\t%T@\t%s\n' 2>/dev/null | sort"
                ),
            ],
        )
        out = await cmd_ls.stdout()
        current: dict[str, str] = {}
        files: list[str] = []
        for line in (out or "").splitlines():
            try:
                rel, mtime, size = line.split("\t", 2)
            except ValueError:
                continue
            files.append(rel)
            current[rel] = f"{mtime} {size}"
        # Filter out ignored paths (e.g., __pycache__/, node_modules/, etc.)
        try:
            is_ignored = make_ignore_predicate(ctx.context.project or {})
            filtered_files = [p for p in files if not is_ignored(p)]
            filtered_current: dict[str, str] = {p: meta for p, meta in current.items() if not is_ignored(p)}
        except Exception:
            filtered_files = files
            filtered_current = current
        ctx.context.sandbox_files = filtered_files
        ctx.context.sandbox_file_meta = filtered_current
    except Exception:
        # Non-fatal; continue without baseline
        pass

async def _get_sandbox(ctx: RunContextWrapper[IDEContext]) -> Sandbox:
    sid = ctx.context.sandbox_id
    if sid and sid in _SANDBOX_CACHE:
        return _SANDBOX_CACHE[sid]
    if sid:
        fetched = await Sandbox.get(sandbox_id=sid)
        _SANDBOX_CACHE[sid] = fetched
        return fetched
    # create on-demand if none exists
    sandbox = await Sandbox.create(
        timeout=600_000,
        runtime=ctx.context.sandbox_runtime,
        ports=(ctx.context.sandbox_ports or None),
    )
    ctx.context.sandbox_id = sandbox.sandbox_id
    _SANDBOX_CACHE[sandbox.sandbox_id] = sandbox
    # Auto-sync current project mapping into the new sandbox working directory
    try:
        await _sync_project_files(ctx, sandbox)
        await _snapshot_files_into_context(ctx, sandbox)
    except Exception:
        # best-effort; continue even if sync fails
        pass
    return sandbox



def _parse_env_list(env_list: Optional[List[str]]) -> dict[str, str]:
    """Parse a list of strings like ["KEY=VALUE", ...] into a mapping.

    Invalid entries or empty keys are ignored. First occurrence of a key wins.
    """
    result: dict[str, str] = {}
    if not env_list:
        return result
    for entry in env_list:
        if not entry:
            continue
        try:
            key, value = entry.split("=", 1)
        except ValueError:
            # skip items without '='
            continue
        k = key.strip()
        if k and k not in result:
            result[k] = value
    return result


@function_tool
async def sandbox_create(
    ctx: RunContextWrapper[IDEContext],
    runtime: Optional[str] = None,
    ports: Optional[List[int]] = None,
    timeout_ms: Optional[int] = 600_000,
    name: Optional[str] = None,
) -> str:
    """Create a persistent sandbox and remember it for this run.

    Args:
        runtime: Optional runtime, e.g. "node22", "python3.13".
        ports: Optional list of ports to expose (for previews).
        timeout_ms: Sandbox lifetime timeout in milliseconds.
    Returns:
        JSON with sandbox details.
    """
    tool_id = f"tc_{len(ctx.context.events)+1}"
    args = {"runtime": runtime, "ports": ports, "timeout_ms": timeout_ms, "name": name}
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "sandbox_create",
            "arguments": args,
        }
    )

    sb_name = _normalize_sandbox_name(ctx, name)

    # Synthetic runtimes: if a Ruby or Go runtime is requested, create on a Node runtime and bootstrap
    requested_runtime = runtime
    is_synthetic_ruby = bool(requested_runtime and str(requested_runtime).lower().startswith("ruby"))
    is_synthetic_go = bool(requested_runtime and str(requested_runtime).lower().startswith("go"))
    effective_runtime = requested_runtime
    if is_synthetic_ruby or is_synthetic_go:
        # Default to node22 as the base image for bootstrapping
        effective_runtime = "node22"

    sandbox = await Sandbox.create(
        timeout=timeout_ms or 600_000,
        runtime=effective_runtime,
        ports=ports,
    )
    # Map and set active sandbox
    ctx.context.sandbox_name_to_id[sb_name] = sandbox.sandbox_id
    ctx.context.active_sandbox = sb_name
    # Persist preferences per-sandbox
    if requested_runtime or effective_runtime:
        ctx.context.sandbox_runtime_map[sb_name] = (requested_runtime or effective_runtime)  # type: ignore[arg-type]
    if ports is not None:
        ctx.context.sandbox_ports_map[sb_name] = ports
    # Update legacy single-sandbox fields for back-compat (point to last created)
    ctx.context.sandbox_id = sandbox.sandbox_id
    ctx.context.sandbox_runtime = requested_runtime or effective_runtime
    ctx.context.sandbox_ports = ports
    _SANDBOX_CACHE[sandbox.sandbox_id] = sandbox

    # Sync project files into sandbox cwd
    synced = 0
    try:
        synced = await _sync_project_files(ctx, sandbox)
        await _snapshot_files_into_context_named(ctx, sandbox, sb_name)
        ctx.context.events.append(
            {
                "phase": "log",
                "tool_id": tool_id,
                "name": "sandbox_create",
                "data": f"Synced {synced} project files to sandbox.\n",
            }
        )
    except Exception as e:
        ctx.context.events.append(
            {
                "phase": "log",
                "tool_id": tool_id,
                "name": "sandbox_create",
                "data": f"Project sync error: {str(e)}\n",
            }
        )

    # If synthetic Ruby runtime requested, bootstrap Ruby and Bundler now
    if is_synthetic_ruby:
        try:
            ctx.context.events.append(
                {
                    "phase": "log",
                    "tool_id": tool_id,
                    "name": "sandbox_create",
                    "data": "Initializing Ruby runtime...\n",
                }
            )
            # Ensure Ruby 3.2+ with development headers and build tools are available in AL2023 base image
            ruby_install_sh = (
                "if ! command -v ruby >/dev/null 2>&1; then "
                "dnf install -y ruby3.2 ruby3.2-rubygems ruby3.2-rubygem-json ruby3.2-devel libyaml-devel sqlite sqlite-devel gcc gcc-c++ make git redhat-rpm-config; "
                "fi; ruby --version; gem --version;"
            )
            ruby_cmd = await sandbox.run_command_detached(
                "bash",
                ["-lc", ruby_install_sh],
                sudo=True,
            )
            try:
                async for line in ruby_cmd.logs():
                    ctx.context.events.append(
                        {
                            "phase": "log",
                            "tool_id": tool_id,
                            "name": "sandbox_create",
                            "data": line.data,
                        }
                    )
            except Exception:
                pass
            _ = await ruby_cmd.wait()

            # Ensure Bundler is available system-wide (install with sudo if missing)
            bundler_install_sh = (
                "if command -v gem >/dev/null 2>&1; then "
                "gem list -i bundler >/dev/null 2>&1 || gem install --no-document bundler; "
                "fi; bundle --version || true"
            )
            bundler_install_cmd = await sandbox.run_command_detached(
                "bash",
                ["-lc", bundler_install_sh],
                sudo=True,
            )
            try:
                async for line in bundler_install_cmd.logs():
                    ctx.context.events.append(
                        {
                            "phase": "log",
                            "tool_id": tool_id,
                            "name": "sandbox_create",
                            "data": line.data,
                        }
                    )
            except Exception:
                pass
            _ = await bundler_install_cmd.wait()

            # Configure Bundler to install into a project-local path to avoid permission issues
            bundler_cfg_sh = (
                f"cd {sandbox.sandbox.cwd} && "
                "mkdir -p vendor/bundle && "
                "bundle config set --local path vendor/bundle"
            )
            bundler_cfg_cmd = await sandbox.run_command_detached(
                "bash",
                ["-lc", bundler_cfg_sh],
            )
            try:
                async for line in bundler_cfg_cmd.logs():
                    ctx.context.events.append(
                        {
                            "phase": "log",
                            "tool_id": tool_id,
                            "name": "sandbox_create",
                            "data": line.data,
                        }
                    )
            except Exception:
                pass
            _ = await bundler_cfg_cmd.wait()

            # Ensure rack (rackup) and puma are available via Bundler; create Gemfile if missing
            rack_puma_setup_sh = (
                f"cd {sandbox.sandbox.cwd} && "
                "( [ -f Gemfile ] || bundle init ) && "
                "bundle add rack puma || true && "
                "bundle install && "
                "bundle binstubs rack puma"
            )
            rack_puma_cmd = await sandbox.run_command_detached(
                "bash",
                ["-lc", rack_puma_setup_sh],
            )
            try:
                async for line in rack_puma_cmd.logs():
                    ctx.context.events.append(
                        {
                            "phase": "log",
                            "tool_id": tool_id,
                            "name": "sandbox_create",
                            "data": line.data,
                        }
                    )
            except Exception:
                pass
            _ = await rack_puma_cmd.wait()

            # Set default env for future runs so `bundle install` uses vendor/bundle
            try:
                per_env = dict(ctx.context.sandbox_envs.get(sb_name, {}))
                per_env.update({
                    "BUNDLE_PATH": "vendor/bundle",
                    "PATH": f"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/share/gems/bin:/usr/share/ruby3.2-gems/bin:/home/vercel-sandbox/.local/share/gem/ruby/bin:/home/vercel-sandbox/.gem/ruby/bin:{sandbox.sandbox.cwd}/bin",
                })
                ctx.context.sandbox_envs[sb_name] = per_env
                # Back-compat global defaults too
                ctx.context.sandbox_env.update({
                    "BUNDLE_PATH": "vendor/bundle",
                    "PATH": f"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/share/gems/bin:/usr/share/ruby3.2-gems/bin:/home/vercel-sandbox/.local/share/gem/ruby/bin:/home/vercel-sandbox/.gem/ruby/bin:{sandbox.sandbox.cwd}/bin",
                })
            except Exception:
                pass

            ctx.context.events.append(
                {
                    "phase": "log",
                    "tool_id": tool_id,
                    "name": "sandbox_create",
                    "data": "Synthetic Ruby runtime ready. Bundler configured; rackup and puma installed (binstubs in ./bin).\n",
                }
            )
        except Exception as e:
            ctx.context.events.append(
                {
                    "phase": "log",
                    "tool_id": tool_id,
                    "name": "sandbox_create",
                    "data": f"Ruby bootstrap error: {str(e)}\n",
                }
            )

    # If synthetic Go runtime requested, install Go toolchain now
    if is_synthetic_go:
        try:
            ctx.context.events.append(
                {
                    "phase": "log",
                    "tool_id": tool_id,
                    "name": "sandbox_create",
                    "data": "Initializing Go runtime...\n",
                }
            )
            go_install_sh = (
                "if ! command -v go >/dev/null 2>&1; then "
                "dnf install -y golang git || exit 1; "
                "fi; go version; git --version || true;"
            )
            go_cmd = await sandbox.run_command_detached(
                "bash",
                ["-lc", go_install_sh],
                sudo=True,
            )
            try:
                async for line in go_cmd.logs():
                    ctx.context.events.append(
                        {
                            "phase": "log",
                            "tool_id": tool_id,
                            "name": "sandbox_create",
                            "data": line.data,
                        }
                    )
            except Exception:
                pass
            _ = await go_cmd.wait()

            # Optionally ensure a writable GOPATH bin on PATH (no-op if not used)
            try:
                per_env = dict(ctx.context.sandbox_envs.get(sb_name, {}))
                per_env.update({
                    "GOPATH": "/home/vercel-sandbox/go",
                    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/vercel-sandbox/go/bin:" + (ctx.context.sandbox_env.get("PATH") or ""),
                })
                ctx.context.sandbox_envs[sb_name] = per_env
                # Back-compat global defaults too
                ctx.context.sandbox_env.update({
                    "GOPATH": "/home/vercel-sandbox/go",
                })
            except Exception:
                pass

            ctx.context.events.append(
                {
                    "phase": "log",
                    "tool_id": tool_id,
                    "name": "sandbox_create",
                    "data": "Synthetic Go runtime ready. golang and git installed.\n",
                }
            )
        except Exception as e:
            ctx.context.events.append(
                {
                    "phase": "log",
                    "tool_id": tool_id,
                    "name": "sandbox_create",
                    "data": f"Go bootstrap error: {str(e)}\n",
                }
            )

    output = {
        "sandbox_id": sandbox.sandbox_id,
        "status": getattr(sandbox, "status", None),
        "runtime": requested_runtime or effective_runtime,
        "ports": ports,
        "synced_files": synced,
        "name": sb_name,
        **({"synthetic_runtime": True, "effective_runtime": effective_runtime} if (is_synthetic_ruby or is_synthetic_go) else {}),
    }
    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "sandbox_create",
            "output_data": output,
        }
    )
    return json.dumps(output)


@function_tool
async def sandbox_stop(ctx: RunContextWrapper[IDEContext], name: Optional[str] = None) -> str:
    """Stop and release the specified sandbox (or active/default if none provided)."""
    tool_id = f"tc_{len(ctx.context.events)+1}"
    args = {"name": name}
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "sandbox_stop",
            "arguments": args,
        }
    )
    sb_name = _normalize_sandbox_name(ctx, name)
    sid = (ctx.context.sandbox_name_to_id or {}).get(sb_name) or (ctx.context.sandbox_id if sb_name == "default" else None)
    if not sid:
        output = {"stopped": False, "error": "no sandbox"}
    else:
        try:
            sandbox = _SANDBOX_CACHE.get(sid) or await Sandbox.get(sandbox_id=sid)
            await sandbox.stop()
            try:
                await Sandbox.get(sandbox_id=sid)  # best-effort refresh
            except Exception:
                pass
            try:
                if sid in _SANDBOX_CACHE:
                    await _SANDBOX_CACHE[sid].client.aclose()
            except Exception:
                pass
            _SANDBOX_CACHE.pop(sid, None)
            # Clear mappings
            if sb_name in (ctx.context.sandbox_name_to_id or {}):
                ctx.context.sandbox_name_to_id.pop(sb_name, None)
            if ctx.context.active_sandbox == sb_name:
                ctx.context.active_sandbox = None
            if sb_name == "default":
                ctx.context.sandbox_id = None
            output = {"stopped": True}
        except Exception as e:
            output = {"stopped": False, "error": str(e)}
    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "sandbox_stop",
            "output_data": output,
        }
    )
    return json.dumps(output)


@function_tool
async def sandbox_run(
    ctx: RunContextWrapper[IDEContext],
    command: str,
    cwd: Optional[str] = None,
    env: Optional[List[str]] = None,
    detached: bool = False,
    ready_patterns: Optional[List[str]] = None,
    port: Optional[int] = None,
    wait_timeout_ms: Optional[int] = 30_000,
    stream_logs: bool = True,
    name: Optional[str] = None,
    auto_python_ensure: bool = True,
    auto_ready_patterns: bool = True,
    auto_ruby_ensure: bool = True,
    auto_go_ensure: bool = True,
) -> str:
    """Run a shell command in the active sandbox, optionally streaming logs and detecting readiness.

    Args:
        command: Shell command to run.
        cwd: Working directory inside sandbox; defaults to sandbox cwd.
        env: Extra environment variables.
        detached: If true, do not wait for process exit.
        ready_patterns: If provided, return after any pattern appears in logs.
        port: If provided, compute preview URL when ready (sandbox.domain(port)).
        wait_timeout_ms: Max time to wait for readiness when detached.
        stream_logs: If true, stream logs into the run timeline.
        name: Optional label for the process.
        auto_python_ensure: Auto-ensure Python tooling when command indicates Python usage.
        auto_ready_patterns: Auto-detect common readiness messages for certain servers.
        auto_ruby_ensure: Auto-ensure Ruby/Bundler when command indicates Ruby usage.
    Returns:
        JSON with status, exit_code (if attached), and preview_url if detected.
    """
    tool_id = f"tc_{len(ctx.context.events)+1}"

    sb_name = _normalize_sandbox_name(ctx, name)
    sandbox = await _get_sandbox_by_name(ctx, sb_name)
    # Resolve cwd safely: default to sandbox cwd; allow only subdirs under it
    requested_cwd = cwd
    base_cwd = sandbox.sandbox.cwd
    safe_cwd = base_cwd
    try:
        if requested_cwd:
            # Treat absolute paths outside sandbox as invalid; treat relative as under sandbox
            if requested_cwd.startswith("/"):
                if requested_cwd.startswith(base_cwd + "/") or requested_cwd == base_cwd:
                    safe_cwd = requested_cwd
                else:
                    # ignore unsafe absolute cwd
                    pass
            else:
                safe_cwd = f"{base_cwd}/{requested_cwd}".rstrip("/")
    except Exception:
        safe_cwd = base_cwd

    # Precompute lower-cased command and Ruby/Go usage before heuristics that reference it
    cmd_lower = (command or "").lower()
    uses_ruby = (
        (" gem " in cmd_lower)
        or cmd_lower.startswith("gem ")
        or (" bundle " in cmd_lower)
        or cmd_lower.startswith("bundle ")
        or ("rackup" in cmd_lower)
        or ("ruby " in cmd_lower)
        or cmd_lower.startswith("ruby ")
        or ("sinatra" in cmd_lower)
        or ("rails " in cmd_lower)
    )
    uses_go = (" go " in f" {cmd_lower} ") or cmd_lower.startswith("go ")

    # Heuristic: auto-select Rails app root as cwd when running Rails/Bundler commands without an explicit cwd
    try:
        rails_related = False
        if uses_ruby and (requested_cwd is None or str(requested_cwd).strip() == ""):
            cln = (command or "").strip().lower()
            is_rails_new = (cln.startswith("rails new") or " rails new " in cln)
            rails_related = (
                ("bundle install" in cln)
                or (" rails generate" in cln)
                or cln.startswith("rails generate")
                or (" rails db:" in cln)
                or cln.startswith("rails db:")
                or ("bin/rails" in cln and not is_rails_new)
            ) and not is_rails_new
        if rails_related:
            files = ctx.context.sandbox_files or []
            # find unique app roots by locating */bin/rails
            app_roots: list[str] = []
            for p in files:
                if p.endswith("/bin/rails"):
                    app_roots.append(p[: -len("/bin/rails")])
            # if exactly one app root is present, default cwd to it
            if len(app_roots) == 1:
                safe_cwd = f"{base_cwd}/{app_roots[0]}".rstrip("/")
    except Exception:
        pass

    args = {
        "command": command,
        "cwd": safe_cwd,
        "requested_cwd": requested_cwd,
        "env": env,
        "detached": detached,
        "ready_patterns": ready_patterns,
        "port": port,
        "wait_timeout_ms": wait_timeout_ms,
        "stream_logs": stream_logs,
        "name": sb_name,
    }
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "sandbox_run",
            "arguments": args,
        }
    )

    # Ensure the sandbox has the latest project files before executing
    try:
        synced_count = await _sync_project_files(ctx, sandbox)
        await _snapshot_files_into_context(ctx, sandbox)
        if stream_logs:
            ctx.context.events.append(
                {
                    "phase": "log",
                    "tool_id": tool_id,
                    "name": "sandbox_run",
                    "data": f"Synced {synced_count} project files to sandbox before run.\n",
                }
            )
    except Exception as e:
        if stream_logs:
            ctx.context.events.append(
                {
                    "phase": "log",
                    "tool_id": tool_id,
                    "name": "sandbox_run",
                    "data": f"Pre-run sync failed: {str(e)}\n",
                }
            )

    # Parse list-form env (e.g., ["KEY=VALUE"]) into a dict and merge with defaults
    per_env = (ctx.context.sandbox_envs or {}).get(sb_name, {})
    full_env = {**(ctx.context.sandbox_env or {}), **per_env, **(_parse_env_list(env) if env else {})}
    cd_prefix = f"cd {safe_cwd} && "

    # Heuristics: if this looks like a Python task (pip/python/uvicorn), ensure python + pip are ready
    cmd_lower = command.lower()

    # Auto-attach for scaffolding/one-shot install commands when no readiness criteria are provided
    # This ensures filesystem snapshots include newly generated files (e.g., from 'rails new')
    try:
        cl = (command or "").strip().lower()
        is_scaffold_or_install = (
            cl.startswith("rails new")
            or " rails new " in cl
            or cl.startswith("rails generate")
            or cl.startswith("rails g ")
            or " rails generate " in cl
            or " rails g " in cl
            or cl.startswith("bundle install")
            or " bundle install " in cl
        )
        if detached and not ready_patterns and (port is None) and is_scaffold_or_install:
            detached = False
    except Exception:
        pass
    uses_python = (
        (" pip " in cmd_lower)
        or cmd_lower.startswith("pip ")
        or (" pip3 " in cmd_lower)
        or cmd_lower.startswith("pip3 ")
        or ("-m pip" in cmd_lower)
        or ("python " in cmd_lower)
        or cmd_lower.startswith("python")
        or ("uvicorn" in cmd_lower)
    )

    if auto_python_ensure and uses_python:
        ensure_sh = (
            "PYBIN=$(command -v python3 || command -v python || echo /vercel/runtimes/python/bin/python3); "
            "if [ -z \"$PYBIN\" ]; then echo 'python not found in sandbox'; exit 1; fi; "
            "$PYBIN -m ensurepip --upgrade || true; "
            "$PYBIN -m pip install --upgrade pip || true;"
        )
        ensure_cmd = await sandbox.run_command_detached(
            "bash",
            ["-lc", f"{cd_prefix}{ensure_sh}"],
            env=full_env or None,
        )
        try:
            async for line in ensure_cmd.logs():
                if stream_logs:
                    ctx.context.events.append(
                        {
                            "phase": "log",
                            "tool_id": tool_id,
                            "name": "sandbox_run",
                            "data": line.data,
                        }
                    )
        except Exception:
            pass
        _ = await ensure_cmd.wait()

    # Heuristics: if this looks like a Ruby task (gem/bundle/rackup/sinatra), ensure ruby + basic gems are ready
    uses_ruby = (
        (" gem " in cmd_lower)
        or cmd_lower.startswith("gem ")
        or (" bundle " in cmd_lower)
        or cmd_lower.startswith("bundle ")
        or ("rackup" in cmd_lower)
        or ("ruby " in cmd_lower)
        or cmd_lower.startswith("ruby ")
        or ("sinatra" in cmd_lower)
    )

    if auto_ruby_ensure and uses_ruby:
        # Install Ruby 3.2 when missing. Works in AL2023 base.
        # 1) Ensure ruby exists (install via dnf if needed)
        ruby_install_sh = (
            "if ! command -v ruby >/dev/null 2>&1; then "
            "dnf install -y ruby3.2 ruby3.2-rubygems ruby3.2-rubygem-json ruby3.2-devel libyaml-devel sqlite sqlite-devel gcc gcc-c++ make git redhat-rpm-config ruby3.2-rubygem-bundler || exit 1; "
            "fi; "
            "ruby --version; gem --version; bundle --version || true;"
        )
        ruby_install_cmd = await sandbox.run_command_detached(
            "bash",
            ["-lc", f"{cd_prefix}{ruby_install_sh}"],
            env=full_env or None,
            sudo=True,
        )
        try:
            async for line in ruby_install_cmd.logs():
                if stream_logs:
                    ctx.context.events.append(
                        {
                            "phase": "log",
                            "tool_id": tool_id,
                            "name": "sandbox_run",
                            "data": line.data,
                        }
                    )
        except Exception:
            pass
        _ = await ruby_install_cmd.wait()

        # 2) Ensure Bundler is present globally (install with sudo if missing)
        bundler_install_sh = (
            "if ! command -v bundle >/dev/null 2>&1; then "
            "gem list -i bundler >/dev/null 2>&1 || gem install --no-document bundler; "
            "fi; bundle --version || true;"
        )
        bundler_install_cmd = await sandbox.run_command_detached(
            "bash",
            ["-lc", f"{cd_prefix}{bundler_install_sh}"],
            env=full_env or None,
            sudo=True,
        )
        try:
            async for line in bundler_install_cmd.logs():
                if stream_logs:
                    ctx.context.events.append(
                        {
                            "phase": "log",
                            "tool_id": tool_id,
                            "name": "sandbox_run",
                            "data": line.data,
                        }
                    )
        except Exception:
            pass
        _ = await bundler_install_cmd.wait()

        # 3) Configure Bundler to install into a project-local path to avoid permission issues
        bundler_cfg_sh = (
            f"cd {safe_cwd} && "
            "mkdir -p vendor/bundle && "
            "bundle config set --local path vendor/bundle"
        )
        bundler_cfg_cmd = await sandbox.run_command_detached(
            "bash",
            ["-lc", bundler_cfg_sh],
            env=full_env or None,
        )
        try:
            async for line in bundler_cfg_cmd.logs():
                if stream_logs:
                    ctx.context.events.append(
                        {
                            "phase": "log",
                            "tool_id": tool_id,
                            "name": "sandbox_run",
                            "data": line.data,
                        }
                    )
        except Exception:
            pass
        _ = await bundler_cfg_cmd.wait()

        # Ensure PATH includes common gem bin locations for subsequent commands
        try:
            ctx.context.sandbox_env.update({
                "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/share/gems/bin:/usr/share/ruby3.2-gems/bin:/home/vercel-sandbox/.local/share/gem/ruby/bin:/home/vercel-sandbox/.gem/ruby/bin",
                "BUNDLE_PATH": "vendor/bundle",
            })
        except Exception:
            pass

    # When running Ruby apps directly, ensure vendored gems are on the load path by wrapping with Bundler if a Gemfile exists.
    try:
        cl = (command or "").strip().lower()
        starts_with_ruby = cl.startswith("ruby ")
        starts_with_rackup = cl.startswith("rackup")
        starts_with_rails = cl.startswith("rails ")
        already_using_bundle = cl.startswith("bundle ") or (" bundle exec " in cl)
        if uses_ruby and (starts_with_ruby or starts_with_rackup or starts_with_rails) and not already_using_bundle:
            command = f"( [ -f Gemfile ] || [ -f ./Gemfile ] ) && bundle exec {command} || {command}"
    except Exception:
        pass

    # Heuristics: if this looks like a Go task, ensure Go toolchain is present
    if auto_go_ensure and uses_go:
        go_install_sh = (
            "if ! command -v go >/dev/null 2>&1; then "
            "dnf install -y golang git || exit 1; "
            "fi; go version || exit 1;"
        )
        go_install_cmd = await sandbox.run_command_detached(
            "bash",
            ["-lc", f"{cd_prefix}{go_install_sh}"],
            env=full_env or None,
            sudo=True,
        )
        try:
            async for line in go_install_cmd.logs():
                if stream_logs:
                    ctx.context.events.append(
                        {
                            "phase": "log",
                            "tool_id": tool_id,
                            "name": "sandbox_run",
                            "data": line.data,
                        }
                    )
        except Exception:
            pass
        _ = await go_install_cmd.wait()

    # Auto infer ready patterns and port for common Go runs
    is_go_run = uses_go and (" go run" in f" {cmd_lower}" or cmd_lower.startswith("go run"))
    if auto_ready_patterns and (not ready_patterns or len(ready_patterns) == 0) and is_go_run:
        ready_patterns = [
            "Listening on",
            "http://0.0.0.0:",
            "listening on :",
            "Server started",
            "Serving on",
        ]
    if (port is None) and is_go_run:
        try:
            import re as _re
            m = _re.search(r"--port\\s+(\\d+)|-p\\s+(\\d+)", command)
            if m:
                port = int(m.group(1) or m.group(2))
            else:
                port = 3000
        except Exception:
            port = 3000

    # Auto infer ready patterns and port for uvicorn if not supplied
    if auto_ready_patterns and (not ready_patterns or len(ready_patterns) == 0) and ("uvicorn" in cmd_lower):
        ready_patterns = ["Application startup complete", "Uvicorn running on"]
    if (port is None) and ("uvicorn" in cmd_lower):
        try:
            import re as _re

            m = _re.search(r"--port\s+(\d+)|-p\s+(\d+)", command)
            if m:
                port = int(m.group(1) or m.group(2))
            else:
                port = 8000
        except Exception:
            port = 8000

    # Auto infer ready patterns and port for rackup/sinatra if not supplied
    if auto_ready_patterns and (not ready_patterns or len(ready_patterns) == 0) and (("rackup" in cmd_lower) or ("sinatra" in cmd_lower) or cmd_lower.startswith("ruby ")):
        # Common server readiness hints for Rack/WEBrick/Sinatra
        ready_patterns = [
            "Listening on",
            "WEBrick::HTTPServer#start",
            "Sinatra has taken the stage",
            "tcp://0.0.0.0:",
            "WEBrick::HTTPServer#start: pid=",
        ]
    if (port is None) and (("rackup" in cmd_lower) or ("sinatra" in cmd_lower) or cmd_lower.startswith("ruby ")):
        try:
            import re as _re

            m = _re.search(r"--port\s+(\d+)|-p\s+(\d+)", command)
            if m:
                port = int(m.group(1) or m.group(2))
            else:
                # Defaults: rackup -> 9292, sinatra/ruby app.rb -> 4567
                port = 9292 if ("rackup" in cmd_lower) else 4567
        except Exception:
            port = 9292 if ("rackup" in cmd_lower) else 4567

    # Auto infer ready patterns and port for Rails server
    is_rails_server = ("rails server" in cmd_lower) or ("rails s" in cmd_lower)
    if auto_ready_patterns and (not ready_patterns or len(ready_patterns) == 0) and is_rails_server:
        ready_patterns = [
            "Listening on",
            "Use Ctrl-C to stop",
            "Puma starting",
        ]
    if (port is None) and is_rails_server:
        try:
            import re as _re

            m = _re.search(r"--port\s+(\d+)|-p\s+(\d+)", command)
            if m:
                port = int(m.group(1) or m.group(2))
            else:
                port = 3000
        except Exception:
            port = 3000

    # Ensure Rails server binds to 0.0.0.0 and set ALLOWED_HOST automatically
    try:
        if is_rails_server:
            if (" -b " not in command) and (" --binding " not in command):
                command = f"{command} -b 0.0.0.0"
            # Inject ALLOWED_HOST if not present
            if "allowed_host=" not in cmd_lower:
                try:
                    url = sandbox.domain(port or 3000)
                    host = urlparse(url).hostname or ""
                except Exception:
                    host = ""
                if host:
                    command = f"ALLOWED_HOST={host} {command}"
    except Exception:
        pass

    cmd = await sandbox.run_command_detached(
        "bash",
        ["-lc", f"{cd_prefix}{command}"],
        env=full_env or None,
    )

    preview_url: Optional[str] = None
    # We will collect logs until readiness, timeout, or process exit
    collected_logs: list[str] = []
    ready: bool = False
    timed_out: bool = False
    exited_early: bool = False
    exit_code: Optional[int] = None
    should_wait = bool((ready_patterns and len(ready_patterns) > 0) or (port is not None))
    ready_deadline = (
        (time.time() + (wait_timeout_ms or 0) / 1000.0)
        if should_wait
        else None
    )

    stop_event = asyncio.Event()

    async def _stream_logs() -> None:
        nonlocal preview_url, ready
        try:
            async for line in cmd.logs():
                data = line.data or ""
                # Append to UI timeline if requested
                if stream_logs:
                    ctx.context.events.append(
                        {
                            "phase": "log",
                            "tool_id": tool_id,
                            "name": "sandbox_run",
                            "data": data,
                        }
                    )
                # Always collect for LLM summary
                collected_logs.append(data)
                # Detect readiness
                if ready_patterns:
                    for pat in ready_patterns:
                        if pat and (pat in data):
                            ready = True
                            if port and not preview_url:
                                try:
                                    url = sandbox.domain(port)
                                except Exception:
                                    url = None
                                if url:
                                    preview_url = url
                                    ctx.context.events.append(
                                        {
                                            "phase": "log",
                                            "tool_id": tool_id,
                                            "name": "sandbox_run",
                                            "data": f"[{sb_name}] Preview available at: {url}\n",
                                        }
                                    )
                            stop_event.set()
                            return
                # Stop if timeout/exit already signaled
                if stop_event.is_set():
                    return
        except Exception:
            # Ignore streaming errors but ensure we don't block forever
            stop_event.set()
            return

    async def _wait_for_exit() -> None:
        nonlocal exit_code, exited_early
        try:
            done = await cmd.wait()
            exit_code = getattr(done, "exit_code", None)
            exited_early = True
        except Exception:
            pass
        finally:
            stop_event.set()

    async def _timer() -> None:
        nonlocal timed_out
        if ready_deadline is None:
            return
        try:
            now = time.time()
            remaining = max(0.0, ready_deadline - now)
            await asyncio.sleep(remaining)
            if not stop_event.is_set():
                timed_out = True
                stop_event.set()
        except Exception:
            # best-effort timeout
            if not stop_event.is_set():
                timed_out = True
                stop_event.set()

    # After command start/finish, optionally compute a filesystem snapshot for auto-resync
    async def _snapshot_files() -> dict[str, Any]:
        try:
            cmd_ls = await sandbox.run_command(
                "bash",
                [
                    "-lc",
                    (
                        f"cd {sandbox.sandbox.cwd} && "
                        "find . \\( -path './.git/*' -o -path './node_modules/*' -o -path './vendor/*' -o -path './.bundle/*' -o -path './.cache/*' -o -path './tmp/*' -o -path './log/*' -o -path './logs/*' \\) -prune -o -type f -printf '%P\t%T@\t%s\n' 2>/dev/null | sort"
                    ),
                ],
            )
            out = await cmd_ls.stdout()
            current: dict[str, str] = {}
            files: list[str] = []
            for line in (out or "").splitlines():
                try:
                    rel, mtime, size = line.split("\t", 2)
                except ValueError:
                    continue
                files.append(rel)
                current[rel] = f"{mtime} {size}"
            prev = ctx.context.sandbox_file_meta or {}
            created: list[str] = []
            updated: list[str] = []
            deleted: list[str] = []
            prev_keys = set(prev.keys())
            cur_keys = set(current.keys())
            for p in sorted(cur_keys - prev_keys):
                created.append(p)
            for p in sorted(prev_keys - cur_keys):
                deleted.append(p)
            for p in sorted(cur_keys & prev_keys):
                if prev.get(p) != current.get(p):
                    updated.append(p)
            # Filter out ignored paths consistently
            try:
                is_ignored = make_ignore_predicate(ctx.context.project or {})
                files = [p for p in files if not is_ignored(p)]
                current = {p: meta for p, meta in current.items() if not is_ignored(p)}
                created = [p for p in created if not is_ignored(p)]
                updated = [p for p in updated if not is_ignored(p)]
                deleted = [p for p in deleted if not is_ignored(p)]
            except Exception:
                pass

            ctx.context.sandbox_files = files
            ctx.context.sandbox_file_meta = current
            # Optionally sample contents of small created/updated files for frontend resync
            data: list[dict[str, Any]] = []
            sample_paths = created + updated
            if sample_paths:
                # Limit to first N and small files only
                limit = 50
                for p in sample_paths[:limit]:
                    try:
                        # only sample files up to 200KB
                        # read and base64-encode for transport
                        safe = p.replace('"', '\\"')
                        cmd_cat = await sandbox.run_command(
                            "bash",
                            [
                                "-lc",
                                (
                                    f"cd {sandbox.sandbox.cwd} && "
                                    f"if [ -f '{safe}' ] && [ $(stat -c %s '{safe}' 2>/dev/null || stat -f %z '{safe}') -le 200000 ]; then "
                                    f"base64 '{safe}'; else echo '__SKIP__'; fi"
                                ),
                            ],
                        )
                        b64 = (await cmd_cat.stdout() or "").strip()
                        if b64 and b64 != "__SKIP__":
                            data.append({"path": p, "encoding": "base64", "content": b64})
                    except Exception:
                        continue
            return {"files": files, "created": created, "updated": updated, "deleted": deleted, "data": data}
        except Exception as e:
            return {"files": [], "error": str(e)}

    if detached:
        if should_wait:
            tasks: list[asyncio.Task] = [asyncio.create_task(_stream_logs()), asyncio.create_task(_wait_for_exit())]
            # Only start the timer when readiness/port provided (long-running service)
            if ready_deadline is not None:
                tasks.append(asyncio.create_task(_timer()))
            await stop_event.wait()
            # Cancel any remaining tasks
            for t in tasks:
                if not t.done():
                    t.cancel()
            output = {"started": True}
            if preview_url:
                output["preview_url"] = preview_url
            output.update({
                "ready": ready,
                "timed_out": timed_out,
                "exited_early": exited_early,
                **({"exit_code": exit_code} if exit_code is not None else {}),
            })
        else:
            # No readiness criteria given; don't block. Return immediately as started.
            output = {"started": True}
        output["fs"] = await _snapshot_files()
    else:
        # attached: stream logs until process exits
        tasks_attached: list[asyncio.Task] = [asyncio.create_task(_stream_logs()), asyncio.create_task(_wait_for_exit())]
        await stop_event.wait()
        for t in tasks_attached:
            if not t.done():
                t.cancel()
        output = {
            **({"preview_url": preview_url} if preview_url else {}),
            "ready": ready,
            "timed_out": timed_out,
            "exited_early": exited_early,
            **({"exit_code": exit_code} if exit_code is not None else {}),
        }
        output["fs"] = await _snapshot_files()
    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "sandbox_run",
            "output_data": output,
        }
    )
    # Prepare a summary string for the LLM that includes a trimmed log transcript
    try:
        # Build log snippet (last N characters to avoid overflow)
        logs_text = "".join(collected_logs)
        MAX_CHARS = 16000
        trimmed = False
        if len(logs_text) > MAX_CHARS:
            logs_text = logs_text[-MAX_CHARS:]
            trimmed = True

        status = (
            "ready" if ready else ("timed_out" if timed_out else ("exited" if exited_early else "started"))
        )

        fs = output.get("fs") or {}
        created = fs.get("created") or []
        updated = fs.get("updated") or []
        deleted = fs.get("deleted") or []
        files_total = len(fs.get("files") or [])

        parts = [
            f"sandbox_run completed (name={sb_name})",
            f"status={status}",
            *( [f"preview_url={output.get('preview_url')}"] if output.get("preview_url") else [] ),
            *( [f"exit_code={output.get('exit_code')}"] if output.get("exit_code") is not None else [] ),
            f"fs: files_total={files_total} created={len(created)} updated={len(updated)} deleted={len(deleted)}",
            ("logs (trimmed to last " + str(MAX_CHARS) + " chars):" if trimmed else "logs:"),
            logs_text,
        ]
        summary = "\n".join(parts)
    except Exception:
        summary = "sandbox_run completed"
    return summary


# Simple helper for the agent to emit a preview URL for the running sandbox
@function_tool
async def sandbox_show_preview(
    ctx: RunContextWrapper[IDEContext], url: str, port: Optional[int] = None, label: Optional[str] = None, name: Optional[str] = None
) -> str:
    """Emit a preview URL for the active sandbox so the UI can render it.

    Args:
        url: The full preview URL.
        port: Optional port used by the service.
        label: Optional descriptive label (e.g., 'frontend', 'backend').
    Returns:
        JSON with preview info.
    """
    tool_id = f"tc_{len(ctx.context.events)+1}"
    sb_name = _normalize_sandbox_name(ctx, name)
    args = {"url": url, "port": port, "label": label, "name": sb_name}
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "sandbox_show_preview",
            "arguments": args,
        }
    )
    output = {"url": url, **({"port": port} if port else {}), **({"label": label} if label else {}), "name": sb_name}
    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "sandbox_show_preview",
            "output_data": output,
        }
    )
    return json.dumps(output)



@function_tool
async def sandbox_set_env(ctx: RunContextWrapper[IDEContext], env: List[str], name: Optional[str] = None) -> str:
    """Set default environment variables for subsequent sandbox_run commands for a named sandbox (or active/default)."""
    tool_id = f"tc_{len(ctx.context.events)+1}"
    sb_name = _normalize_sandbox_name(ctx, name)
    args = {"env": env, "name": sb_name}
    ctx.context.events.append(
        {
            "phase": "started",
            "tool_id": tool_id,
            "name": "sandbox_set_env",
            "arguments": args,
        }
    )
    parsed = _parse_env_list(env)
    # Back-compat: also update global
    ctx.context.sandbox_env.update(parsed)
    # Per-sandbox env
    per_env = dict(ctx.context.sandbox_envs.get(sb_name, {}))
    for k, v in parsed.items():
        if k not in per_env:
            per_env[k] = v
    ctx.context.sandbox_envs[sb_name] = per_env
    output = {"ok": True, "env_keys": list(parsed.keys()), "name": sb_name}
    ctx.context.events.append(
        {
            "phase": "completed",
            "tool_id": tool_id,
            "name": "sandbox_set_env",
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
            suffix = path[len(old_norm) :]
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
