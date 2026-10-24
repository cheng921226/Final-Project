from fastapi import APIRouter, Depends

from .security import AuthContext, get_auth_context

router = APIRouter()


@router.get("/lectures/{lecture_id}/chats/history")
def get_chat_history(
    lecture_id: int,
    context: AuthContext = Depends(get_auth_context),
):
    res = (
        context.database.table("chat_messages")
        .select("question,answer,video_timestamp,created_at")
        .eq("lecture_id", lecture_id)
        .eq("student_id", context.profile["id"])
        .order("created_at")
        .execute()
    )
    return res.data
