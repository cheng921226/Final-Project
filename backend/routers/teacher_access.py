from typing import Any

from database.supabase import supabase_admin
from fastapi import HTTPException

from roles import CAMPUS_ROLE, can_manage_course, has_teacher_access


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
    if not has_teacher_access(profile.get("role")):
        raise HTTPException(status_code=403, detail="這個帳號沒有教師端權限")
    return profile


def require_course_manager(course_id: int, teacher: dict[str, Any]) -> dict[str, Any]:
    response = (
        supabase_admin.table("courses")
        .select("*")
        .eq("id", course_id)
        .maybe_single()
        .execute()
    )
    course = response.data
    if not course:
        raise HTTPException(status_code=404, detail="找不到課程")
    if not can_manage_course(
        teacher.get("role"),
        teacher.get("id"),
        course.get("teacher_id"),
        course.get("created_by_user_id"),
    ):
        raise HTTPException(status_code=403, detail="沒有權限管理這門課")
    return course


def require_lecture_manager(lecture_id: int, teacher: dict[str, Any]) -> dict[str, Any]:
    response = (
        supabase_admin.table("lectures")
        .select("*")
        .eq("id", lecture_id)
        .maybe_single()
        .execute()
    )
    lecture = response.data
    if not lecture:
        raise HTTPException(status_code=404, detail="找不到小節")
    require_course_manager(lecture["course_id"], teacher)
    return lecture


def course_owner_for_creation(
    teacher: dict[str, Any], requested_teacher_id: int | None
) -> int | None:
    if teacher.get("role") == CAMPUS_ROLE:
        return requested_teacher_id if requested_teacher_id is not None else teacher["id"]
    return teacher["id"]
