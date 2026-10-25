from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .personnel import class_sort_key, require_campus
from .security import AuthContext, get_auth_context


router = APIRouter(prefix="/campus/enrollments", tags=["campus-enrollments"])


class EnrollmentBatch(BaseModel):
    student_ids: list[int] = Field(min_length=1, max_length=1000)


def get_course_or_404(course_id: int, courses: list[dict[str, Any]] | None = None):
    course = next(
        (row for row in (courses or []) if row.get("id") == course_id),
        None,
    )
    if course is None:
        course = (
            supabase_admin.table("courses")
            .select("id,title,status,teacher_id,created_by_user_id")
            .eq("id", course_id)
            .maybe_single()
            .execute()
            .data
        )
    if not course:
        raise HTTPException(status_code=404, detail="找不到課程")
    return course


def validate_student_ids(student_ids: list[int]) -> list[int]:
    unique_ids = list(dict.fromkeys(student_ids))
    rows = (
        supabase_admin.table("users")
        .select("id")
        .in_("id", unique_ids)
        .eq("role", "student")
        .execute()
        .data
        or []
    )
    valid_ids = {row["id"] for row in rows}
    invalid_ids = [student_id for student_id in unique_ids if student_id not in valid_ids]
    if invalid_ids:
        raise HTTPException(
            status_code=422,
            detail=f"以下人員不是有效學生：{', '.join(map(str, invalid_ids[:10]))}",
        )
    return unique_ids


@router.get("")
def get_enrollment_management(
    course_id: int | None = None,
    context: AuthContext = Depends(get_auth_context),
):
    require_campus(context)
    courses = (
        supabase_admin.table("courses")
        .select("id,title,status,teacher_id,created_by_user_id")
        .order("title")
        .execute()
        .data
        or []
    )
    people_ids = {
        row.get("teacher_id") for row in courses if row.get("teacher_id") is not None
    }
    teachers = {}
    if people_ids:
        teachers = {
            row["id"]: row
            for row in (
                supabase_admin.table("users")
                .select("id,name,email")
                .in_("id", list(people_ids))
                .execute()
                .data
                or []
            )
        }
    course_options = [
        {
            **course,
            "teacher_name": (
                teachers.get(course.get("teacher_id"), {}).get("name")
                or teachers.get(course.get("teacher_id"), {}).get("email")
                or "尚未指派"
            ),
        }
        for course in courses
    ]
    selected_course_id = course_id or (courses[0]["id"] if courses else None)
    if selected_course_id is None:
        return {"courses": [], "classes": [], "course_id": None, "students": []}
    get_course_or_404(selected_course_id, courses)

    classes = (
        supabase_admin.table("classes").select("id,name").execute().data or []
    )
    classes.sort(key=class_sort_key)
    class_map = {row["id"]: row for row in classes}
    students = (
        supabase_admin.table("users")
        .select("id,name,email,student_number,class_id")
        .eq("role", "student")
        .order("student_number")
        .execute()
        .data
        or []
    )
    enrollments = (
        supabase_admin.table("student_courses")
        .select("id,student_id,created_at")
        .eq("course_id", selected_course_id)
        .execute()
        .data
        or []
    )
    enrollment_map = {row["student_id"]: row for row in enrollments}
    return {
        "courses": course_options,
        "classes": classes,
        "course_id": selected_course_id,
        "students": [
            {
                **student,
                "class_name": (class_map.get(student.get("class_id")) or {}).get("name"),
                "enrolled": student["id"] in enrollment_map,
                "enrollment_id": (enrollment_map.get(student["id"]) or {}).get("id"),
                "enrolled_at": (enrollment_map.get(student["id"]) or {}).get("created_at"),
            }
            for student in students
        ],
    }


@router.post("/{course_id}")
def enroll_students(
    course_id: int,
    body: EnrollmentBatch,
    context: AuthContext = Depends(get_auth_context),
):
    require_campus(context)
    get_course_or_404(course_id)
    student_ids = validate_student_ids(body.student_ids)
    rows = [
        {"course_id": course_id, "student_id": student_id}
        for student_id in student_ids
    ]
    supabase_admin.table("student_courses").upsert(
        rows, on_conflict="student_id,course_id"
    ).execute()
    return {"message": f"已加入 {len(student_ids)} 位學生", "count": len(student_ids)}


@router.delete("/{course_id}")
def unenroll_students(
    course_id: int,
    body: EnrollmentBatch,
    context: AuthContext = Depends(get_auth_context),
):
    require_campus(context)
    get_course_or_404(course_id)
    student_ids = validate_student_ids(body.student_ids)
    response = (
        supabase_admin.table("student_courses")
        .delete()
        .eq("course_id", course_id)
        .in_("student_id", student_ids)
        .execute()
    )
    return {
        "message": f"已將 {len(response.data or [])} 位學生移出課程，學習紀錄仍保留",
        "count": len(response.data or []),
    }
