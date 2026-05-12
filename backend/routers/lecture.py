from database.supabase import supabase
from fastapi import APIRouter

router = APIRouter()

# 取得所有課程
@router.get("/lecture")
def get_lectures():
    res = supabase.table("lectures").select("*").execute()
    return res.data

# 取得特定課程
@router.get("/lecture/{lecture_id}")
def get_seleted_lectures(lecture_id : int):
    res = supabase.table("lectures").select("*").eq("id",lecture_id).execute()
    return res.data