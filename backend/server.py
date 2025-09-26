import os
import logging
import traceback
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Any
from collections.abc import AsyncGenerator
import asyncio
import time
import uuid
from vercel.sandbox import Sandbox
from pydantic import BaseModel
import httpx

# Early environment loading BEFORE importing agents
try:
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    load_dotenv(os.path.join(root, ".env"), override=False)
except Exception:
    pass

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


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_MODELS: list[str] = [
    "openai/gpt-4.1",
    "openai/gpt-4.1-mini",
    "openai/gpt-5",
    "openai/gpt-5-mini",
    # "anthropic/claude-4-sonnet",
    # "anthropic/claude-3.7-sonnet",
    # "anthropic/claude-3.5-haiku",
    # "xai/grok-4",
    # "xai/grok-4-fast-non-reasoning",
]

SLEEP_INTERVAL_SECONDS = 0.05

# Basic logger for server diagnostics (inherits uvicorn handlers)
logger = logging.getLogger("ide_agent.server")
if not logger.handlers:
    logger.setLevel(logging.INFO)


class RunRequest(BaseModel):
    """Payload to start a new agent run and get an SSE resume token."""

    user_id: str
    message_history: list[dict[str, str]]
    query: str
    project: dict[str, str]
    model: str | None = None


def make_task_id() -> str:
    return f"task_{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}"


class PlayRequest(BaseModel):
    """Payload to start a remote sandbox execution for a given project entry file."""

    user_id: str
    project: dict[str, str]
    entry_path: str  # path within project mapping to execute
    runtime: str | None = None  # optional override, e.g., "python311" or "node22"
    env: dict[str, str] | None = None


async def run_agent_flow(
    payload: dict[str, Any], task_id: str
) -> AsyncGenerator[str, None]:
    """Run the agent and stream tool progress as SSE chunks."""
    try:
        # Log incoming payload summary (redacted)
        logger.info("run[%s] start model=%s project_files=%d history=%d", task_id, payload.get("model"), len(payload.get("project", {})), len(payload.get("message_history", [])))
    except Exception:
        pass
    base_payload = {
        "user_id": payload["user_id"],
        "query": payload["query"],
        "project": payload["project"],
        "message_history": payload.get("message_history", []),
        "model": payload.get("model"),
    }

    # Pass full message history (user+assistant) when available; fallback to assistant-only
    history = payload.get("message_history", [])
    assistant_only = [
        m["content"] for m in history if m.get("role") == "assistant" and m.get("content")
    ]
    input_text = build_project_input(payload["query"], payload["project"], history or assistant_only)

    context = IDEContext(project=payload["project"], base_payload=base_payload)

    # Select agent (optionally with model override)
    selected_model = payload.get("model")
    agent_instance = create_ide_agent(selected_model) if selected_model else ide_agent

    run_task = asyncio.create_task(
        Runner.run(
            agent_instance,
            input=input_text,
            context=context,
            max_turns=10,
        )
    )
    yield sse_format(emit_event(task_id, "run_log", data="Agent run scheduled"))

    last_idx = 0
    result = None
    try:
        while not run_task.done():
            # Flush new events
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
        yield sse_format(emit_event(task_id, "run_log", data=f"Exception: {str(e)}\n{tb}"))
        yield sse_format(emit_event(task_id, "run_failed", error=str(e)))
        return

    # Flush any remaining events after completion
    while last_idx < len(context.events):
        ev = context.events[last_idx]
        last_idx += 1
        if ev.get("phase") == "started":
            yield tool_started_sse(task_id, ev)
        elif ev.get("phase") == "completed":
            yield tool_completed_sse(task_id, ev, base_payload, context.project)

    # If deferred, stop now (resume token already emitted)
    if context.defer_requested:
        return

    # Otherwise emit final output
    if result and result.final_output:
        yield sse_format(
            emit_event(task_id, "agent_output", data=str(result.final_output))
        )
    else:
        logger.warning("run[%s] completed with no output", task_id)
        yield sse_format(emit_event(task_id, "run_log", data="No final_output produced"))
        yield sse_format(emit_event(task_id, "run_failed", error="No output produced."))


