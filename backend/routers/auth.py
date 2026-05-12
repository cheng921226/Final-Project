from database.supabase import supabase
from fastapi import APIRouter

router = APIRouter()

@router.post("/register")
def register():
    return []

@router.post("/login")
def login():
    return []

@router.get("/me")
def me():
    return []