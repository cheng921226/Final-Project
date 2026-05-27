from database.supabase import supabase_admin
from fastapi import APIRouter

router = APIRouter()


@router.get("/lectures/{lecture_id}/chats/history")
def get_chat_history(lecture_id: int, user_id: int):
    res = (
        supabase_admin.table("chat_logs")
        .select("*")
        .eq("lecture_id", lecture_id)
        .eq("student_id", user_id)
        .execute()
    )
    return res.data
