from database.supabase import supabase
from fastapi import APIRouter

router = APIRouter()


# 取得個人資料
@router.get("/me")
def me():
    return []


# 取得講師資訊
@router.get("/teachers/{teacher_id}")
def get_teacher(teacher_id: int):
    res = supabase.table("users").select("*").eq("id", teacher_id).single().execute()
    return res.data
