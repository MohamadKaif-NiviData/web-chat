from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: str
    content: str


class AiChatRequest(BaseModel):
    messages: list[ChatMessage]


class AiChatResponse(BaseModel):
    reply: str
