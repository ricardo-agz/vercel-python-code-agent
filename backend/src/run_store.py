from __future__ import annotations

import os
from typing import Any, Optional

from vercel.cache import get_cache


# TTL in seconds for cached run payloads
_TTL_SECONDS: int = int(os.getenv("RUN_STORE_TTL_SECONDS", "900"))
_NAMESPACE = os.getenv("RUN_STORE_NAMESPACE", "ide-agent-runs")


def _cache_key(run_id: str) -> str:
    return f"run:{run_id}"


async def set_run_payload(run_id: str, payload: dict[str, Any]) -> None:
    """Store the base payload for a run id using Vercel Runtime Cache."""
    cache = get_cache(namespace=_NAMESPACE)
    await cache.set(_cache_key(run_id), dict(payload), {"ttl": _TTL_SECONDS, "tags": [f"run:{run_id}"]})


async def get_run_payload(run_id: str) -> Optional[dict[str, Any]]:
    """Fetch the stored payload for a run id."""
    cache = get_cache(namespace=_NAMESPACE)
    val = await cache.get(_cache_key(run_id))
    return dict(val) if isinstance(val, dict) else None


async def update_run_project(run_id: str, project: dict[str, str]) -> None:
    """Update only the project map for the stored run payload if present."""
    cache = get_cache(namespace=_NAMESPACE)
    base = await cache.get(_cache_key(run_id))
    if isinstance(base, dict):
        updated = dict(base)
        updated["project"] = dict(project)
        await cache.set(_cache_key(run_id), updated, {"ttl": _TTL_SECONDS, "tags": [f"run:{run_id}"]})
