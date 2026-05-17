from database.supabase import supabase
from fastapi import APIRouter, Query

router = APIRouter()

# 取得所有課程
@router.get("/lecture")
def get_lectures():
    res = supabase.table("lectures").select("*").execute()
    return res.data

# 取得特定課程
@router.get("/lectures/{lecture_id}")
def get_seleted_lectures(lecture_id : int):
    res = supabase.table("lectures").select("*").eq("id",lecture_id).execute()
    return res.data

# 取得該課程摘要
@router.get("/lecture/{lecture_id}/summary")
def get_lecture_summary(lecture_id : int):
    res = supabase.table("summaries").select("*").eq("lecture_id",lecture_id).single().execute()
    return res.data

# 取得該課程知識點
@router.get("/lecture/{lecture_id}/knowledge_points")
def get_lecture_knowledge_points(lecture_id : int):
    res = supabase.table("knowledge_points").select("*").eq("lecture_id",lecture_id).execute()
    return res.data