from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.db.init_db import init_models

from app.api.routes import auth
from app.api.routes import conversations
from app.api.ws import chat

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_models()
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]

)

app.include_router(auth.router, prefix="/auth", tags=["auth"])

app.include_router(conversations.router, prefix="/conversations", tags=["conversations"])
app.include_router(chat.router)


@app.get("/health")
def health_check():
    return {"status": "OK", "message": "Server is running"}


