from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers.ai import router as ai_router
from routers.auth import router as auth_router
from routers.chat import router as chat_router
from routers.lectures import router as lectures_router
from routers.questions import router as questions_router
from routers.users import router as users_router

app = FastAPI()


# 根目錄測試api
@app.get("/")
async def read_root():
    return {"message": "Hello, World!"}


# CORS (Cross-Origin Resource Sharing) 跨來源資源共用 防止前端被擋
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允許的來源，之後會改成前端網址
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ai_router)
app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(lectures_router)
app.include_router(questions_router)
app.include_router(users_router)
