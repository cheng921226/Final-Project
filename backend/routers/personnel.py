import os
from datetime import datetime, timezone
from typing import Literal

from database.supabase import SUPABASE_KEY, SUPABASE_URL, supabase_admin
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from supabase import create_client

from roles import CAMPUS_ROLE

from .security import AuthContext, get_auth_context


router = APIRouter(prefix="/campus/personnel", tags=["campus-personnel"])


class PersonnelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=9, max_length=128)
    role: Literal["student", "teacher", "campus"]
    student_number: str | None = Field(default=None, max_length=50)
    class_id: int | None = None


class PersonnelUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    role: Literal["student", "teacher", "campus"]
    student_number: str | None = Field(default=None, max_length=50)
    class_id: int | None = None


class PersonnelStatusUpdate(BaseModel):
    active: bool


class PasswordUpdate(BaseModel):
    password: str = Field(min_length=9, max_length=128)


def require_campus(context: AuthContext) -> dict:
    if context.profile.get("role") != CAMPUS_ROLE:
        raise HTTPException(status_code=403, detail="只有校園平台端可以管理人員")
    return context.profile


def normalize_student_fields(role: str, student_number: str | None, class_id: int | None):
    if role != "student":
        return None, None
    normalized_number = (student_number or "").strip().upper()
    if not normalized_number:
        raise HTTPException(status_code=422, detail="學生帳號必須填寫學號")
    return normalized_number, class_id


def auth_user_active(auth_user) -> bool:
    banned_until = getattr(auth_user, "banned_until", None)
    if not banned_until:
        return True
    if isinstance(banned_until, datetime):
        parsed = banned_until
    else:
        try:
            parsed = datetime.fromisoformat(str(banned_until).replace("Z", "+00:00"))
        except ValueError:
            return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed <= datetime.now(timezone.utc)


def list_auth_users() -> dict[str, object]:
    users = supabase_admin.auth.admin.list_users(page=1, per_page=1000)
    return {str(user.id): user for user in users}


def public_personnel(row: dict, auth_user, class_map: dict[int, dict]) -> dict:
    return {
        "id": row.get("id"),
        "auth_id": str(row.get("auth_id")) if row.get("auth_id") else None,
        "name": row.get("name"),
        "email": row.get("email"),
        "role": row.get("role"),
        "student_number": row.get("student_number"),
        "class_id": row.get("class_id"),
        "class_name": (class_map.get(row.get("class_id")) or {}).get("name"),
        "account_status": (
            "incomplete"
            if not auth_user
            else "active" if auth_user_active(auth_user) else "disabled"
        ),
        "email_confirmed": bool(getattr(auth_user, "email_confirmed_at", None)) if auth_user else False,
        "last_sign_in_at": getattr(auth_user, "last_sign_in_at", None) if auth_user else None,
        "created_at": row.get("created_at"),
    }


def get_personnel_or_404(personnel_id: int) -> dict:
    row = (
        supabase_admin.table("users")
        .select("id,auth_id,name,email,role,student_number,class_id,created_at")
        .eq("id", personnel_id)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=404, detail="找不到人員資料")
    return row


def validate_class(class_id: int | None) -> None:
    if class_id is None:
        return
    exists = (
        supabase_admin.table("classes")
        .select("id")
        .eq("id", class_id)
        .maybe_single()
        .execute()
        .data
    )
    if not exists:
        raise HTTPException(status_code=422, detail="指定的班級不存在")


def active_campus_count(auth_users: dict[str, object]) -> int:
    campuses = (
        supabase_admin.table("users")
        .select("auth_id")
        .eq("role", CAMPUS_ROLE)
        .execute()
        .data
        or []
    )
    return sum(
        1
        for row in campuses
        if row.get("auth_id")
        and (auth_user := auth_users.get(str(row["auth_id"])))
        and auth_user_active(auth_user)
    )


@router.get("")
def get_personnel(context: AuthContext = Depends(get_auth_context)):
    actor = require_campus(context)
    rows = (
        supabase_admin.table("users")
        .select("id,auth_id,name,email,role,student_number,class_id,created_at")
        .order("id")
        .execute()
        .data
        or []
    )
    classes = (
        supabase_admin.table("classes")
        .select("id,name")
        .order("name")
        .execute()
        .data
        or []
    )
    class_map = {row["id"]: row for row in classes}
    auth_users = list_auth_users()
    return {
        "actor_id": actor["id"],
        "classes": classes,
        "personnel": [
            public_personnel(row, auth_users.get(str(row.get("auth_id"))), class_map)
            for row in rows
        ],
    }


