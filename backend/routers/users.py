from database.supabase import supabase_admin
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from .security import get_current_user

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


# 內部取 id 函式
def get_student_id_from_auth(user):
    res = (
        supabase_admin.table("users")
        .select("id")
        .eq("auth_id", user.id)
        .single()
        .execute()
    )
    return res.data["id"]


# 取得用戶 ID
@router.get("/id")
def get_user_id(user=Depends(get_current_user)):
    res = (
        supabase_admin.table("users")
        .select("id")
        .eq("auth_id", user.id)
        .single()
        .execute()
    )
    return res.data


# 取得用戶名
@router.get("/name")
def get_user_name(user=Depends(get_current_user)):
    res = (
        supabase_admin.table("users")
        .select("name,email,role")
        .eq("auth_id", user.id)
        .single()
        .execute()
    )
    return res.data


# 取得用戶身分
@router.get("/role")
def get_user_role(user=Depends(get_current_user)):
    res = (
        supabase_admin.table("users")
        .select("role")
        .eq("auth_id", user.id)
        .single()
        .execute()
    )
    return res.data


# 取得個人資料
@router.get("/info")
def get_user_info(user=Depends(get_current_user)):
    res = (
        supabase_admin.table("users")
        .select("*")
        .eq("auth_id", user.id)
        .single()
        .execute()
    )
    return res.data


# 取得該課程學生對話
@router.get("/lectures/{lecture_id}/chats")
def get_lecture_chats(lecture_id: int, user=Depends(get_current_user)):
    db_user = (
        supabase_admin.table("users")
        .select("id")
        .eq("auth_id", user.id)
        .single()
        .execute()
    )

    if not db_user.data:
        raise HTTPException(404, "找不到使用者資料")

    student_id = db_user.data["id"]

    chats = (
        supabase_admin.table("chat_messages")
        .select("question, answer, video_timestamp, created_at")
        .eq("lecture_id", lecture_id)
        .eq("student_id", student_id)
        .order("created_at")
        .execute()
    )
    return {"lecture_id": lecture_id, "messages": chats.data}


# 給 ai 助教的記憶函式
def get_chat_context(lecture_id: int, student_id: int, limit: int = 10):
    chats = (
        supabase_admin.table("chat_messages")
        .select("question, answer")
        .eq("lecture_id", lecture_id)
        .eq("student_id", student_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    messages = []

    for chat in reversed(chats.data):
        messages.append({"role": "user", "content": chat["question"]})
        messages.append({"role": "assistant", "content": chat["answer"]})

    return messages


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
