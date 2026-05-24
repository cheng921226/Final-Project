from database.supabase import supabase
from fastapi import APIRouter,HTTPException
from pydantic import BaseModel

router = APIRouter()

class RegisterRequest(BaseModel):
    name:str
    email:str
    password:str

@router.post("/register")
def register(data : RegisterRequest):
    try:
        res = supabase.auth.sign_up({
            "email":data.email,
            "password":data.password
        })

        user=res.user
        
        if user is None:
            raise HTTPException(400, "Register failed")
        
        supabase.table("users").insert({
            "id":user.id,
            "name":data.name,
            "email":data.email
        }).execute()

        return {"message": "register success"}
    except Exception as e:
        raise HTTPException(400,str(e))

class LoginRequest(BaseModel):
    email:str
    password:str

@router.post("/login")
def login(data : LoginRequest):
    try:
        res = supabase.auth.sign_in_with_password({
            "email": data.email,
            "password": data.password
        })

        return {
            "access_token": res.session.access_token,
            "refresh_token": res.session.refresh_token,
            "user": {
                "id": res.user.id,
                "email": res.user.email
            }
        }

    except Exception as e:
        raise HTTPException(401, str(e))

@router.post("/logout")
def logout():
    return {"message": "logout success"}