def _detect_runtime_and_command(entry_path: str, runtime_override: str | None) -> tuple[str | None, str | None]:
    """Decide sandbox runtime and shell command based on entry file extension or override.

    Returns (runtime, bash_command). If unsupported, returns (None, None).
    """
    entry = entry_path.lower()
    if runtime_override:
        # Best-effort command selection with explicit runtime
        if runtime_override.startswith("python"):
            return runtime_override, (
                f"PYBIN=$(command -v python3 || command -v python) && [ -n \"$PYBIN\" ] && \"$PYBIN\" {entry_path}"
            )
        if runtime_override.startswith("node"):
            if entry.endswith(".ts") or entry.endswith(".tsx"):
                return runtime_override, f"(npx -y ts-node {entry_path} || npx -y tsx {entry_path} || node {entry_path})"
            return runtime_override, f"(node {entry_path})"
        # Fallback: use provided runtime but naive command
        return runtime_override, f"(python3 {entry_path} || node {entry_path})"

    if entry.endswith(".py"):
        # Default to Python runtime so pip is present (align with sandbox examples)
        return "python3.13", (
            f"PYBIN=$(command -v python3 || command -v python) && [ -n \"$PYBIN\" ] && \"$PYBIN\" {entry_path}"
        )
    if entry.endswith(".js") or entry.endswith(".mjs") or entry.endswith(".cjs"):
        return "node22", f"(node {entry_path})"
    if entry.endswith(".ts") or entry.endswith(".tsx"):
        # Use npx so we don't rely on package.json; tsx tends to be faster
        return "node22", f"(npx -y tsx {entry_path} || npx -y ts-node {entry_path})"
    return None, None


