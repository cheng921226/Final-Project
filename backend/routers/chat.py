from database.supabase import supabase_admin
from fastapi import APIRouter
from routers.security import get_current_user
from fastapi import Depends


router = APIRouter()


@router.get("/lectures/{lecture_id}/chats/history")
def get_chat_history(lecture_id: int, user=Depends(get_current_user)):
    res = (
        supabase_admin.table("chat_logs")
        .select("*")
        .eq("lecture_id", lecture_id)
        .eq("student_id", user.id)
        .execute()
    )
    return res.data
