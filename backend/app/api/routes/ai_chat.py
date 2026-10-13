import httpx

from fastapi import APIRouter, HTTPException, Depends

from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.ai_chat import AiChatRequest, AiChatResponse
from app.services.ollama import send_chat_message

router = APIRouter()


@router.post("/chat", response_model=AiChatResponse)
async def chat(payload: AiChatRequest, current_user: User = Depends(get_current_user)):
    messages = [m.model_dump() for m in payload.messages]
    try:
        reply = await send_chat_message(messages)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="AI service is currently unavailable")

    return AiChatResponse(reply=reply)
