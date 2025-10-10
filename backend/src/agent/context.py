from typing import Any
from pydantic import BaseModel, Field


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

    # Sandbox session state for remote execution
    sandbox_id: str | None = None
    sandbox_runtime: str | None = None
    sandbox_ports: list[int] | None = None
    sandbox_env: dict[str, str] = Field(default_factory=dict)
    # Filesystem snapshot tracking for auto-resync
    sandbox_files: list[str] = Field(default_factory=list)
    sandbox_file_meta: dict[str, str] = Field(default_factory=dict)  # path -> "mtime size"
    