@router.post("")
def create_personnel(
    body: PersonnelCreate,
    context: AuthContext = Depends(get_auth_context),
):
    require_campus(context)
    student_number, class_id = normalize_student_fields(
        body.role, body.student_number, body.class_id
    )
    validate_class(class_id)
    name = body.name.strip()
    email = str(body.email).strip().lower()

    if (
        supabase_admin.table("users")
        .select("id")
        .eq("email", email)
        .maybe_single()
        .execute()
        .data
    ):
        raise HTTPException(status_code=409, detail="這個 Email 已經存在")

    auth_user = None
    try:
        response = supabase_admin.auth.admin.create_user(
            {
                "email": email,
                "password": body.password,
                "email_confirm": True,
                "user_metadata": {"name": name, "student_number": student_number},
            }
        )
        auth_user = response.user
        if not auth_user:
            raise RuntimeError("Supabase Auth 沒有回傳新帳號")
        profile = (
            supabase_admin.table("users")
            .select("id")
            .eq("auth_id", str(auth_user.id))
            .maybe_single()
            .execute()
            .data
        )
        values = {
            "name": name,
            "email": email,
            "role": body.role,
            "auth_id": str(auth_user.id),
            "student_number": student_number,
            "class_id": class_id,
        }
        if profile:
            created = (
                supabase_admin.table("users")
                .update(values)
                .eq("id", profile["id"])
                .execute()
                .data
                or []
            )
        else:
            created = supabase_admin.table("users").insert(values).execute().data or []
        if not created:
            raise RuntimeError("人員資料寫入失敗")
        return {"message": "人員已建立", "id": created[0]["id"]}
    except HTTPException:
        raise
    except Exception as exc:
        if auth_user:
            try:
                supabase_admin.auth.admin.delete_user(str(auth_user.id))
            except Exception:
                pass
        raise HTTPException(status_code=400, detail=f"新增人員失敗：{exc}") from exc


@router.patch("/{personnel_id}")
def update_personnel(
    personnel_id: int,
    body: PersonnelUpdate,
    context: AuthContext = Depends(get_auth_context),
):
    actor = require_campus(context)
    target = get_personnel_or_404(personnel_id)
    student_number, class_id = normalize_student_fields(
        body.role, body.student_number, body.class_id
    )
    validate_class(class_id)

    if personnel_id == actor["id"] and body.role != CAMPUS_ROLE:
        raise HTTPException(status_code=422, detail="不能移除自己的平台端角色")
    if target.get("role") == CAMPUS_ROLE and body.role != CAMPUS_ROLE:
        auth_users = list_auth_users()
        if active_campus_count(auth_users) <= 1:
            raise HTTPException(status_code=422, detail="系統至少要保留一個可用的平台端帳號")
    if target.get("role") == "teacher" and body.role != "teacher":
        assigned = (
            supabase_admin.table("courses")
            .select("id")
            .eq("teacher_id", personnel_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if assigned:
            raise HTTPException(status_code=422, detail="請先重新指派此教師的課程，再變更角色")

    name = body.name.strip()
    email = str(body.email).strip().lower()
    duplicate = (
        supabase_admin.table("users")
        .select("id")
        .eq("email", email)
        .execute()
        .data
        or []
    )
    if any(row["id"] != personnel_id for row in duplicate):
        raise HTTPException(status_code=409, detail="這個 Email 已經存在")

    if target.get("auth_id"):
        supabase_admin.auth.admin.update_user_by_id(
            str(target["auth_id"]),
            {
                "email": email,
                "email_confirm": True,
                "user_metadata": {"name": name, "student_number": student_number},
            },
        )
    updated = (
        supabase_admin.table("users")
        .update(
            {
                "name": name,
                "email": email,
                "role": body.role,
                "student_number": student_number,
                "class_id": class_id,
            }
        )
        .eq("id", personnel_id)
        .execute()
        .data
        or []
    )
    if not updated:
        raise HTTPException(status_code=500, detail="人員資料更新失敗")
    return {"message": "人員資料已更新"}


@router.patch("/{personnel_id}/status")
def update_personnel_status(
    personnel_id: int,
    body: PersonnelStatusUpdate,
    context: AuthContext = Depends(get_auth_context),
):
    actor = require_campus(context)
    target = get_personnel_or_404(personnel_id)
    if not target.get("auth_id"):
        raise HTTPException(status_code=422, detail="此人員沒有登入帳號")
    if personnel_id == actor["id"] and not body.active:
        raise HTTPException(status_code=422, detail="不能停用自己的帳號")
    if target.get("role") == CAMPUS_ROLE and not body.active:
        auth_users = list_auth_users()
        if active_campus_count(auth_users) <= 1:
            raise HTTPException(status_code=422, detail="系統至少要保留一個可用的平台端帳號")

    supabase_admin.auth.admin.update_user_by_id(
        str(target["auth_id"]),
        {"ban_duration": "none" if body.active else "876000h"},
    )
    return {"message": "帳號已啟用" if body.active else "帳號已停用"}


@router.post("/{personnel_id}/password-reset")
def send_password_reset(
    personnel_id: int,
    context: AuthContext = Depends(get_auth_context),
):
    require_campus(context)
    target = get_personnel_or_404(personnel_id)
    if not target.get("auth_id") or not target.get("email"):
        raise HTTPException(status_code=422, detail="此人員沒有完整的登入帳號")
    redirect_to = os.getenv(
        "PASSWORD_RESET_REDIRECT_URL", "http://localhost:3000/reset-password"
    )
    auth_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    auth_client.auth.reset_password_for_email(
        target["email"], {"redirect_to": redirect_to}
    )
    return {"message": "密碼重設信已寄出"}


@router.post("/account/password")
def update_recovery_password(
    body: PasswordUpdate,
    context: AuthContext = Depends(get_auth_context),
):
    supabase_admin.auth.admin.update_user_by_id(
        str(context.user.id), {"password": body.password}
    )
    return {"message": "密碼已更新"}
