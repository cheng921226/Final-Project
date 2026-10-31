import logging
import os
import tempfile

from database.supabase import supabase_admin
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile, Depends
from pydantic import BaseModel, Field
from typing import Any
from services.transcription import (
    DEFAULT_MODEL_SIZE,
    calculate_file_sha256,
    extract_youtube_video_id,
    get_youtube_metadata,
    save_lecture_duration,
    save_transcript_segments,
    transcribe_media,
)
from services.local_video import (
    MAX_LOCAL_VIDEO_BYTES,
    create_local_video_signed_url,
    remove_local_video,
    upload_local_video,
    validate_local_video,
)
from services.lecture_processing import (
    GENERATION_COMPONENTS,
    get_generation_statuses,
    set_generation_status,
)
from services.video_backup import (
    backup_file_exists,
    backup_lecture_video,
    create_backup_signed_url,
)
from services.pipeline_runner import (
    PipelineStepError,
    run_media_ai_pipeline,
    run_youtube_ai_pipeline,
)
from .security import AuthContext, get_auth_context, get_current_user
from .teacher_access import (
    course_owner_for_creation,
    require_course_manager,
    require_lecture_manager,
    require_teacher,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def public_lecture(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in row.items()
        if key not in {"backup_storage_path", "media_storage_path"}
    }


def run_automatic_lecture_pipeline(
    lecture_id: int,
    *,
    url: str,
    language: str,
    model_size: str,
    skip_existing_transcript: bool,
    skip_existing_ai: bool,
) -> None:
    """Run generation after the create response so the browser can navigate away."""
    logger.info("Starting automatic lecture pipeline lecture_id=%s", lecture_id)
    try:
        pipeline_result = run_youtube_ai_pipeline(
            lecture_id,
            url=url,
            language=language,
            model_size=model_size,
            skip_existing_transcript=skip_existing_transcript,
            skip_existing_ai=skip_existing_ai,
        )
    except PipelineStepError as exc:
        logger.error(
            "Automatic lecture pipeline failed lecture_id=%s step=%s",
            lecture_id,
            exc.code,
        )
        return
    except Exception:
        logger.exception("Automatic lecture pipeline failed lecture_id=%s", lecture_id)
        return

    logger.info(
        "Automatic lecture pipeline completed lecture_id=%s status=%s",
        lecture_id,
        pipeline_result.get("status", "unknown"),
    )


def run_automatic_uploaded_pipeline(
    lecture_id: int,
    *,
    file_path: str,
    language: str,
    model_size: str,
) -> None:
    """Process an uploaded video with the same AI stages as YouTube media."""
    try:
        run_media_ai_pipeline(
            lecture_id,
            file_path=file_path,
            source="upload",
            language=language,
            model_size=model_size,
            skip_existing_transcript=True,
            skip_existing_ai=True,
        )
    except Exception:
        logger.exception("Uploaded media pipeline failed lecture_id=%s", lecture_id)
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

# =====================================================================
# 🗂️ 課程總表相關 (Courses)
# =====================================================================


class CourseCreate(BaseModel):
    title: str
    description: str | None = None
    teacher_id: int | None = None


@router.get("/courses")
def get_courses(keyword: str = None):
    query = supabase_admin.table("courses").select("*").eq("status", "published")
    if keyword:
        query = query.ilike("title", f"%{keyword}%")
    res = query.execute()
    courses = res.data or []
    teacher_ids = list(
        {row.get("teacher_id") for row in courses if row.get("teacher_id") is not None}
    )
    teachers = {}
    if teacher_ids:
        teacher_rows = (
            supabase_admin.table("users")
            .select("id,name,email")
            .in_("id", teacher_ids)
            .execute()
            .data
            or []
        )
        teachers = {row["id"]: row for row in teacher_rows}
    return [
        {
            **course,
            "teacher_name": (
                teachers.get(course.get("teacher_id"), {}).get("name")
                or teachers.get(course.get("teacher_id"), {}).get("email")
            ),
        }
        for course in courses
    ]


@router.post("/courses")
def create_course(body: CourseCreate, user=Depends(get_current_user)):
    teacher = require_teacher(user)
    owner_id = course_owner_for_creation(teacher, body.teacher_id)
    if teacher.get("role") == "campus" and owner_id != teacher["id"]:
        assigned = (
            supabase_admin.table("users")
            .select("id,role")
            .eq("id", owner_id)
            .maybe_single()
            .execute()
            .data
        )
        if not assigned or assigned.get("role") != "teacher":
            raise HTTPException(
                status_code=422, detail="授課教師帳號不存在或角色不正確"
            )
    res = (
        supabase_admin.table("courses")
        .insert(
            {
                "title": body.title,
                "description": body.description,
                "teacher_id": owner_id,
                "created_by_user_id": teacher["id"],
                "status": "draft",
            }
        )
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=500, detail="新增課程失敗")
    return res.data[0]


@router.get("/courses/{course_id}/lectures")
def get_lectures_by_course(course_id: int):
    res = (
        supabase_admin.table("lectures")
        .select("*")
        .eq("course_id", course_id)
        .eq("is_visible", True)
        .order("sort_order")
        .order("id")
        .execute()
    )
    return [public_lecture(row) for row in (res.data or [])]


# =====================================================================
# 🎬 單一小節影片內部功能 (Lectures)
# =====================================================================


class LectureCreate(BaseModel):
    title: str
    media_url: str
    course_id: int
    duration_seconds: int | None = None
    auto_process: bool = True
    language: str | None = "zh"
    model_size: str = DEFAULT_MODEL_SIZE
    skip_existing_transcript: bool = True
    skip_existing_ai: bool = True
    backup_video: bool = False
    overwrite_existing: bool = False
    source_file_hash: str | None = Field(default=None, min_length=32, max_length=128)


@router.get("/lectures/{lecture_id}")
def get_selected_lecture(lecture_id: int):
    res = supabase_admin.table("lectures").select("*").eq("id", lecture_id).execute()
    return [public_lecture(row) for row in (res.data or [])]


@router.post("/lectures")
def create_lecture(
    body: LectureCreate,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user),
):
    teacher = require_teacher(user)
    require_course_manager(body.course_id, teacher)
    existing = (
        supabase_admin.table("lectures")
        .select("sort_order")
        .eq("course_id", body.course_id)
        .order("sort_order", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    next_sort_order = int(existing[0].get("sort_order") or 0) + 1 if existing else 0
    youtube_video_id = extract_youtube_video_id(body.media_url)
    is_youtube = youtube_video_id is not None
    if body.backup_video and not is_youtube:
        raise HTTPException(status_code=422, detail="只有 YouTube 影片可以啟用備份")
    if is_youtube:
        duplicate = (
            supabase_admin.table("lectures")
            .select(
                "id,title,course_id,status,media_url,youtube_video_id,backup_status"
            )
            .eq("course_id", body.course_id)
            .execute()
            .data
            or []
        )
        duplicate = next(
            (
                row for row in duplicate
                if row.get("youtube_video_id") == youtube_video_id
                or extract_youtube_video_id(row.get("media_url") or "") == youtube_video_id
            ),
            None,
        )
        if duplicate:
            if body.overwrite_existing:
                generation_statuses = get_generation_statuses(duplicate["id"])
                generation_is_busy = any(
                    item.get("status") == "processing"
                    for item in generation_statuses.values()
                )
                backup_is_busy = duplicate.get("backup_status") in {
                    "pending",
                    "processing",
                }
                if generation_is_busy or backup_is_busy:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "LECTURE_BUSY",
                            "message": "原有小節仍在處理中，請完成後再覆蓋。",
                            "lecture": duplicate,
                        },
                    )

                values = {
                    "title": body.title,
                    "media_url": body.media_url,
                    "youtube_video_id": youtube_video_id,
                    "status": "uploaded",
                }
                if body.backup_video:
                    values.update({"backup_status": "pending", "backup_error": None})
                overwritten = (
                    supabase_admin.table("lectures")
                    .update(values)
                    .eq("id", duplicate["id"])
                    .execute()
                    .data
                    or []
                )
                lecture = overwritten[0] if overwritten else {**duplicate, **values}
                if body.auto_process:
                    background_tasks.add_task(
                        run_automatic_lecture_pipeline,
                        lecture["id"],
                        url=body.media_url,
                        language=body.language,
                        model_size=body.model_size,
                        skip_existing_transcript=True,
                        skip_existing_ai=True,
                    )
                if body.backup_video:
                    background_tasks.add_task(
                        backup_lecture_video, lecture["id"], body.media_url
                    )
                return {
                    **lecture,
                    "overwritten": True,
                    "pipeline": {
                        "status": "processing" if body.auto_process else "skipped",
                        "message": "已更新原有小節，並保留既有教材與學習紀錄。",
                    },
                }
            if not duplicate.get("youtube_video_id"):
                try:
                    supabase_admin.table("lectures").update(
                        {"youtube_video_id": youtube_video_id}
                    ).eq("id", duplicate["id"]).execute()
                except Exception:
                    pass
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "DUPLICATE_LECTURE",
                    "message": "此影片已存在於目前課程中。",
                    "lecture": duplicate,
                },
            )
    elif body.source_file_hash:
        duplicate = (
            supabase_admin.table("lectures")
            .select("id,title,course_id,status")
            .eq("course_id", body.course_id)
            .eq("source_file_hash", body.source_file_hash)
            .maybe_single()
            .execute()
            .data
        )
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "DUPLICATE_LECTURE",
                    "message": "此影片檔案已存在於目前課程中。",
                    "lecture": duplicate,
                },
            )
    duration_seconds = body.duration_seconds
    if duration_seconds is None and is_youtube:
        try:
            duration_seconds = get_youtube_metadata(body.media_url).get("duration")
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail=f"無法讀取 YouTube 影片長度：{exc}",
            ) from exc

    try:
        res = (
            supabase_admin.table("lectures")
            .insert(
                {
                "title": body.title,
                "media_url": body.media_url,
                "course_id": body.course_id,
                "status": "uploaded",
                "duration_seconds": duration_seconds,
                "youtube_video_id": youtube_video_id,
                "source_file_hash": body.source_file_hash,
                "backup_status": "pending" if body.backup_video else "not_requested",
                "sort_order": next_sort_order,
                "is_visible": True,
                }
            )
            .execute()
        )
    except Exception as exc:
        if is_youtube and "duplicate" in str(exc).lower():
            duplicate = (
                supabase_admin.table("lectures")
                .select("id,title,course_id,status")
                .eq("course_id", body.course_id)
                .eq("youtube_video_id", youtube_video_id)
                .maybe_single()
                .execute()
                .data
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "DUPLICATE_LECTURE",
                    "message": "此影片已存在於目前課程中。",
                    "lecture": duplicate,
                },
            ) from exc
        raise
    if not res.data:
        raise HTTPException(status_code=500, detail="新增小節失敗")

    lecture = res.data[0]
    for component in GENERATION_COMPONENTS:
        set_generation_status(lecture["id"], component, "pending")
    if not body.auto_process or not is_youtube:
        if body.backup_video and is_youtube:
            background_tasks.add_task(
                backup_lecture_video, lecture["id"], body.media_url
            )
        return lecture

    background_tasks.add_task(
        run_automatic_lecture_pipeline,
        lecture["id"],
        url=body.media_url,
        language=body.language,
        model_size=body.model_size,
        skip_existing_transcript=body.skip_existing_transcript,
        skip_existing_ai=body.skip_existing_ai,
    )
    if body.backup_video:
        background_tasks.add_task(
            backup_lecture_video, lecture["id"], body.media_url
        )
    return {
        **lecture,
        "status": "uploaded",
        "pipeline": {
            "status": "processing",
            "message": "教材已開始在背景產生，可以離開此頁面。",
        },
    }


