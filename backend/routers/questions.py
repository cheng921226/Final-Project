from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .security import get_current_user
from .users import get_student_id_from_auth

router = APIRouter()


class QuestionAttemptCreate(BaseModel):
    lecture_id: int
    selected_answer: str
    video_time: float | None = None


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
        "start_time": row.get("start_time"),
        "end_time": row.get("end_time"),
    }


@router.get("/lectures/{lecture_id}/questions")
def get_lecture_questions(lecture_id: int):
    response = (
        supabase_admin.table("questions")
        .select(
            "id, lecture_id, knowledge_point_id, question_text, options_json, "
            "explanation, source_timestamp, start_time, end_time"
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
