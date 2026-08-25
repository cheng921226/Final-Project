from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .security import get_current_user
from .users import get_student_id_from_auth

router = APIRouter()

DEMO_ACCOUNT_EMAILS = {"teststudent@example.com"}


class QuestionAttemptCreate(BaseModel):
    lecture_id: int
    selected_answer: str
    video_time: float | None = None


class TeacherQuestionPayload(BaseModel):
    lecture_id: int
    question_text: str
    options_json: list[str] = []
    answer: str
    explanation: str | None = None
    source_timestamp: int | None = None
    knowledge_point_id: int | None = None


class TeacherQuestionUpdate(BaseModel):
    lecture_id: int | None = None
    question_text: str | None = None
    options_json: list[str] | None = None
    answer: str | None = None
    explanation: str | None = None
    source_timestamp: int | None = None
    knowledge_point_id: int | None = None


def normalize_answer(value: Any) -> str:
    text = str(value or "").strip().upper()
    if not text:
        return ""
    return text[0]


def public_question(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "lecture_id": row.get("lecture_id"),
        "knowledge_point_id": row.get("knowledge_point_id"),
        "question_text": row.get("question_text"),
        "options_json": row.get("options_json") or [],
        "explanation": row.get("explanation"),
        "source_timestamp": row.get("source_timestamp"),
    }


def teacher_question(row: dict[str, Any]) -> dict[str, Any]:
    return {
        **public_question(row),
        "answer": row.get("answer"),
    }


def get_user_profile(user) -> dict[str, Any]:
    response = (
        supabase_admin.table("users")
        .select("*")
        .eq("auth_id", user.id)
        .maybe_single()
        .execute()
    )
    profile = response.data
    if not profile:
        raise HTTPException(status_code=404, detail="找不到使用者資料")
    return profile


def require_teacher(user) -> dict[str, Any]:
    profile = get_user_profile(user)
    if profile.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="這個帳號沒有老師權限")
    return profile


def get_lecture_for_teacher(lecture_id: int, teacher: dict[str, Any]) -> dict[str, Any]:
    lecture_response = (
        supabase_admin.table("lectures")
        .select("*")
        .eq("id", lecture_id)
        .maybe_single()
        .execute()
    )
    lecture = lecture_response.data
    if not lecture:
        raise HTTPException(status_code=404, detail="找不到小節")

    course_response = (
        supabase_admin.table("courses")
        .select("id, teacher_id")
        .eq("id", lecture.get("course_id"))
        .maybe_single()
        .execute()
    )
    course = course_response.data
    if course and course.get("teacher_id") not in (None, teacher.get("id")):
        raise HTTPException(status_code=403, detail="沒有權限管理這門課的題目")

    return lecture


def teacher_question_row(body: TeacherQuestionPayload | TeacherQuestionUpdate) -> dict[str, Any]:
    data = body.model_dump(exclude_unset=True)
    if "answer" in data:
        data["answer"] = normalize_answer(data["answer"])
    return data


def is_demo_user(user) -> bool:
    email = (getattr(user, "email", None) or "").lower()
    if email in DEMO_ACCOUNT_EMAILS:
        return True

    response = (
        supabase_admin.table("users")
        .select("email")
        .eq("auth_id", user.id)
        .maybe_single()
        .execute()
    )
    db_email = (response.data or {}).get("email") or ""
    return db_email.lower() in DEMO_ACCOUNT_EMAILS


def require_demo_user(user):
    if not is_demo_user(user):
        raise HTTPException(
            status_code=403,
            detail="Only demo accounts can reset question attempts",
        )


@router.get("/lectures/{lecture_id}/questions")
def get_lecture_questions(lecture_id: int):
    response = (
        supabase_admin.table("questions")
        .select(
            "id, lecture_id, knowledge_point_id, question_text, options_json, "
            "explanation, source_timestamp"
        )
        .eq("lecture_id", lecture_id)
        .order("source_timestamp")
        .execute()
    )
    return [
        public_question(row)
        for row in response.data or []
        if row.get("source_timestamp") is not None
    ]


