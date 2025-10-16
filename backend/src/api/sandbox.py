import asyncio
import os
from typing import Any, AsyncGenerator

from pydantic import BaseModel
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from vercel.sandbox import Sandbox

from src.auth import make_stream_token, read_stream_token
from src.agent.utils import make_ignore_predicate
from src.sse import (
    SSE_HEADERS,
    sse_format,
    emit_event,
)


router = APIRouter(prefix="/api/play", tags=["play"])


class PlayRequest(BaseModel):
    """Payload to start a remote sandbox execution for a given project entry file."""

    user_id: str
    project: dict[str, str]
    entry_path: str
    runtime: str | None = None
    env: dict[str, str] | None = None


def _detect_runtime_and_command(
    entry_path: str, runtime_override: str | None
) -> tuple[str | None, str | None]:
    entry = entry_path.lower()
    if runtime_override:
        if runtime_override.startswith("python"):
            return runtime_override, (
                f'PYBIN=$(command -v python3 || command -v python) && [ -n "$PYBIN" ] && "$PYBIN" {entry_path}'
            )
        if runtime_override.startswith("node"):
            if entry.endswith(".ts") or entry.endswith(".tsx"):
                return (
                    runtime_override,
                    f"(npx -y ts-node {entry_path} || npx -y tsx {entry_path} || node {entry_path})",
                )
            return runtime_override, f"(node {entry_path})"
        return runtime_override, f"(python3 {entry_path} || node {entry_path})"

    if entry.endswith(".py"):
        return "python3.13", (
            f'PYBIN=$(command -v python3 || command -v python) && [ -n "$PYBIN" ] && "$PYBIN" {entry_path}'
        )
    if entry.endswith(".js") or entry.endswith(".mjs") or entry.endswith(".cjs"):
        return "node22", f"(node {entry_path})"
    if entry.endswith(".ts") or entry.endswith(".tsx"):
        return "node22", f"(npx -y tsx {entry_path} || npx -y ts-node {entry_path})"
    if entry.endswith(".rb"):
        return "ruby3.2", f"(ruby {entry_path})"
    return None, None