@router.post("/lectures/upload")
async def upload_lecture_video(
    background_tasks: BackgroundTasks,
    title: str = Form(...),
    course_id: int = Form(...),
    file: UploadFile = File(...),
    language: str = Form(default="zh"),
    model_size: str = Form(default=DEFAULT_MODEL_SIZE),
    auto_process: bool = Form(default=True),
    user=Depends(get_current_user),
):
    teacher = require_teacher(user)
    require_course_manager(course_id, teacher)
    if not title.strip():
        raise HTTPException(status_code=422, detail="請輸入小節名稱")
    try:
        suffix, content_type = validate_local_video(file.filename, file.content_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    temp_path = None
    storage_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = temp_file.name
            total_bytes = 0
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_LOCAL_VIDEO_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            "影片超過目前 Storage 單檔上限 "
                            f"{MAX_LOCAL_VIDEO_BYTES // (1024 * 1024)} MB"
                        ),
                    )
                temp_file.write(chunk)
        if total_bytes == 0:
            raise HTTPException(status_code=422, detail="影片檔案是空的")

        source_hash = calculate_file_sha256(temp_path)
        duplicate = (
            supabase_admin.table("lectures")
            .select("id,title,course_id,status")
            .eq("course_id", course_id)
            .eq("source_file_hash", source_hash)
            .maybe_single()
            .execute()
            .data
        )
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "DUPLICATE_LECTURE",
                    "message": "此影片檔案已存在於目前課程中。",
                    "lecture": duplicate,
                },
            )

        storage_path = upload_local_video(
            temp_path,
            course_id=course_id,
            original_filename=file.filename or f"video{suffix}",
            content_type=content_type,
        )
        last_lecture = (
            supabase_admin.table("lectures")
            .select("sort_order")
            .eq("course_id", course_id)
            .order("sort_order", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        sort_order = (
            int(last_lecture[0].get("sort_order") or 0) + 1
            if last_lecture
            else 0
        )
        inserted = (
            supabase_admin.table("lectures")
            .insert(
                {
                    "title": title.strip(),
                    "course_id": course_id,
                    "media_url": f"storage://lecture-videos/{storage_path}",
                    "media_source": "upload",
                    "media_storage_path": storage_path,
                    "media_mime_type": content_type,
                    "media_size_bytes": total_bytes,
                    "source_file_name": file.filename,
                    "source_file_hash": source_hash,
                    "status": "uploaded",
                    "backup_status": "not_requested",
                    "sort_order": sort_order,
                    "is_visible": True,
                }
            )
            .execute()
            .data
            or []
        )
        if not inserted:
            raise RuntimeError("新增小節失敗")
        lecture = inserted[0]
        for component in GENERATION_COMPONENTS:
            set_generation_status(lecture["id"], component, "pending")

        if auto_process:
            background_tasks.add_task(
                run_automatic_uploaded_pipeline,
                lecture["id"],
                file_path=temp_path,
                language=language,
                model_size=model_size,
            )
            temp_path = None
        return {
            **lecture,
            "media_storage_path": None,
            "pipeline": {
                "status": "processing" if auto_process else "skipped",
                "message": (
                    "影片已安全上傳，教材正在背景產生。"
                    if auto_process
                    else "影片已安全上傳。"
                ),
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Local video upload failed course_id=%s", course_id)
        raise HTTPException(status_code=500, detail=f"影片上傳失敗：{exc}") from exc
    finally:
        if storage_path and "lecture" not in locals():
            try:
                remove_local_video(storage_path)
            except Exception:
                pass
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@router.get("/lectures/{lecture_id}/media")
def get_uploaded_lecture_media(
    lecture_id: int,
    user=Depends(get_current_user),
):
    from .questions import require_lecture_viewer

    require_lecture_viewer(lecture_id, user)
    lecture = (
        supabase_admin.table("lectures")
        .select("id,media_source,media_storage_path,media_mime_type")
        .eq("id", lecture_id)
        .maybe_single()
        .execute()
        .data
    )
    if not lecture:
        raise HTTPException(status_code=404, detail="找不到課程小節")
    if lecture.get("media_source") != "upload" or not lecture.get(
        "media_storage_path"
    ):
        raise HTTPException(status_code=404, detail="此小節不是本機上傳影片")
    return {
        "lecture_id": lecture_id,
        "source": "upload",
        "content_type": lecture.get("media_mime_type"),
        "playback_url": create_local_video_signed_url(
            lecture["media_storage_path"]
        ),
        "expires_in": 3600,
    }


@router.get("/lectures/{lecture_id}/backup")
def get_lecture_backup(lecture_id: int, user=Depends(get_current_user)):
    row = (
        supabase_admin.table("lectures")
        .select("id,backup_status,backup_storage_path,backup_error,backup_updated_at")
        .eq("id", lecture_id)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=404, detail="找不到課程小節")
    result = {
        "lecture_id": lecture_id,
        "status": row.get("backup_status") or "not_requested",
        "error": row.get("backup_error"),
        "updated_at": row.get("backup_updated_at"),
        "playback_url": None,
    }
    if row.get("backup_status") == "completed" and row.get("backup_storage_path"):
        try:
            if not backup_file_exists(row["backup_storage_path"]):
                raise RuntimeError("備份狀態已完成，但 Storage 中找不到影片檔案")
            result["playback_url"] = create_backup_signed_url(
                row["backup_storage_path"]
            )
        except Exception as exc:
            result.update({"status": "failed", "error": str(exc)})
            supabase_admin.table("lectures").update(
                {"backup_status": "failed", "backup_error": str(exc)[:2000]}
            ).eq("id", lecture_id).execute()
    return result


@router.get("/lectures/{lecture_id}/transcripts")
def get_lecture_transcript(lecture_id: int):
    res = (
        supabase_admin.table("transcripts").select("*").eq("lecture_id", lecture_id).execute()
    )
    return res.data


@router.get("/lectures/{lecture_id}/summaries")
def get_lecture_summary(lecture_id: int):
    res = (
        supabase_admin.table("summaries")
        .select("*")
        .eq("lecture_id", lecture_id)
        .single()
        .execute()
    )
    return res.data


@router.get("/lectures/{lecture_id}/knowledge_points")
def get_lecture_knowledge_points(lecture_id: int):
    res = (
        supabase_admin.table("knowledge_points")
        .select("*")
        .eq("lecture_id", lecture_id)
        .eq("is_active", True)
        .execute()
    )
    return res.data


@router.get("/lectures/{lecture_id}/mindmaps")
def get_lecture_mindmap(lecture_id: int):
    res = supabase_admin.table("mindmaps").select("*").eq("lecture_id", lecture_id).execute()
    return res.data


@router.get("/lectures/{lecture_id}/notes")
def get_lecture_notes(
    lecture_id: int,
    context: AuthContext = Depends(get_auth_context),
):
    res = (
        context.database.table("notes")
        .select("*")
        .eq("lecture_id", lecture_id)
        .eq("student_id", context.profile["id"])
        .order("updated_at", desc=True)
        .execute()
    )
    return res.data


class NoteCreate(BaseModel):
    title: str | None = None
    content: str = Field(min_length=1)
    video_timestamp: int = Field(default=0, ge=0)
    knowledge_point_id: int | None = None


@router.post("/lectures/{lecture_id}/notes")
def create_lecture_note(
    lecture_id: int,
    note: NoteCreate,
    context: AuthContext = Depends(get_auth_context),
):
    res = (
        context.database.table("notes")
        .insert(
            {
                "lecture_id": lecture_id,
                "student_id": context.profile["id"],
                "title": note.title,
                "content": note.content,
                "video_timestamp": note.video_timestamp,
                "knowledge_point_id": note.knowledge_point_id,
            }
        )
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=500, detail="新增筆記失敗")
    return res.data[0]


class NoteUpdate(BaseModel):
    title: str | None = None
    content: str | None = Field(default=None, min_length=1)
    video_timestamp: int | None = Field(default=None, ge=0)
    knowledge_point_id: int | None = None


@router.patch("/notes/{note_id}")
def update_lecture_note(
    note_id: int,
    note: NoteUpdate,
    context: AuthContext = Depends(get_auth_context),
):
    update_data = note.model_dump(exclude_unset=True)

    if not update_data:
        raise HTTPException(status_code=422, detail="請至少提供一個要更新的欄位")

    res = (
        context.database.table("notes")
        .update(update_data)
        .eq("id", note_id)
        .eq("student_id", context.profile["id"])
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="找不到筆記或無權限操作")
    return res.data[0]


@router.delete("/notes/{note_id}")
def delete_lecture_note(
    note_id: int,
    context: AuthContext = Depends(get_auth_context),
):
    res = (
        context.database.table("notes")
        .delete()
        .eq("id", note_id)
        .eq("student_id", context.profile["id"])
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="找不到筆記或無權限操作")
    return {"message": "deleted"}


# =====================================================================
# 📊 學習事件紀錄 (Learning Events)
# =====================================================================


class LearningEventCreate(BaseModel):
    lecture_id: int
    event_type: str
    event_data: dict[str, Any] = {}


@router.post("/learning_events")
def create_learning_event(
    body: LearningEventCreate,
    context: AuthContext = Depends(get_auth_context),
):
    res = (
        context.database.table("learning_events")
        .insert(
            {
                "student_id": context.profile["id"],
                "lecture_id": body.lecture_id,
                "event_type": body.event_type,
                "event_data": body.event_data,
            }
        )
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=500, detail="記錄學習事件失敗")
    return res.data[0]


@router.get("/learning_events/{lecture_id}")
def get_learning_events(
    lecture_id: int,
    context: AuthContext = Depends(get_auth_context),
):
    res = (
        context.database.table("learning_events")
        .select("*")
        .eq("lecture_id", lecture_id)
        .eq("student_id", context.profile["id"])
        .execute()
    )
    return res.data


# =====================================================================
# 📈 影片觀看進度 (Video Progresses)
# =====================================================================


class VideoProgressCreate(BaseModel):
    lecture_id: int
    last_position: int = 0
    watched_seconds: int = 0
    completed: bool = False


@router.post("/video_progresses")
def upsert_video_progress(
    body: VideoProgressCreate,
    context: AuthContext = Depends(get_auth_context),
):
    student_id = context.profile["id"]
    # 先查有沒有已存在的紀錄
    existing = (
        context.database.table("video_progresses")
        .select("id")
        .eq("student_id", student_id)
        .eq("lecture_id", body.lecture_id)
        .execute()
    )

    if existing.data:
        # 已存在 → 更新
        res = (
            context.database.table("video_progresses")
            .update(
                {
                    "last_position": body.last_position,
                    "watched_seconds": body.watched_seconds,
                    "completed": body.completed,
                }
            )
            .eq("student_id", student_id)
            .eq("lecture_id", body.lecture_id)
            .execute()
        )
    else:
        # 不存在 → 新增
        res = (
            context.database.table("video_progresses")
            .insert(
                {
                    "student_id": student_id,
                    "lecture_id": body.lecture_id,
                    "last_position": body.last_position,
                    "watched_seconds": body.watched_seconds,
                    "completed": body.completed,
                }
            )
            .execute()
        )

    if not res.data:
        raise HTTPException(status_code=500, detail="儲存進度失敗")
    return res.data[0]


@router.get("/video_progresses/{lecture_id}")
def get_video_progress(
    lecture_id: int,
    context: AuthContext = Depends(get_auth_context),
):
    student_id = context.profile["id"]
    # Use a limited list query instead of maybe_single(). In some
    # supabase-py/PostgREST versions, maybe_single().execute() returns None
    # when no row exists, which would make a new student's empty progress
    # state raise AttributeError and incorrectly become HTTP 500.
    res = (
        context.database.table("video_progresses")
        .select("*")
        .eq("lecture_id", lecture_id)
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


@router.get("/courses/{course_id}/video-progresses")
def get_course_video_progresses(
    course_id: int,
    context: AuthContext = Depends(get_auth_context),
):
    student_id = context.profile["id"]
    lecture_rows = (
        supabase_admin.table("lectures")
        .select("id")
        .eq("course_id", course_id)
        .eq("is_visible", True)
        .execute()
        .data
        or []
    )
    lecture_ids = [row["id"] for row in lecture_rows]
    if not lecture_ids:
        return []
    return (
        context.database.table("video_progresses")
        .select("lecture_id,last_position,watched_seconds,completed")
        .eq("student_id", student_id)
        .in_("lecture_id", lecture_ids)
        .execute()
        .data
        or []
    )


# =====================================================================
# 🎙️ 逐字稿轉錄
# =====================================================================


@router.post("/lectures/{lecture_id}/transcribe")
async def transcribe_lecture_media(
    lecture_id: int,
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    model_size: str = Form(default=DEFAULT_MODEL_SIZE),
    word_timestamps: bool = Form(default=False),
    save_to_db: bool = Form(default=True),
    user=Depends(get_current_user),
):
    teacher = require_teacher(user)
    require_lecture_manager(lecture_id, teacher)
    suffix = os.path.splitext(file.filename or "")[1] or ".media"
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = temp_file.name
            while chunk := await file.read(1024 * 1024):
                temp_file.write(chunk)
        result = transcribe_media(
            temp_path,
            model_size=model_size,
            language=language or None,
            word_timestamps=word_timestamps,
        )
        save_lecture_duration(lecture_id, result.get("duration"))
        db_result = {"saved_to_db": False, "inserted": 0, "db_error": None}
        if save_to_db:
            db_result = save_transcript_segments(lecture_id, result["segments"])
        return {
            "lecture_id": lecture_id,
            "filename": file.filename,
            **result,
            **db_result,
        }
    except RuntimeError as exc:
        logger.exception(
            "Manual transcription failed lecture_id=%s error_type=%s",
            lecture_id,
            type(exc).__name__,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Manual transcription failed lecture_id=%s error_type=%s",
            lecture_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=500, detail=f"Transcription failed: {exc}"
        ) from exc
    finally:
        if "temp_path" in locals() and os.path.exists(temp_path):
            os.remove(temp_path)
