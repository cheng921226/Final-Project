from database.supabase import supabase_admin
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class UserCreate(BaseModel):
    name: str
    email: str | None = None
    role: str = "teacher"


# 新增使用者（老師）
@router.post("/users")
def create_user(body: UserCreate):
    res = (
        supabase_admin.table("users")
        .insert(
            {
                "name": body.name,
                "email": body.email,
                "role": body.role,
            }
        )
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=500, detail="新增使用者失敗")
    return res.data[0]


# 取得個人資料
@router.get("/me")
def me():
    return []


# 取得所有老師清單
@router.get("/teachers")
def get_teachers():
    res = supabase_admin.table("users").select("*").eq("role", "teacher").execute()
    return res.data


# 取得講師資訊
@router.get("/teachers/{teacher_id}")
def get_teacher(teacher_id: int):
    res = (
        supabase_admin.table("users")
        .select("*")
        .eq("id", teacher_id)
        .single()
        .execute()
    )
    return res.data