@router.get("/teacher/question-review")
def get_teacher_question_review(user=Depends(get_current_user)):
    teacher = require_teacher(user)

    courses = (
        supabase_admin.table("courses")
        .select("*")
        .eq("teacher_id", teacher["id"])
        .order("id")
        .execute()
        .data
        or []
    )

    if not courses:
        return {"teacher": teacher, "courses": []}

    course_ids = [course["id"] for course in courses if course.get("id") is not None]
    lectures = (
        supabase_admin.table("lectures")
        .select("*")
        .in_("course_id", course_ids)
        .order("id")
        .execute()
        .data
        or []
    )
    lecture_ids = [
        lecture["id"] for lecture in lectures if lecture.get("id") is not None
    ]

    questions = []
    knowledge_points = []
    if lecture_ids:
        questions = (
            supabase_admin.table("questions")
            .select(
                "id, lecture_id, knowledge_point_id, question_text, options_json, "
                "answer, explanation, source_timestamp"
            )
            .in_("lecture_id", lecture_ids)
            .order("source_timestamp")
            .execute()
            .data
            or []
        )
        knowledge_points = (
            supabase_admin.table("knowledge_points")
            .select("id, lecture_id, title, start_time, end_time")
            .in_("lecture_id", lecture_ids)
            .order("start_time")
            .execute()
            .data
            or []
        )

    for lecture in lectures:
        lecture["questions"] = [
            teacher_question(question)
            for question in questions
            if question.get("lecture_id") == lecture.get("id")
        ]
        lecture["knowledge_points"] = [
            point for point in knowledge_points if point.get("lecture_id") == lecture.get("id")
        ]

    for course in courses:
        course["lectures"] = [
            lecture for lecture in lectures if lecture.get("course_id") == course.get("id")
        ]

    return {"teacher": teacher, "courses": courses}


@router.post("/teacher/questions")
def create_teacher_question(
    body: TeacherQuestionPayload, user=Depends(get_current_user)
):
    teacher = require_teacher(user)
    get_lecture_for_teacher(body.lecture_id, teacher)

    row = teacher_question_row(body)
    if not row.get("question_text", "").strip():
        raise HTTPException(status_code=422, detail="題目內容不可空白")
    if not row.get("answer"):
        raise HTTPException(status_code=422, detail="請設定正確答案")

    response = supabase_admin.table("questions").insert(row).execute()
    if not response.data:
        raise HTTPException(status_code=500, detail="新增題目失敗")
    return teacher_question(response.data[0])