async def run_play_flow(
    payload: dict[str, Any], task_id: str
) -> AsyncGenerator[str, None]:
    # Filter project before syncing to sandbox
    project: dict[str, str] = payload.get("project", {})
    is_ignored = make_ignore_predicate(project)
    filtered_project: dict[str, str] = {
        p: c
        for p, c in project.items()
        if (not is_ignored(p)) or (p in {".gitignore", ".agentignore"})
    }
    entry_path: str = payload.get("entry_path", "")
    runtime_override: str | None = payload.get("runtime")
    env: dict[str, str] = payload.get("env", {}) or {}

    runtime, command = _detect_runtime_and_command(entry_path, runtime_override)
    if command is None:
        yield sse_format(
            emit_event(
                task_id, "play_failed", error=f"Unsupported entry file: {entry_path}"
            )
        )
        return

    # Ensure entry file content available even if ignored
    content = filtered_project.get(entry_path) or project.get(entry_path) or ""
    is_fastapi = entry_path.lower().endswith(".py") and (
        "FastAPI(" in content
        or "from fastapi" in content
        or "import fastapi" in content
    )
    is_ruby = entry_path.lower().endswith(".rb")
    port = (
        int(os.getenv("SANDBOX_APP_PORT", "8000"))
        if is_fastapi
        else (4567 if is_ruby else None)
    )

    yield sse_format(
        emit_event(
            task_id,
            "play_started",
            data={"entry_path": entry_path, "runtime": runtime or "auto"},
        )
    )

    def _find_closest_file(
        pmap: dict[str, str], start_path: str, names: list[str]
    ) -> str | None:
        cur_dir = os.path.dirname(start_path)
        visited: set[str] = set()
        while True:
            for n in names:
                candidate = os.path.normpath(os.path.join(cur_dir, n)) if cur_dir else n
                candidate = candidate.lstrip("./")
                if candidate in pmap:
                    return candidate
            if cur_dir in visited:
                break
            visited.add(cur_dir)
            if not cur_dir:
                break
            parent = os.path.dirname(cur_dir)
            if parent == cur_dir:
                break
            cur_dir = parent
        for n in names:
            if n in pmap:
                return n
        return None

    sandbox = None
    try:
        if is_fastapi and port:
            sandbox = await Sandbox.create(
                timeout=600_000, runtime=runtime, ports=[port]
            )
        else:
            sandbox = await Sandbox.create(timeout=600_000, runtime=runtime)
        try:
            yield sse_format(
                emit_event(
                    task_id,
                    "play_sandbox",
                    data={
                        "sandbox_id": sandbox.sandbox_id,
                        "status": getattr(sandbox, "status", None),
                    },
                )
            )
        except Exception:
            pass

        files_payload = []
        for path, content in filtered_project.items():
            try:
                files_payload.append({"path": path, "content": content.encode("utf-8")})
            except Exception:
                files_payload.append(
                    {"path": path, "content": bytes(str(content), "utf-8")}
                )
        if files_payload:
            for i in range(0, len(files_payload), 64):
                chunk = files_payload[i : i + 64]
                attempt = 0
                while True:
                    try:
                        await sandbox.write_files(chunk)
                        break
                    except Exception as e:
                        attempt += 1
                        if attempt > 3:
                            raise
                        yield sse_format(
                            emit_event(
                                task_id,
                                "play_log",
                                data=f"Retrying file sync ({attempt}/3) due to error: {str(e)}\n",
                            )
                        )
                        await asyncio.sleep(0.25 * (2 ** (attempt - 1)))

        try:
            if entry_path.lower().endswith(".py"):
                req_path = _find_closest_file(
                    filtered_project, entry_path, ["requirements.txt"]
                )  # basic support
                if req_path:
                    yield sse_format(
                        emit_event(
                            task_id,
                            "play_log",
                            data=f"Installing Python dependencies from {req_path}...\n",
                        )
                    )
                    pip_cmd = (
                        "PYBIN=$(command -v python3 || command -v python); "
                        "if [ -z \"$PYBIN\" ]; then echo 'python not found in sandbox'; exit 1; fi; "
                        "$PYBIN -m ensurepip --upgrade || true; "
                        "$PYBIN -m pip install --upgrade pip; "
                        f"$PYBIN -m pip install --no-cache-dir -r {req_path}"
                    )
                    install_cmd = await sandbox.run_command_detached(
                        "bash",
                        ["-lc", f"cd {sandbox.sandbox.cwd} && {pip_cmd}"],
                    )
                    async for line in install_cmd.logs():
                        yield sse_format(
                            emit_event(task_id, "play_log", data=line.data)
                        )
                    install_done = await install_cmd.wait()
                    if install_done.exit_code != 0:
                        yield sse_format(
                            emit_event(
                                task_id,
                                "play_failed",
                                error=f"Dependency install failed (exit {install_done.exit_code})",
                            )
                        )
                        return

                if is_fastapi:
                    yield sse_format(
                        emit_event(
                            task_id,
                            "play_log",
                            data="Ensuring FastAPI and Uvicorn are installed...\n",
                        )
                    )
                    ensure_cmd = await sandbox.run_command_detached(
                        "bash",
                        [
                            "-lc",
                            (
                                "PYBIN=$(command -v python3 || command -v python); "
                                "if [ -z \"$PYBIN\" ]; then echo 'python not found in sandbox'; exit 1; fi; "
                                '$PYBIN -c "import fastapi, uvicorn" '
                                "|| ("
                                "$PYBIN -m pip install --upgrade pip || true; "
                                "$PYBIN -m pip install --no-cache-dir fastapi uvicorn"
                                ")"
                            ),
                        ],
                    )
                    async for line in ensure_cmd.logs():
                        yield sse_format(
                            emit_event(task_id, "play_log", data=line.data)
                        )
                    ensure_done = await ensure_cmd.wait()
                    if ensure_done.exit_code != 0:
                        yield sse_format(
                            emit_event(
                                task_id,
                                "play_failed",
                                error=f"Failed to install FastAPI/Uvicorn (exit {ensure_done.exit_code})",
                            )
                        )
                        return
            elif entry_path.lower().endswith(".rb"):
                gemfile_path = _find_closest_file(
                    filtered_project, entry_path, ["Gemfile"]
                )
                if gemfile_path:
                    try:
                        yield sse_format(
                            emit_event(
                                task_id,
                                "play_log",
                                data=f"Installing Ruby dependencies from {gemfile_path} via Bundler...\n",
                            )
                        )
                    except Exception:
                        pass
                    bundler_install_cmd = (
                        "if ! command -v bundle >/dev/null 2>&1; then "
                        "gem list -i bundler >/dev/null 2>&1 || gem install --no-document bundler; "
                        "fi; "
                        "bundle --version || true; "
                        "mkdir -p vendor/bundle; "
                        "bundle config set --local path vendor/bundle; "
                        "bundle config set --local without 'development:test'; "
                        "bundle install"
                    )
                    install_cmd = await sandbox.run_command_detached(
                        "bash",
                        ["-lc", f"cd {sandbox.sandbox.cwd} && {bundler_install_cmd}"],
                    )
                    async for line in install_cmd.logs():
                        yield sse_format(
                            emit_event(task_id, "play_log", data=line.data)
                        )
                    install_done = await install_cmd.wait()
                    if install_done.exit_code != 0:
                        yield sse_format(
                            emit_event(
                                task_id,
                                "play_failed",
                                error=f"Dependency install failed (exit {install_done.exit_code})",
                            )
                        )
                        return
            elif entry_path.lower().endswith((".js", ".mjs", ".cjs", ".ts", ".tsx")):
                pkg_json = _find_closest_file(
                    filtered_project, entry_path, ["package.json"]
                )  # npm project
                if pkg_json:
                    pkg_dir = os.path.dirname(pkg_json)
                    cd_part = f"cd {pkg_dir} && " if pkg_dir else ""
                    lock_path = (
                        (pkg_dir + "/package-lock.json")
                        if pkg_dir
                        else "package-lock.json"
                    )
                    npm_install = (
                        "npm ci --loglevel info"
                        if lock_path in filtered_project
                        else "npm install --loglevel info"
                    ) + " || npm install --loglevel info"
                    yield sse_format(
                        emit_event(
                            task_id,
                            "play_log",
                            data=f"Installing Node dependencies in {(pkg_dir or '.')}...\n",
                        )
                    )
                    install_cmd = await sandbox.run_command_detached(
                        "bash",
                        ["-lc", f"cd {sandbox.sandbox.cwd} && {cd_part}{npm_install}"],
                    )
                    async for line in install_cmd.logs():
                        yield sse_format(
                            emit_event(task_id, "play_log", data=line.data)
                        )
                    install_done = await install_cmd.wait()
                    if install_done.exit_code != 0:
                        yield sse_format(
                            emit_event(
                                task_id,
                                "play_failed",
                                error=f"Dependency install failed (exit {install_done.exit_code})",
                            )
                        )
                        return
        except Exception as e:
            yield sse_format(
                emit_event(
                    task_id, "play_failed", error=f"Dependency install error: {str(e)}"
                )
            )
            return

        preview_sent = False

        if is_fastapi and port:
            runner_code = (
                "import importlib.util, os\n"
                "entry = os.environ.get('ENTRY_PATH','main.py')\n"
                "app_var = os.environ.get('APP_VAR','app')\n"
                "spec = importlib.util.spec_from_file_location('app_module', entry)\n"
                "mod = importlib.util.module_from_spec(spec)\n"
                "spec.loader.exec_module(mod)\n"
                "app = getattr(mod, app_var)\n"
                "import uvicorn\n"
                "uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('PORT','8000')))\n"
            ).encode("utf-8")
            await sandbox.write_files(
                [
                    {"path": "run_fastapi.py", "content": runner_code},
                ]
            )
            env_to_use = {
                **env,
                "ENTRY_PATH": entry_path,
                "APP_VAR": "app",
                "PORT": str(port),
            }
            cmd = await sandbox.run_command_detached(
                "bash",
                [
                    "-lc",
                    f'cd {sandbox.sandbox.cwd} && PYBIN=$(command -v python3 || command -v python) && exec "$PYBIN" run_fastapi.py',
                ],
                env=env_to_use,
            )
        else:
            command_to_run = command
            if is_ruby:
                command_to_run = (
                    f"( [ -f Gemfile ] && bundle exec {command} || {command} )"
                )
            cmd = await sandbox.run_command_detached(
                "bash",
                [
                    "-lc",
                    f"cd {sandbox.sandbox.cwd} && {command_to_run}",
                ],
                env=env,
            )

        async for line in cmd.logs():
            yield sse_format(emit_event(task_id, "play_log", data=line.data))
            if (
                is_fastapi
                and not preview_sent
                and (
                    ("Application startup complete" in line.data)
                    or ("Uvicorn running on" in line.data)
                )
            ):
                try:
                    url = sandbox.domain(port) if port else None
                except Exception:
                    url = None
                if url:
                    yield sse_format(
                        emit_event(
                            task_id,
                            "play_preview",
                            data={"url": url, "port": port},
                        )
                    )
                    preview_sent = True
            if (
                is_ruby
                and not preview_sent
                and (
                    ("Listening on" in line.data)
                    or ("tcp://0.0.0.0:" in line.data)
                    or ("Sinatra has taken the stage" in line.data)
                )
            ):
                try:
                    url = sandbox.domain(port) if port else None
                except Exception:
                    url = None
                if url:
                    yield sse_format(
                        emit_event(
                            task_id,
                            "play_preview",
                            data={"url": url, "port": port},
                        )
                    )
                    preview_sent = True

        done = await cmd.wait()
        if done.exit_code == 0:
            yield sse_format(
                emit_event(task_id, "play_complete", data={"exit_code": done.exit_code})
            )
        else:
            yield sse_format(
                emit_event(
                    task_id,
                    "play_failed",
                    error=f"Process exited with code {done.exit_code}",
                )
            )
    except Exception as e:
        yield sse_format(emit_event(task_id, "play_failed", error=str(e)))
    finally:
        try:
            if sandbox is not None:
                await sandbox.client.aclose()
        except Exception:
            pass


