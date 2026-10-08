from datetime import datetime, timezone
import re
from typing import Any, Literal

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from roles import CAMPUS_ROLE
from services.ai_generation import (
    format_transcript_for_prompt,
    generate_knowledge_points,
    generate_mindmap,
    generate_questions,
    generate_summary,
)

from .security import get_current_user
from .teacher_access import (
    require_course_manager,
    require_lecture_manager,
    require_teacher,
)

router = APIRouter(prefix="/teacher/course-management", tags=["course management"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CourseUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    status: Literal["draft", "published", "archived"] | None = None
    teacher_id: int | None = None


class LectureUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    media_url: str | None = Field(default=None, max_length=2000)
    is_visible: bool | None = None


class LectureOrderUpdate(BaseModel):
    lecture_ids: list[int]


class RegenerateRequest(BaseModel):
    components: list[
        Literal["summary", "knowledge_points", "mindmap", "questions"]
    ]


class TranscriptUpdate(BaseModel):
    content: str = Field(min_length=1)


def _content_status(lecture_ids: list[int]) -> dict[int, dict[str, Any]]:
    result = {
        lecture_id: {
            "transcript": False,
            "transcript_content": "",
            "summary": False,
            "knowledge_points": 0,
            "mindmap": False,
            "questions": 0,
        }
        for lecture_id in lecture_ids
    }
    if not lecture_ids:
        return result

    transcript_rows = (
        supabase_admin.table("transcripts")
        .select("lecture_id,content")
        .in_("lecture_id", lecture_ids)
        .execute()
        .data
        or []
    )
    for row in transcript_rows:
        if row.get("lecture_id") in result:
            result[row["lecture_id"]]["transcript"] = True
            result[row["lecture_id"]]["transcript_content"] = row.get("content") or ""

    table_fields = {"summaries": "summary", "mindmaps": "mindmap"}
    for table, field in table_fields.items():
        rows = (
            supabase_admin.table(table)
            .select("lecture_id")
            .in_("lecture_id", lecture_ids)
            .execute()
            .data
            or []
        )
        for row in rows:
            if row.get("lecture_id") in result:
                result[row["lecture_id"]][field] = True

    knowledge_rows = (
        supabase_admin.table("knowledge_points")
        .select("lecture_id,is_active")
        .in_("lecture_id", lecture_ids)
        .execute()
        .data
        or []
    )
    for row in knowledge_rows:
        if row.get("lecture_id") in result and row.get("is_active", True):
            result[row["lecture_id"]]["knowledge_points"] += 1

    question_rows = (
        supabase_admin.table("questions")
        .select("lecture_id,is_active,question_type")
        .in_("lecture_id", lecture_ids)
        .execute()
        .data
        or []
    )
    for row in question_rows:
        if (
            row.get("lecture_id") in result
            and row.get("is_active", True)
            and (row.get("question_type") or "original") == "original"
        ):
            result[row["lecture_id"]]["questions"] += 1
    return result


def _managed_courses(teacher: dict[str, Any]) -> list[dict[str, Any]]:
    query = supabase_admin.table("courses").select("*")
    if teacher.get("role") == CAMPUS_ROLE:
        query = query.eq("created_by_user_id", teacher["id"])
    else:
        query = query.eq("teacher_id", teacher["id"])
    return query.order("updated_at", desc=True).execute().data or []


@router.get("")
def get_course_management(user=Depends(get_current_user)):
    teacher = require_teacher(user)
    courses = _managed_courses(teacher)
    course_ids = [row["id"] for row in courses]
    lectures = []
    if course_ids:
        lectures = (
            supabase_admin.table("lectures")
            .select("*")
            .in_("course_id", course_ids)
            .order("sort_order")
            .order("id")
            .execute()
            .data
            or []
        )
    content_status = _content_status([row["id"] for row in lectures])
    user_ids = {
        user_id
        for course in courses
        for user_id in (course.get("created_by_user_id"), course.get("teacher_id"))
        if user_id is not None
    }
    people = {}
    if user_ids:
        people = {
            row["id"]: row
            for row in (
                supabase_admin.table("users")
                .select("id,name,email,role")
                .in_("id", list(user_ids))
                .execute()
                .data
                or []
            )
        }
    for course in courses:
        course["creator"] = people.get(course.get("created_by_user_id"))
        course["assigned_teacher"] = people.get(course.get("teacher_id"))
        course["lectures"] = [
            {**lecture, "content_status": content_status.get(lecture["id"], {})}
            for lecture in lectures
            if lecture.get("course_id") == course.get("id")
        ]

    teachers = []
    if teacher.get("role") == CAMPUS_ROLE:
        teachers = (
            supabase_admin.table("users")
            .select("id,name,email")
            .eq("role", "teacher")
            .order("name")
            .execute()
            .data
            or []
        )
    return {"actor": teacher, "courses": courses, "teachers": teachers}


@router.patch("/courses/{course_id}")
def update_course(
    course_id: int,
    payload: CourseUpdate,
    user=Depends(get_current_user),
):
    teacher = require_teacher(user)
    course = require_course_manager(course_id, teacher)
    values = payload.model_dump(exclude_unset=True)
    if "teacher_id" in values and teacher.get("role") != CAMPUS_ROLE:
        raise HTTPException(status_code=403, detail="只有校園平台端可以指派授課教師")
    if "teacher_id" in values and values["teacher_id"] is not None:
        assigned = (
            supabase_admin.table("users")
            .select("id,role")
            .eq("id", values["teacher_id"])
            .maybe_single()
            .execute()
            .data
        )
        if not assigned or assigned.get("role") != "teacher":
            raise HTTPException(status_code=422, detail="授課教師帳號不存在或角色不正確")
    target_teacher_id = values.get("teacher_id", course.get("teacher_id"))
    if values.get("status") == "published" and target_teacher_id is None:
        raise HTTPException(status_code=422, detail="課程發布前必須先指派授課教師")
    values["updated_at"] = _now()
    response = (
        supabase_admin.table("courses")
        .update(values)
        .eq("id", course_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=500, detail="課程更新失敗")
    return response.data[0]


@router.post("/courses/{course_id}/duplicate")
def duplicate_course(course_id: int, user=Depends(get_current_user)):
    teacher = require_teacher(user)
    course = require_course_manager(course_id, teacher)
    owner_id = teacher["id"]
    if teacher.get("role") == CAMPUS_ROLE:
        owner_id = course.get("teacher_id")
        if owner_id is not None:
            owner = (
                supabase_admin.table("users")
                .select("id,role")
                .eq("id", owner_id)
                .maybe_single()
                .execute()
                .data
            )
            if not owner or owner.get("role") != "teacher":
                owner_id = None
    copied = (
        supabase_admin.table("courses")
        .insert(
            {
                "title": f"{course.get('title') or '未命名課程'}（副本）",
                "description": course.get("description"),
                "teacher_id": owner_id,
                "created_by_user_id": teacher["id"],
                "status": "draft",
                "credit_value": course.get("credit_value", 0),
                "completion_threshold": course.get("completion_threshold", 100),
                "passing_score": course.get("passing_score", 70),
                "retest_cooldown_minutes": course.get("retest_cooldown_minutes", 60),
                "final_question_count": course.get("final_question_count", 10),
                "certification_enabled": course.get("certification_enabled", True),
                "certificate_show_score": course.get("certificate_show_score", True),
            }
        )
        .execute()
        .data
        or []
    )
    if not copied:
        raise HTTPException(status_code=500, detail="複製課程失敗")
    copied_course = copied[0]
    lectures = (
        supabase_admin.table("lectures")
        .select("title,media_url,duration_seconds,sort_order,is_visible")
        .eq("course_id", course_id)
        .order("sort_order")
        .order("id")
        .execute()
        .data
        or []
    )
    if lectures:
        supabase_admin.table("lectures").insert(
            [
                {
                    **lecture,
                    "course_id": copied_course["id"],
                    "status": "uploaded",
                }
                for lecture in lectures
            ]
        ).execute()
    return {"course": copied_course, "copied_lectures": len(lectures)}


@router.patch("/lectures/{lecture_id}")
def update_lecture(
    lecture_id: int,
    payload: LectureUpdate,
    user=Depends(get_current_user),
):
    teacher = require_teacher(user)
    require_lecture_manager(lecture_id, teacher)
    values = payload.model_dump(exclude_unset=True)
    values["updated_at"] = _now()
    response = (
        supabase_admin.table("lectures")
        .update(values)
        .eq("id", lecture_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=500, detail="小節更新失敗")
    return response.data[0]


def _segments_from_edited_transcript(content: str) -> list[dict[str, Any]] | None:
    matches = list(
        re.finditer(
            r"\((\d+):(\d{2})\)\s*(.*?)(?=\s*\(\d+:\d{2}\)|$)",
            content.strip(),
            flags=re.DOTALL,
        )
    )
    if not matches:
        return None
    starts = [int(match.group(1)) * 60 + int(match.group(2)) for match in matches]
    return [
        {
            "start_time": start,
            "end_time": starts[index + 1] if index + 1 < len(starts) else start + 30,
            "text": match.group(3).strip(),
        }
        for index, (match, start) in enumerate(zip(matches, starts))
        if match.group(3).strip()
    ]


@router.patch("/lectures/{lecture_id}/transcript")
def update_transcript(
    lecture_id: int,
    payload: TranscriptUpdate,
    user=Depends(get_current_user),
):
    teacher = require_teacher(user)
    require_lecture_manager(lecture_id, teacher)
    content = payload.content.strip()
    segments = _segments_from_edited_transcript(content)
    response = (
        supabase_admin.table("transcripts")
        .upsert(
            {"lecture_id": lecture_id, "content": content, "segments_json": segments},
            on_conflict="lecture_id",
        )
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=500, detail="逐字稿更新失敗")
    return {
        "lecture_id": lecture_id,
        "content": content,
        "timestamp_segments": len(segments or []),
    }


@router.put("/courses/{course_id}/lecture-order")
def update_lecture_order(
    course_id: int,
    payload: LectureOrderUpdate,
    user=Depends(get_current_user),
):
    teacher = require_teacher(user)
    require_course_manager(course_id, teacher)
    current = (
        supabase_admin.table("lectures")
        .select("id")
        .eq("course_id", course_id)
        .execute()
        .data
        or []
    )
    current_ids = {row["id"] for row in current}
    if len(payload.lecture_ids) != len(current_ids) or set(payload.lecture_ids) != current_ids:
        raise HTTPException(status_code=422, detail="小節排序資料不完整")
    for index, lecture_id in enumerate(payload.lecture_ids):
        supabase_admin.table("lectures").update(
            {"sort_order": index, "updated_at": _now()}
        ).eq("id", lecture_id).eq("course_id", course_id).execute()
    return {"course_id": course_id, "lecture_ids": payload.lecture_ids}


def _transcript_text(lecture_id: int) -> str:
    response = (
        supabase_admin.table("transcripts")
        .select("content,segments_json")
        .eq("lecture_id", lecture_id)
        .maybe_single()
        .execute()
    )
    row = response.data or {}
    segments = row.get("segments_json")
    if isinstance(segments, list) and segments:
        return format_transcript_for_prompt(segments)
    return str(row.get("content") or "").strip()


@router.post("/lectures/{lecture_id}/regenerate")
def regenerate_lecture_content(
    lecture_id: int,
    payload: RegenerateRequest,
    user=Depends(get_current_user),
):
    teacher = require_teacher(user)
    require_lecture_manager(lecture_id, teacher)
    components = list(dict.fromkeys(payload.components))
    if not components:
        raise HTTPException(status_code=422, detail="請至少選擇一種要重新產生的內容")
    transcript_text = _transcript_text(lecture_id)
    if not transcript_text:
        raise HTTPException(status_code=400, detail="這個小節沒有逐字稿，無法重新產生")

    results: dict[str, Any] = {}
    if "summary" in components:
        results["summary"] = generate_summary(
            lecture_id, transcript_text, skip_existing=False
        )
    if "knowledge_points" in components:
        old_rows = (
            supabase_admin.table("knowledge_points")
            .select("id")
            .eq("lecture_id", lecture_id)
            .eq("is_active", True)
            .execute()
            .data
            or []
        )
        results["knowledge_points"] = generate_knowledge_points(
            lecture_id, transcript_text, skip_existing=False
        )
        old_ids = [row["id"] for row in old_rows]
        if old_ids and results["knowledge_points"].get("inserted"):
            supabase_admin.table("knowledge_points").update({"is_active": False}).in_(
                "id", old_ids
            ).execute()
    if "mindmap" in components:
        results["mindmap"] = generate_mindmap(
            lecture_id, transcript_text, skip_existing=False
        )
    if "questions" in components:
        old_rows = (
            supabase_admin.table("questions")
            .select("id")
            .eq("lecture_id", lecture_id)
            .eq("is_active", True)
            .execute()
            .data
            or []
        )
        knowledge_points = (
            supabase_admin.table("knowledge_points")
            .select("*")
            .eq("lecture_id", lecture_id)
            .eq("is_active", True)
            .execute()
            .data
            or []
        )
        results["questions"] = generate_questions(
            lecture_id,
            transcript_text,
            knowledge_points,
            skip_existing=False,
        )
        old_ids = [row["id"] for row in old_rows]
        if old_ids and results["questions"].get("inserted"):
            supabase_admin.table("questions").update({"is_active": False}).in_(
                "id", old_ids
            ).execute()

    supabase_admin.table("lectures").update(
        {"status": "generated", "updated_at": _now()}
    ).eq("id", lecture_id).execute()
    return {"lecture_id": lecture_id, "components": components, "results": results}