@router.patch("/teacher/questions/{question_id}")
def update_teacher_question(
    question_id: int, body: TeacherQuestionUpdate, user=Depends(get_current_user)
):
    teacher = require_teacher(user)
    existing_response = (
        supabase_admin.table("questions")
        .select("*")
        .eq("id", question_id)
        .maybe_single()
        .execute()
    )
    existing = existing_response.data
    if not existing:
        raise HTTPException(status_code=404, detail="找不到題目")

    target_lecture_id = body.lecture_id or existing.get("lecture_id")
    get_lecture_for_teacher(target_lecture_id, teacher)

    update_data = teacher_question_row(body)
    if not update_data:
        raise HTTPException(status_code=422, detail="請至少提供一個要更新的欄位")
    if update_data.get("question_text") is not None and not update_data["question_text"].strip():
        raise HTTPException(status_code=422, detail="題目內容不可空白")
    if update_data.get("answer") == "":
        raise HTTPException(status_code=422, detail="請設定正確答案")

    response = (
        supabase_admin.table("questions")
        .update(update_data)
        .eq("id", question_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=500, detail="修改題目失敗")
    return teacher_question(response.data[0])


@router.delete("/teacher/questions/{question_id}")
def delete_teacher_question(question_id: int, user=Depends(get_current_user)):
    teacher = require_teacher(user)
    existing_response = (
        supabase_admin.table("questions")
        .select("id, lecture_id")
        .eq("id", question_id)
        .maybe_single()
        .execute()
    )
    existing = existing_response.data
    if not existing:
        raise HTTPException(status_code=404, detail="找不到題目")
    get_lecture_for_teacher(existing["lecture_id"], teacher)

    response = (
        supabase_admin.table("questions")
        .delete()
        .eq("id", question_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=500, detail="刪除題目失敗")
    return {"message": "deleted", "question_id": question_id}


@router.get("/lectures/{lecture_id}/question-attempts")
def get_lecture_question_attempts(lecture_id: int, user=Depends(get_current_user)):
    student_id = get_student_id_from_auth(user)
    response = (
        supabase_admin.table("question_attempts")
        .select("*")
        .eq("lecture_id", lecture_id)
        .eq("student_id", student_id)
        .execute()
    )
    return response.data or []


@router.delete("/lectures/{lecture_id}/question-attempts")
def reset_lecture_question_attempts(lecture_id: int, user=Depends(get_current_user)):
    require_demo_user(user)
    student_id = get_student_id_from_auth(user)
    response = (
        supabase_admin.table("question_attempts")
        .delete()
        .eq("lecture_id", lecture_id)
        .eq("student_id", student_id)
        .execute()
    )
    return {
        "message": "question attempts reset",
        "scope": "lecture",
        "lecture_id": lecture_id,
        "deleted_count": len(response.data or []),
    }


@router.delete("/courses/{course_id}/question-attempts")
def reset_course_question_attempts(course_id: int, user=Depends(get_current_user)):
    require_demo_user(user)
    student_id = get_student_id_from_auth(user)
    lectures = (
        supabase_admin.table("lectures")
        .select("id")
        .eq("course_id", course_id)
        .execute()
        .data
        or []
    )
    lecture_ids = [
        lecture["id"] for lecture in lectures if lecture.get("id") is not None
    ]
    if not lecture_ids:
        return {
            "message": "question attempts reset",
            "scope": "course",
            "course_id": course_id,
            "deleted_count": 0,
        }

    response = (
        supabase_admin.table("question_attempts")
        .delete()
        .in_("lecture_id", lecture_ids)
        .eq("student_id", student_id)
        .execute()
    )
    return {
        "message": "question attempts reset",
        "scope": "course",
        "course_id": course_id,
        "lecture_ids": lecture_ids,
        "deleted_count": len(response.data or []),
    }


@router.post("/questions/{question_id}/attempt")
def create_question_attempt(
    question_id: int,
    body: QuestionAttemptCreate,
    user=Depends(get_current_user),
):
    student_id = get_student_id_from_auth(user)
    question_response = (
        supabase_admin.table("questions")
        .select("*")
        .eq("id", question_id)
        .maybe_single()
        .execute()
    )
    question = question_response.data
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    if question.get("lecture_id") != body.lecture_id:
        raise HTTPException(
            status_code=400, detail="Question does not belong to lecture"
        )

    selected_answer = normalize_answer(body.selected_answer)
    correct_answer = normalize_answer(question.get("answer"))
    is_correct = bool(selected_answer and selected_answer == correct_answer)

    attempt_row = {
        "student_id": student_id,
        "lecture_id": body.lecture_id,
        "question_id": question_id,
        "selected_answer": selected_answer,
        "is_correct": is_correct,
        "video_time": body.video_time,
    }

    try:
        insert_response = (
            supabase_admin.table("question_attempts").insert(attempt_row).execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "Question attempt save failed. Make sure the question_attempts "
                f"table exists. Original error: {exc}"
            ),
        ) from exc

    return {
        "question_id": question_id,
        "selected_answer": selected_answer,
        "is_correct": is_correct,
        "correct_answer": correct_answer,
        "explanation": question.get("explanation"),
        "attempt": (insert_response.data or [attempt_row])[0],
    }
