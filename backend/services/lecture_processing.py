import os
from datetime import datetime, timedelta, timezone
from typing import Any

from database.supabase import supabase_admin


GENERATION_COMPONENTS = (
    "transcript",
    "summary",
    "knowledge_points",
    "mindmap",
    "questions",
)
FINAL_STATUSES = {"completed", "failed"}
STALE_PROCESSING_MINUTES = int(os.getenv("GENERATION_STALE_MINUTES", "10"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def set_generation_status(
    lecture_id: int,
    component: str,
    status: str,
    *,
    error: str | None = None,
) -> dict[str, Any] | None:
    """Persist one pipeline step without making legacy deployments unusable."""
    if component not in GENERATION_COMPONENTS:
        raise ValueError(f"Unsupported generation component: {component}")

    now = _now().isoformat()
    row: dict[str, Any] = {
        "lecture_id": lecture_id,
        "component": component,
        "status": status,
        "error_message": error,
        "updated_at": now,
    }
    if status == "processing":
        row.update({"started_at": now, "completed_at": None})
    elif status in FINAL_STATUSES:
        row["completed_at"] = now

    try:
        response = (
            supabase_admin.table("lecture_generation_status")
            .upsert(row, on_conflict="lecture_id,component")
            .execute()
        )
        return (response.data or [None])[0]
    except Exception:
        # The SQL migration may not have been applied yet. Generation itself must
        # remain compatible with the existing project while setup is in progress.
        return None


def get_generation_statuses(lecture_id: int) -> dict[str, dict[str, Any]]:
    try:
        rows = (
            supabase_admin.table("lecture_generation_status")
            .select("component,status,error_message,started_at,completed_at,updated_at")
            .eq("lecture_id", lecture_id)
            .execute()
            .data
            or []
        )
    except Exception:
        return {}
    return {row["component"]: row for row in rows}


def ensure_generation_statuses(
    lecture_id: int, content_status: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    statuses = get_generation_statuses(lecture_id)
    inferred = {
        "transcript": bool(content_status.get("transcript")),
        "summary": bool(content_status.get("summary")),
        "knowledge_points": bool(content_status.get("knowledge_points")),
        "mindmap": bool(content_status.get("mindmap")),
        "questions": bool(content_status.get("questions")),
    }
    for component, exists in inferred.items():
        if component not in statuses:
            statuses[component] = {
                "component": component,
                "status": "completed" if exists else "pending",
                "error_message": None,
            }
    return statuses


def generation_is_busy(lecture_id: int, component: str) -> bool:
    row = get_generation_statuses(lecture_id).get(component)
    if not row or row.get("status") != "processing":
        return False
    raw_started = row.get("started_at") or row.get("updated_at")
    if not raw_started:
        return True
    try:
        started = datetime.fromisoformat(str(raw_started).replace("Z", "+00:00"))
    except ValueError:
        return True
    return _now() - started < timedelta(minutes=STALE_PROCESSING_MINUTES)


def claim_generation(lecture_id: int, component: str) -> bool:
    """Atomically claim a step when the SQL migration is available."""
    if component not in GENERATION_COMPONENTS:
        raise ValueError(f"Unsupported generation component: {component}")
    statuses = get_generation_statuses(lecture_id)
    current = statuses.get(component)
    if current and current.get("status") == "processing":
        if generation_is_busy(lecture_id, component):
            return False
        set_generation_status(
            lecture_id,
            component,
            "failed",
            error="上一次處理逾時或中斷，已自動解除鎖定",
        )
    try:
        response = supabase_admin.rpc(
            "claim_lecture_generation",
            {"p_lecture_id": lecture_id, "p_component": component},
        ).execute()
        return bool(response.data)
    except Exception:
        if generation_is_busy(lecture_id, component):
            return False
        set_generation_status(lecture_id, component, "processing")
        return True
