from database.supabase import supabase
from fastapi import APIRouter, Query

router = APIRouter()

# 取得所有課程 + 輸入keyword可搜尋
@router.get("/lectures")
def get_lectures(keyword : str = None):
    query = supabase.table("lectures").select("*")

    if keyword:
        query = query.ilike("title", f"%{keyword}%")

    res = query.execute()
    return res.data

# 取得特定課程
@router.get("/lectures/{lecture_id}")
def get_seleted_lectures(lecture_id : int):
    res = supabase.table("lectures").select("*").eq("id",lecture_id).execute()
    return res.data

# 取得該課程逐字稿
@router.get("/lectures/{lecture_id}/transcripts")
def get_lecture_transcript(lecture_id : int):
    res = supabase.table("transcripts").select("*").eq("lecture_id",lecture_id).execute()
    return res.data

# 取得該課程摘要
@router.get("/lectures/{lecture_id}/summaries")
def get_lecture_summary(lecture_id : int):
    res = supabase.table("summaries").select("*").eq("lecture_id",lecture_id).single().execute()
    return res.data

# 取得該課程知識點
@router.get("/lectures/{lecture_id}/knowledge_points")
def get_lecture_knowledge_points(lecture_id : int):
    res = supabase.table("knowledge_points").select("*").eq("lecture_id", lecture_id).execute()
    return res.data

# 取得該課程心智圖
@router.get("/lectures/{lecture_id}/mindmaps")
def get_lecture_mindmap(lecture_id : int):
    res = supabase.table("mindmaps").select("*").eq("lecture_id",lecture_id).execute()
    return res.data