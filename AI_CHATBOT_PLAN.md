# AI Chatbot (Ollama) — Plan

## Goal

A standalone "Chat with AI" feature: a button that opens a separate chat box
where the user talks directly to a self-hosted LLM (Ollama running `llama3`
in its own Docker container) — completely independent of the existing
1-to-1/group conversation system (no `Conversation`/`Participant`/`Message`
rows involved).

## How this relates to PLAN.md's original Phase 3

PLAN.md's Phase 3 envisioned the AI as a **RAG bot participant**: a special
`user` row addable to any conversation, backed by pgvector + Celery document
ingestion, triggered by @mention, answering with cited sources. That is a
bigger feature than what's being built here.

This plan is a **simpler, separate, earlier step** — direct LLM chat, no
retrieval, no participant model, no persistence. It intentionally does not
touch pgvector/Celery/MinIO. Treat it as a standalone feature, not a
replacement for or a secretly-started Phase 3 — if Phase 3's RAG bot gets
built later, it's a separate, larger effort that may or may not reuse the
Ollama container introduced here.

## Scope decisions (locked in for this version)

- **No persistence** — chat history lives only in frontend React state. A
  page refresh loses it. No new database tables, no Alembic/manual
  `ALTER TABLE` needed.
- **Plain REST, not WebSocket** — one `POST` per message, one response back.
  No streaming, no `ConnectionManager` involvement, no reuse of `chat.py`'s
  fan-out logic (none of that applies — there's only ever one participant: the
  user and the model).
- **Standalone, not a conversation participant** — a dedicated page/route, not
  something that shows up in the existing chat list or uses `Participant`
  rows.

## Tech choices

