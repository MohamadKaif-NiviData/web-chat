import httpx

from app.core.config import settings


async def send_chat_message(messages: list[dict]) -> str:
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{settings.ollama_base_url}/api/chat",
            json={"model": "llama3.2:1b", "messages": messages, "stream": False},
        )
        response.raise_for_status()
        data = response.json()
        return data["message"]["content"]
