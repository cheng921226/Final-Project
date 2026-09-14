import csv
import io
from datetime import datetime, timezone
from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException, Response

from roles import CAMPUS_ROLE

from .achievements import evaluate_course
from .security import get_current_user

router = APIRouter(prefix="/campus", tags=["campus"])


def require_campus(user) -> dict[str, Any]:
    response = (
        supabase_admin.table("users")
        .select("id,name,email,role")
        .eq("auth_id", user.id)
        .maybe_single()
        .execute()
    )
    profile = response.data
    if not profile or profile.get("role") != CAMPUS_ROLE:
        raise HTTPException(status_code=403, detail="這個功能只有校園平台端可以使用")
    return profile


def _course_credit_roster(course_id: int) -> dict[str, Any]:
    course_response = (
        supabase_admin.table("courses")
        .select("*")
        .eq("id", course_id)
        .maybe_single()
        .execute()
    )
    course = course_response.data
    if not course:
        raise HTTPException(status_code=404, detail="找不到課程")

    enrollments = (
        supabase_admin.table("student_courses")
        .select("student_id,created_at")
        .eq("course_id", course_id)
        .order("created_at")
        .execute()
        .data
        or []
    )
    student_ids = [
        row["student_id"] for row in enrollments if row.get("student_id") is not None
    ]
    if not student_ids:
        return {"course": course, "students": []}

    students = (
        supabase_admin.table("users")
        .select("id,student_number,name,email")
        .in_("id", student_ids)
        .eq("role", "student")
        .order("student_number")
        .execute()
        .data
        or []
    )
    lectures = (
        supabase_admin.table("lectures")
        .select("*")
        .eq("course_id", course_id)
        .order("id")
        .execute()
        .data
        or []
    )
    lecture_ids = [row["id"] for row in lectures if row.get("id") is not None]

    progresses: list[dict[str, Any]] = []
    attempts: list[dict[str, Any]] = []
    if lecture_ids:
        progresses = (
            supabase_admin.table("video_progresses")
            .select("*")
            .in_("student_id", student_ids)
            .in_("lecture_id", lecture_ids)
            .execute()
            .data
            or []
        )
        attempts = (
            supabase_admin.table("question_attempts")
            .select("*")
            .in_("student_id", student_ids)
            .in_("lecture_id", lecture_ids)
            .execute()
            .data
            or []
        )

    enrolled_at = {
        row.get("student_id"): row.get("created_at") for row in enrollments
    }
    roster = []
    for student in students:
        student_id = student["id"]
        result = evaluate_course(
            course,
            lectures,
            [row for row in progresses if row.get("student_id") == student_id],
            [row for row in attempts if row.get("student_id") == student_id],
        )
        roster.append(
            {
                "student_id": student_id,
                "student_number": student.get("student_number"),
                "name": student.get("name"),
                "email": student.get("email"),
                "enrolled_at": enrolled_at.get(student_id),
                "completed_lectures": result["completed_lectures"],
                "total_lectures": result["lecture_count"],
                "completion_percentage": result["completion_percentage"],
                "quiz_average": result["quiz_average"],
                "course_passed": result["course_passed"],
                "credits_earned": result["credits_earned"],
                "credits_total": result["credits_total"],
                "certification_earned": result["certification_earned"],
                "status_label": result["status_label"],
            }
        )

    return {"course": course, "students": roster}


@router.get("/courses/{course_id}/credit-roster")
def get_course_credit_roster(course_id: int, user=Depends(get_current_user)):
    require_campus(user)
    return _course_credit_roster(course_id)


@router.get("/courses/{course_id}/credit-roster.csv")
def export_course_credit_roster(course_id: int, user=Depends(get_current_user)):
    require_campus(user)
    roster = _course_credit_roster(course_id)
    students = roster["students"]
    if not students:
        raise HTTPException(status_code=404, detail="這門課目前沒有選課學生")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "學號",
            "姓名",
            "電子信箱",
            "課程名稱",
            "選課時間",
            "完成小節",
            "小節總數",
            "完成度",
            "測驗平均",
            "是否取得學分",
            "取得學分數",
            "課程學分數",
            "認證狀態",
            "資料計算時間",
        ]
    )
    calculated_at = datetime.now(timezone.utc).isoformat()
    course_title = roster["course"].get("title") or f"課程 {course_id}"
    for student in students:
        writer.writerow(
            [
                student.get("student_number") or "尚未填寫",
                student.get("name") or "",
                student.get("email") or "",
                course_title,
                student.get("enrolled_at") or "",
                student["completed_lectures"],
                student["total_lectures"],
                f'{student["completion_percentage"]}%',
                "尚無作答" if student["quiz_average"] is None else student["quiz_average"],
                "是" if student["course_passed"] else "否",
                student["credits_earned"],
                student["credits_total"],
                "已取得" if student["certification_earned"] else "未取得",
                calculated_at,
            ]
        )

    filename = f"course-{course_id}-credit-roster.csv"
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