| Piece | Choice | Why |
|---|---|---|
| Model runtime | [Ollama](https://ollama.com) in its own container | Self-hosted, no API key/vendor lock-in, matches "practice infra" goal of this project |
| Model | `llama3` (8B) | Reasonable quality/resource tradeoff for local CPU inference; swappable later |
| Backend ↔ Ollama transport | HTTP, via `httpx` (new dependency) | Ollama exposes a REST API (`/api/chat`) on port 11434; `httpx` is the natural async-native client for this stack (vs. wrapping a sync lib in `asyncio.to_thread` the way `pywebpush`/`boto3` are) |
| Backend ↔ Frontend transport | Plain REST (`POST /ai/chat`) | Per scope decision above |
| Conversation memory | Client resends the full message history every request | Only way to maintain context without server-side persistence — same tradeoff you accept any time state is ephemeral |

## Architecture

```
Next.js (app/ai-chat page) ──REST── FastAPI (POST /ai/chat) ──HTTP── Ollama container (llama3)
```

No Postgres, no Redis, no MinIO involved in this request path at all — the
simplest slice through the stack of any feature built so far.

## One-time manual setup (not code)

Same spirit as Step 0 of the push notifications plan (VAPID keys) and the
S3 bucket being created by hand, not by app code:

1. After `docker compose up --build` includes the new `ollama` service (see
   below), pull the model once:
   ```bash
   docker compose exec ollama ollama pull llama3
   ```
2. This downloads several GB and is cached in a named volume
   (`ollama_data`), so it survives `docker compose down` (but NOT
   `docker compose down -v`) and doesn't need to be re-pulled on every
   restart.
3. **Resource gotcha worth knowing before debugging a hang**: `llama3` (8B)
   wants roughly 8GB of RAM to run at a usable speed on CPU-only inference
   (no GPU passthrough from Docker Desktop by default on macOS). If the
   container swaps heavily or responses take minutes, that's most likely why
   — not a bug. A smaller model (e.g. `phi3` or `llama3:8b-instruct-q4_0`, a
   quantized variant) is a reasonable fallback if this machine struggles.

## New files / changes — backend

- `docker-compose.yml` (modify): add an `ollama` service
  (`image: ollama/ollama`), a named volume (`ollama_data:/root/.ollama`) so
  pulled models persist, and have `backend-chat-app` depend on it. No need to
  publish Ollama's port 11434 to the host — only the backend container needs
  to reach it, over the Compose network by service name (`http://ollama:11434`).
- `backend/requirements.txt` (modify): add `httpx`.
- `backend/app/core/config.py` (modify): add `ollama_base_url: str` to
  `Settings`, same "everything flows through `settings`" pattern as every
  other config value — defaults to `http://ollama:11434` in `.env`.
- `backend/app/schemas/ai_chat.py` (new): `ChatMessage {role: str, content:
  str}`, `AiChatRequest {messages: list[ChatMessage]}`, `AiChatResponse
  {reply: str}`. `role` is `"user"` or `"assistant"` — the shape Ollama's
  `/api/chat` itself expects, so the frontend's state can be forwarded
  almost unchanged (same "mirror the external API's shape" pattern as
  `PushSubscriptionRequest` mirroring the browser's `PushSubscription.toJSON()`).
- `backend/app/services/ollama.py` (new): one function,
  `send_chat_message(messages: list[dict]) -> str`, POSTs to
  `{settings.ollama_base_url}/api/chat` with `{"model": "llama3", "messages":
  messages, "stream": False}`, returns the response text. Needs a generous
  timeout (model inference on CPU can take tens of seconds) — don't reuse
  whatever short default timeout `httpx` ships with.
- `backend/app/api/routes/ai_chat.py` (new): `POST /ai/chat`, behind
  `get_current_user` (same auth dependency as every other REST route — no
  reason this should be open to unauthenticated callers). Validates the
  body against `AiChatRequest`, calls `send_chat_message`, wraps the call in
  a try/except so a down/unreachable Ollama container returns a clean `502`
  instead of an unhandled traceback, returns `AiChatResponse`.
- `backend/app/main.py` (modify): wire up
  `app.include_router(ai_chat.router, prefix="/ai", tags=["ai"])`.

## New files / changes — frontend

- `frontend/app/ai-chat/page.tsx` (new): standalone page, not nested under
  `app/chat/`. Local React state only: `messages: {role, content}[]`. On
  send: append the user's message, `POST /ai/chat` with the **entire**
  `messages` array, append the assistant's reply to state when it resolves.
  Needs a loading/"AI is thinking…" state while waiting — responses won't be
  instant.
- Reuses the visual style of `MessageList`/`MessageInput` if convenient, but
  doesn't need their actual logic (no attachments, no read receipts, no
  typing indicator, no WebSocket) — a simpler bespoke component is fine
  here rather than forcing those components to handle a mode they weren't
  built for.
- `frontend/app/chat/page.tsx` (modify): add a "Chat with AI" button in the
  header area (next to "+ New chat" / "+ New group"), linking to
  `/ai-chat` via `router.push("/ai-chat")`.

## Known tradeoffs / explicitly out of scope for this version

- **No streaming** — the user waits for the full response, no token-by-token
  rendering. Upgrading to streaming later would mean either Server-Sent
  Events or a WebSocket endpoint reading Ollama's own streaming response
  (`"stream": true`) chunk-by-chunk; not needed for a first pass.
- **No history cap** — resending the full message array on every turn means
  the request (and latency) grows with every message in the session. Fine
  for a short test conversation; a long session would eventually need
  truncation (e.g. "last 20 messages") or a token-count-based cutoff. Flagging
  this now so it isn't a surprise later, not fixing it preemptively.
- **No concurrency handling** — Ollama typically processes one inference at a
  time per model; if this is tested with multiple simultaneous users, later
  requests will simply queue rather than run in parallel. Not a problem at
  practice-project scale, but worth knowing if this is demoed with more than
  one person at once.
- **No conversation persistence, no multi-session continuity** — by design,
  per the scope decision above.

## Build order

1. `docker-compose.yml`: add `ollama` service + `ollama_data` volume
2. Manual: `docker compose up`, then `docker compose exec ollama ollama pull llama3`
3. `backend/app/core/config.py`: add `ollama_base_url`
4. `backend/requirements.txt`: add `httpx`
5. `backend/app/schemas/ai_chat.py`
6. `backend/app/services/ollama.py`
7. `backend/app/api/routes/ai_chat.py`
8. `backend/app/main.py`: wire the router
9. `frontend/app/ai-chat/page.tsx`
10. `frontend/app/chat/page.tsx`: add the "Chat with AI" button

## Verification checklist

- `docker compose up --build` boots cleanly with the new `ollama` service
  present (check `docker compose ps`).
- After pulling the model: `POST /ai/chat` as an authenticated user with a
  real message → a real `llama3`-generated reply comes back (not an echo,
  not an error).
- `POST /ai/chat` with no/invalid auth token → `401`, same as every other
  protected route.
- Stop the `ollama` container, hit `/ai/chat` again → clean `502`, no
  unhandled traceback in backend logs.
- Frontend: click "Chat with AI" → new page loads with an empty chat box →
  send a message → "thinking" state shows → reply appears → send a
  follow-up that depends on the first message (e.g. "what did I just ask
  you?") → confirm the model actually has that context (proves the full
  history is being resent correctly) → refresh the page → history is gone
  (confirms ephemeral-by-design, not a bug).

---

Once this plan looks right, the next step (mirroring how the push
notifications feature was broken down) would be a matching
`AI_CHATBOT_IMPLEMENTATION_STEPS.md` with file-by-file instructions in
execution order.