@router.post("")
async def create_play(request: PlayRequest) -> dict[str, Any]:
    task_id = f"task_{int(asyncio.get_event_loop().time() * 1000)}_{os.getpid()}"
    stream_token = make_stream_token(
        {
            "user_id": request.user_id,
            "project": request.project,
            "entry_path": request.entry_path,
            "runtime": request.runtime,
            "env": request.env or {},
        }
    )
    return {"task_id": task_id, "stream_token": stream_token}


@router.get("/{play_id}/events")
async def play_events(play_id: str, token: str):
    payload = read_stream_token(token)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            async for chunk in run_play_flow(payload, play_id):
                yield chunk
        except Exception as e:
            yield sse_format(emit_event(play_id, "play_failed", error=str(e)))

    return StreamingResponse(event_generator(), headers=SSE_HEADERS)


@router.delete("/{play_id}")
async def stop_play_delete(
    play_id: str, token: str, sandbox_id: str | None = None
) -> dict[str, Any]:
    _ = read_stream_token(token)
    if not sandbox_id:
        return {"ok": False, "error": "missing sandbox_id"}
    try:
        fetched = await Sandbox.get(sandbox_id=sandbox_id)
        await fetched.stop()
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "stopped": True}


@router.get("/probe")
async def probe_url(url: str) -> dict[str, Any]:
    """Server-side URL probe.

    Attempts a HEAD request first to avoid downloading the body.
    Some servers do not support HEAD; in that case, fall back to a
    streamed GET to obtain only the status code.
    """
    import httpx

    status_code: int | None = None
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8.0) as client:
            try:
                resp = await client.request("HEAD", url)
                status_code = int(resp.status_code)
            except Exception:
                # Fall back to a minimal GET (streamed, do not read body)
                try:
                    async with client.stream("GET", url) as resp2:
                        status_code = int(resp2.status_code)
                except Exception:
                    status_code = None
    except Exception:
        status_code = None

    return {"ok": status_code is not None, "status": status_code}
