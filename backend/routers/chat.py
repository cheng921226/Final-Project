from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException

from .security import get_current_user
from .users import get_student_id_from_auth

router = APIRouter()


@router.get("/lectures/{lecture_id}/chats/history")
def get_chat_history(lecture_id: int, user=Depends(get_current_user)):
    try:
        student_id = get_student_id_from_auth(user)
    except (KeyError, TypeError):
        raise HTTPException(status_code=404, detail="找不到使用者資料")

    res = (
        supabase_admin.table("chat_messages")
        .select("question,answer,video_timestamp,created_at")
        .eq("lecture_id", lecture_id)
        .eq("student_id", student_id)
        .order("created_at")
        .execute()
    )
    return res.data