async def run_play_flow(payload: dict[str, Any], task_id: str) -> AsyncGenerator[str, None]:
    """Run the provided project entry file in a Vercel Sandbox and stream logs via SSE.

    For FastAPI apps, run uvicorn and emit a preview URL once the server is ready.
    """
    project: dict[str, str] = payload.get("project", {})
    entry_path: str = payload.get("entry_path", "")
    runtime_override: str | None = payload.get("runtime")
    env: dict[str, str] = payload.get("env", {}) or {}

    # Decide runtime and command
    runtime, command = _detect_runtime_and_command(entry_path, runtime_override)
    if command is None:
        yield sse_format(emit_event(task_id, "play_failed", error=f"Unsupported entry file: {entry_path}"))
        return

    # Determine if this looks like a FastAPI app
    content = project.get(entry_path, "") or ""
    is_fastapi = (
        entry_path.lower().endswith(".py")
        and (
            "FastAPI(" in content
            or "from fastapi" in content
            or "import fastapi" in content
        )
    )
    port = int(os.getenv("SANDBOX_APP_PORT", "8000")) if is_fastapi else None

    # Announce start
    yield sse_format(
        emit_event(
            task_id,
            "play_started",
            data={"entry_path": entry_path, "runtime": runtime or "auto"},
        )
    )

    # Helper: find closest file up the directory tree
    def _find_closest_file(pmap: dict[str, str], start_path: str, names: list[str]) -> str | None:
        cur_dir = os.path.dirname(start_path)
        visited: set[str] = set()
        while True:
            for n in names:
                candidate = os.path.normpath(os.path.join(cur_dir, n)) if cur_dir else n
                # Normalize to remove leading './'
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
        # Also check project root as fallback
        for n in names:
            if n in pmap:
                return n
        return None

    # Create and use sandbox (manual lifecycle; no context manager so Stop can control teardown)
    sandbox = None
    try:
        # Create sandbox; expose port if running a FastAPI server
        if is_fastapi and port:
            sandbox = await Sandbox.create(timeout=600_000, runtime=runtime, ports=[port])
        else:
            sandbox = await Sandbox.create(timeout=600_000, runtime=runtime)
        # Inform client of sandbox id/state for stateless stop later
        try:
            yield sse_format(
                emit_event(
                    task_id,
                    "play_sandbox",
                    data={"sandbox_id": sandbox.sandbox_id, "status": getattr(sandbox, "status", None)},
                )
            )
        except Exception:
            pass
        # Write all files to the sandbox working directory (chunked to avoid 500s on rapid restarts)
        files_payload = []
        for path, content in project.items():
            try:
                files_payload.append({"path": path, "content": content.encode("utf-8")})
            except Exception:
                files_payload.append({"path": path, "content": bytes(str(content), "utf-8")})
        if files_payload:
            # Chunk by 64 files and backoff retry on transient errors
            for i in range(0, len(files_payload), 64):
                chunk = files_payload[i:i+64]
                attempt = 0
                while True:
                    try:
                        await sandbox.write_files(chunk)
                        break
                    except Exception as e:
                        attempt += 1
                        if attempt > 3:
                            raise
                        yield sse_format(emit_event(task_id, "play_log", data=f"Retrying file sync ({attempt}/3) due to error: {str(e)}\n"))
                        await asyncio.sleep(0.25 * (2 ** (attempt - 1)))

        # Optional dependency installation step
        try:
            if entry_path.lower().endswith(".py"):
                req_path = _find_closest_file(project, entry_path, ["requirements.txt"])  # basic support
                if req_path:
                    yield sse_format(emit_event(task_id, "play_log", data=f"Installing Python dependencies from {req_path}...\n"))
                    # Use the sandbox-detected python binary for reliability
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
                        yield sse_format(emit_event(task_id, "play_log", data=line.data))
                    install_done = await install_cmd.wait()
                    if install_done.exit_code != 0:
                        yield sse_format(emit_event(task_id, "play_failed", error=f"Dependency install failed (exit {install_done.exit_code})"))
                        return

                # If it's a FastAPI app, ensure fastapi and uvicorn are present
                if is_fastapi:
                    yield sse_format(emit_event(task_id, "play_log", data="Ensuring FastAPI and Uvicorn are installed...\n"))
                    ensure_cmd = await sandbox.run_command_detached(
                        "bash",
                        [
                            "-lc",
                            (
                                "PYBIN=$(command -v python3 || command -v python); "
                                "if [ -z \"$PYBIN\" ]; then echo 'python not found in sandbox'; exit 1; fi; "
                                "$PYBIN -c \"import fastapi, uvicorn\" "
                                "|| ("
                                "$PYBIN -m pip install --upgrade pip || true; "
                                "$PYBIN -m pip install --no-cache-dir fastapi uvicorn"
                                ")"
                            ),
                        ],
                    )
                    async for line in ensure_cmd.logs():
                        yield sse_format(emit_event(task_id, "play_log", data=line.data))
                    ensure_done = await ensure_cmd.wait()
                    if ensure_done.exit_code != 0:
                        yield sse_format(emit_event(task_id, "play_failed", error=f"Failed to install FastAPI/Uvicorn (exit {ensure_done.exit_code})"))
                        return
            elif entry_path.lower().endswith((".js", ".mjs", ".cjs", ".ts", ".tsx")):
                pkg_json = _find_closest_file(project, entry_path, ["package.json"])  # npm project
                if pkg_json:
                    pkg_dir = os.path.dirname(pkg_json)
                    cd_part = f"cd {pkg_dir} && " if pkg_dir else ""
                    # Prefer npm ci if lockfile exists in same dir
                    lock_path = (pkg_dir + "/package-lock.json") if pkg_dir else "package-lock.json"
                    # Prefer CI when lock present; add fallback to plain npm install
                    npm_install = (
                        "npm ci --loglevel info" if lock_path in project else "npm install --loglevel info"
                    ) + " || npm install --loglevel info"
                    yield sse_format(emit_event(task_id, "play_log", data=f"Installing Node dependencies in {(pkg_dir or '.') }...\n"))
                    install_cmd = await sandbox.run_command_detached(
                        "bash",
                        ["-lc", f"cd {sandbox.sandbox.cwd} && {cd_part}{npm_install}"],
                    )
                    async for line in install_cmd.logs():
                        yield sse_format(emit_event(task_id, "play_log", data=line.data))
                    install_done = await install_cmd.wait()
                    if install_done.exit_code != 0:
                        yield sse_format(emit_event(task_id, "play_failed", error=f"Dependency install failed (exit {install_done.exit_code})"))
                        return
        except Exception as e:
            yield sse_format(emit_event(task_id, "play_failed", error=f"Dependency install error: {str(e)}"))
            return

        # Run the command from the sandbox CWD
        preview_sent = False

        if is_fastapi and port:
            # Write a small runner to import app object from the entry file and run uvicorn
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
            await sandbox.write_files([
                {"path": "run_fastapi.py", "content": runner_code},
            ])
            env_to_use = {**env, "ENTRY_PATH": entry_path, "APP_VAR": "app", "PORT": str(port)}
            cmd = await sandbox.run_command_detached(
                "bash",
                [
                    "-lc",
                    f"cd {sandbox.sandbox.cwd} && PYBIN=$(command -v python3 || command -v python) && exec \"$PYBIN\" run_fastapi.py",
                ],
                env=env_to_use,
            )
            # No server-side session retained; client uses sandbox_id to stop
        else:
            cmd = await sandbox.run_command_detached(
                "bash",
                [
                    "-lc",
                    f"cd {sandbox.sandbox.cwd} && {command}",
                ],
                env=env,
            )
            # No server-side session retained; client uses sandbox_id to stop

        # Stream logs
        async for line in cmd.logs():
            # line.data contains already-formatted text with newlines
            yield sse_format(emit_event(task_id, "play_log", data=line.data))
            if is_fastapi and not preview_sent and (
                ("Application startup complete" in line.data)
                or ("Uvicorn running on" in line.data)
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
        # Close the API client; do not stop sandbox automatically (client controls lifecycle)
        try:
            if sandbox is not None:
                await sandbox.client.aclose()
        except Exception:
            pass


@app.post("/api/runs")
async def create_run(request: RunRequest) -> dict[str, Any]:
    """Create a new run and return its id plus a stream token.

    Frontend should then connect to SSE at GET /api/runs/{run_id}/events?token=...
    """
    task_id = make_task_id()
    logger.info("create_run[%s] model=%s query_len=%d files=%d", task_id, request.model, len(request.query or ""), len(request.project or {}))
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


@app.get("/api/runs/{run_id}/events")
async def run_events(run_id: str, token: str):
    """Connect to the run's SSE event stream and start processing."""
    payload = read_stream_token(token)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            async for chunk in run_agent_flow(payload, run_id):
                yield chunk
        except Exception as e:
            logger.error("run_events[%s] error: %s", run_id, str(e))
            tb = traceback.format_exc(limit=10)
            yield sse_format(emit_event(run_id, "run_log", data=f"stream exception: {str(e)}\n{tb}"))
            yield sse_format(emit_event(run_id, "run_failed", error=str(e)))

    return StreamingResponse(event_generator(), headers=SSE_HEADERS)


@app.get("/api/runs/{run_id}/resume")
async def resume_run(run_id: str, token: str, result: str):
    """Resume a run after client-side code execution by reconnecting SSE."""
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
                project=base.get("project", {}), base_payload=base_payload, exec_result=result
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
            agent_instance = create_ide_agent(selected_model) if selected_model else ide_agent
            run_result = await Runner.run(
                agent_instance, input=input_text, context=context, max_turns=10
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


@app.post("/api/play")
async def create_play(request: PlayRequest) -> dict[str, Any]:
    """Create a new play execution and return its id plus a stream token."""
    task_id = make_task_id()
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


@app.get("/api/play/{play_id}/events")
async def play_events(play_id: str, token: str):
    """Connect to the play execution SSE event stream and start the sandbox."""
    payload = read_stream_token(token)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            async for chunk in run_play_flow(payload, play_id):
                yield chunk
        except Exception as e:
            yield sse_format(emit_event(play_id, "play_failed", error=str(e)))

    return StreamingResponse(event_generator(), headers=SSE_HEADERS)


@app.delete("/api/play/{play_id}")
async def stop_play_delete(play_id: str, token: str, sandbox_id: str | None = None) -> dict[str, Any]:
    """Stop a running play session using provided sandbox_id (stateless)."""
    # Validate token
    _ = read_stream_token(token)
    if not sandbox_id:
        return {"ok": False, "error": "missing sandbox_id"}
    # Attempt stop statelessly by sandbox id
    try:
        fetched = await Sandbox.get(sandbox_id=sandbox_id)
        await fetched.stop()
    except Exception as e:
        # Still return ok; sandbox may already be stopped or gone
        return {"ok": False, "error": str(e)}
    return {"ok": True, "stopped": True}


@app.get("/api/models")
async def list_models() -> dict[str, Any]:
    """Return a clean list of models allowed by this server.

    If an AI Gateway key is configured, intersect ALLOWED_MODELS with the gateway's
    advertised models. Otherwise, return ALLOWED_MODELS as-is.
    """
    # Default to the server's allowlist
    result = list(ALLOWED_MODELS)

    api_key = os.getenv("AI_GATEWAY_API_KEY") or os.getenv("VERCEL_OIDC_TOKEN")
    gateway_base = (
        os.getenv("AI_GATEWAY_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or "https://ai-gateway.vercel.sh/v1"
    )

    if not api_key:
        return {"models": result}

    # Query gateway and intersect
    url = f"{gateway_base.rstrip('/')}/models"
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            available_ids = {str(m.get("id")) for m in (data.get("data") or []) if m.get("id")}
            intersected = [m for m in ALLOWED_MODELS if m in available_ids]
            return {"models": intersected or result}
    except httpx.HTTPError:
        # On any error, just fall back to our allowlist
        return {"models": result}


@app.get("/")
def read_root():
    return {"Hello": "IDE Agent"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8081)
