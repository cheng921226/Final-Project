from database.supabase import supabase_admin
from fastapi import APIRouter

router = APIRouter()


@router.get("/lectures/{lecture_id}/chats/history")
def get_chat_history(lecture_id: int, user_id: int):
    res = (
        supabase_admin.table("chat_messages")
        .select("*")
        .eq("lecture_id", lecture_id)
        .eq("student_id", user_id)
        .order("created_at")
        .execute()
    )
    return res.data
