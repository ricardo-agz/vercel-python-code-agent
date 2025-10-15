from vercel.sandbox import AsyncSandbox as Sandbox
from agents import RunContextWrapper
from typing import Any

from src.agent.context import IDEContext
from src.sandbox.cache import SANDBOX_CACHE
from src.agent.utils import make_ignore_predicate


def normalize_sandbox_name(ctx: RunContextWrapper[IDEContext], name: str | None) -> str:
    """Resolve the effective sandbox name.

    Prefers the provided name; otherwise uses the active name if set; otherwise "default".
    Also sets the active name if not set previously.
    """
    n = (name or ctx.context.active_sandbox or "default").strip() or "default"
    if not ctx.context.active_sandbox:
        ctx.context.active_sandbox = n
    return n


async def snapshot_files_into_context(
    ctx: RunContextWrapper[IDEContext], sandbox: Sandbox, name: str
) -> None:
    """Snapshot filesystem and record per-sandbox state."""
    try:
        cmd_ls = await sandbox.run_command(
            "bash",
            [
                "-lc",
                (
                    f"cd {sandbox.sandbox.cwd} && "
                    "find . \\ ( -path './.git/*' -o -path './node_modules/*' -o -path './vendor/*' -o -path './.bundle/*' -o -path './.cache/*' -o -path './tmp/*' -o -path './log/*' -o -path './logs/*' \\ ) -prune -o -type f -printf '%P\t%T@\t%s\n' 2>/dev/null | sort"
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
            filtered_current: dict[str, str] = {
                p: meta for p, meta in current.items() if not is_ignored(p)
            }
        except Exception:
            filtered_files = files
            filtered_current = current
        # Per-sandbox maps
        ctx.context.sandbox_files_map[name] = filtered_files
        ctx.context.sandbox_file_meta_map[name] = filtered_current
    except Exception:
        # Non-fatal
        pass


async def get_sandbox_by_name(ctx: RunContextWrapper[IDEContext], name: str) -> Sandbox:
    """Get or create a sandbox by name (multi-sandbox only)."""
    # If we have a mapping, fetch from cache or remote
    sid = (ctx.context.sandbox_name_to_id or {}).get(name)
    if sid and sid in SANDBOX_CACHE:
        return SANDBOX_CACHE[sid]
    if sid:
        fetched = await Sandbox.get(sandbox_id=sid)
        SANDBOX_CACHE[sid] = fetched
        return fetched
    # Create a new sandbox with stored preferences
    runtime = (ctx.context.sandbox_runtime_map or {}).get(name)
    ports = (ctx.context.sandbox_ports_map or {}).get(name)
    sandbox = await Sandbox.create(
        timeout=600_000,
        runtime=runtime,
        ports=ports,
    )
    ctx.context.sandbox_name_to_id[name] = sandbox.sandbox_id
    ctx.context.active_sandbox = name
    SANDBOX_CACHE[sandbox.sandbox_id] = sandbox
    try:
        await sync_project_files(ctx, sandbox)
        await snapshot_files_into_context(ctx, sandbox, name)
    except Exception:
        pass
    return sandbox


async def sync_project_files(
    ctx: RunContextWrapper[IDEContext], sandbox: Sandbox
) -> int:
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


def parse_env_list(env_list: list[str] | None) -> dict[str, str]:
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


async def snapshot_file_changes(
    ctx: RunContextWrapper[IDEContext],
    sandbox: Sandbox,
    name: str,
    *,
    sample_limit: int = 50,
    max_sample_size: int = 200_000,
) -> dict[str, Any]:
    """Compute filesystem changes since last snapshot and optionally sample small files.

    Returns a dict with keys: files, created, updated, deleted, data (base64 samples) or error.
    Also refreshes `sandbox_files_map` and `sandbox_file_meta_map` in the context.
    """
    try:
        cmd_ls = await sandbox.run_command(
            "bash",
            [
                "-lc",
                (
                    f"cd {sandbox.sandbox.cwd} && "
                    "find . \\\ ( -path './.git/*' -o -path './node_modules/*' -o -path './vendor/*' -o -path './.bundle/*' -o -path './.cache/*' -o -path './tmp/*' -o -path './log/*' -o -path './logs/*' -o -path './venv/*' \\\ ) -prune -o -type f -printf '%P\t%T@\t%s\n' 2>/dev/null | sort"
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

        # Diff with previous snapshot
        prev = (ctx.context.sandbox_file_meta_map or {}).get(name, {})
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

        # Apply ignore rules
        try:
            is_ignored = make_ignore_predicate(ctx.context.project or {})
            files = [p for p in files if not is_ignored(p)]
            current = {p: meta for p, meta in current.items() if not is_ignored(p)}
            created = [p for p in created if not is_ignored(p)]
            updated = [p for p in updated if not is_ignored(p)]
            deleted = [p for p in deleted if not is_ignored(p)]
        except Exception:
            pass

        # Update context snapshots
        ctx.context.sandbox_files_map[name] = files
        ctx.context.sandbox_file_meta_map[name] = current

        # Sample newly created/updated small files
        data: list[dict[str, Any]] = []
        sample_paths = created + updated
        if sample_paths:
            for p in sample_paths[:sample_limit]:
                try:
                    safe = p.replace('"', '\\"')
                    cmd_cat = await sandbox.run_command(
                        "bash",
                        [
                            "-lc",
                            (
                                f"cd {sandbox.sandbox.cwd} && "
                                f"if [ -f '{safe}' ] && [ $(stat -c %s '{safe}' 2>/dev/null || stat -f %z '{safe}') -le {max_sample_size} ]; then "
                                f"base64 '{safe}'; else echo '__SKIP__'; fi"
                            ),
                        ],
                    )
                    b64 = (await cmd_cat.stdout() or "").strip()
                    if b64 and b64 != "__SKIP__":
                        data.append({"path": p, "encoding": "base64", "content": b64})
                except Exception:
                    continue

        return {
            "files": files,
            "created": created,
            "updated": updated,
            "deleted": deleted,
            "data": data,
        }
    except Exception as e:
        return {"files": [], "error": str(e)}
