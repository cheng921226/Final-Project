import logging
import os
from contextlib import contextmanager
from threading import Event, Thread
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from database.supabase import supabase_admin


GenerationComponent = Literal["transcript", "summary", "knowledge_points", "mindmap", "questions"]

GENERATION_COMPONENTS = (
    "transcript",
    "summary",
    "knowledge_points",
    "mindmap",
    "questions",
)
FINAL_STATUSES = {"completed", "failed"}
logger = logging.getLogger(__name__)
HEARTBEAT_SECONDS = 60
STALE_PROCESSING_MINUTES = int(os.getenv("GENERATION_STALE_MINUTES", "10"))
INTERRUPTED_MESSAGE = f"任務已中斷：超過 {STALE_PROCESSING_MINUTES} 分鐘未收到運作回報，請重新生成。"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def set_generation_status(
    lecture_id: int,
    component: str,
    status: str,
    *,
    error: str | None = None,
    expected_started_at: str | None = None,
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
        table = supabase_admin.table("lecture_generation_status")
        if expected_started_at:
            # A late worker must not overwrite a newer run or an expired lease.
            response = (table.update(row).eq("lecture_id", lecture_id)
                        .eq("component", component).eq("status", "processing")
                        .eq("started_at", expected_started_at).execute())
        else:
            response = table.upsert(row, on_conflict="lecture_id,component").execute()
        return (response.data or [None])[0]
    except Exception:
        # The SQL migration may not have been applied yet. Generation itself must
        # remain compatible with the existing project while setup is in progress.
        return None


def get_generation_statuses(lecture_id: int) -> dict[str, dict[str, Any]]:
    try:
        rows = (
            supabase_admin.table("lecture_generation_status")
            .select("lecture_id,component,status,error_message,started_at,completed_at,updated_at")
            .eq("lecture_id", lecture_id)
            .execute()
            .data
            or []
        )
    except Exception:
        return {}
    return {row["component"]: row for row in reconcile_generation_statuses(rows)}


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


def _is_recent(row: dict[str, Any]) -> bool:
    # updated_at is refreshed by the worker, even during a long AI request.
    raw = row.get("updated_at") or row.get("started_at")
    if not raw:
        return True  # Do not expire legacy rows without timing evidence.
    try:
        updated = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return True
    return _now() - updated < timedelta(minutes=STALE_PROCESSING_MINUTES)


def reconcile_generation_statuses(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expire abandoned steps on reads, using a conditional update to avoid races."""
    live_lectures = {row.get("lecture_id") for row in rows
                     if row.get("status") in {"processing", "completed"}
                     and (row.get("updated_at") or row.get("started_at")) and _is_recent(row)}
    result = []
    for row in rows:
        status = row.get("status")
        abandoned = status == "processing" or (
            status == "pending" and row.get("lecture_id") not in live_lectures
        )
        if abandoned and not _is_recent(row):
            now = _now().isoformat()
            values = {"status": "failed", "error_message": INTERRUPTED_MESSAGE,
                      "completed_at": now, "updated_at": now}
            try:
                query = (supabase_admin.table("lecture_generation_status").update(values)
                         .eq("lecture_id", row["lecture_id"])
                         .eq("component", row["component"]).eq("status", status))
                if row.get("updated_at"):
                    query = query.eq("updated_at", row["updated_at"])
                else:
                    query = query.is_("updated_at", "null").eq("started_at", row["started_at"])
                updated = query.execute().data or []
                if updated:
                    row = {**row, **values}
                # On a concurrent heartbeat/completion, let the next poll reread it.
            except Exception:
                logger.warning("Unable to expire generation status", exc_info=True)
        result.append(row)
    return result


@contextmanager
def generation_heartbeat(lecture_id: int, component: str):
    """Keep a claimed step alive; leave started_at unchanged as the run identity."""
    row = get_generation_statuses(lecture_id).get(component, {})
    started_at = row.get("started_at")
    stopped = Event()

    def beat():
        while not stopped.wait(HEARTBEAT_SECONDS):
            try:
                response = (supabase_admin.table("lecture_generation_status")
                            .update({"updated_at": _now().isoformat()})
                            .eq("lecture_id", lecture_id).eq("component", component)
                            .eq("status", "processing").eq("started_at", started_at)
                            .execute())
                if not response.data:
                    return
            except Exception:
                logger.warning("Generation heartbeat failed lecture_id=%s component=%s",
                               lecture_id, component, exc_info=True)

    thread = Thread(target=beat, name=f"generation-{lecture_id}-{component}", daemon=True)
    if started_at:
        thread.start()
    try:
        yield started_at
    finally:
        stopped.set()
        if thread.ident is not None:
            thread.join(timeout=1)


def generation_is_busy(lecture_id: int, component: str) -> bool:
    row = get_generation_statuses(lecture_id).get(component)
    return bool(row and row.get("status") == "processing" and _is_recent(row))


def claim_generation(lecture_id: int, component: str) -> bool:
    """Atomically claim a step when the SQL migration is available."""
    if component not in GENERATION_COMPONENTS:
        raise ValueError(f"Unsupported generation component: {component}")
    statuses = get_generation_statuses(lecture_id)
    current = statuses.get(component)
    if current and current.get("status") == "processing":
        # Reconciliation either expired the exact snapshot or a heartbeat won
        # the race. Never replace the latter with an unconditional failure.
        return False
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
