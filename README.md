# Real-Time Chat Application

A practice project for building real full-stack engineering skills — Next.js/TypeScript,
FastAPI, PostgreSQL, Redis, Docker — through a genuinely non-trivial system: a real-time
chat app with an AI (RAG) assistant as a chat participant, planned in three phases.

Not a CRUD demo. The point is to exercise WebSockets, presence, async job processing,
pub/sub, file storage, push notifications, and retrieval-augmented generation together,
the way a real product would actually need them.

## Docs

- **[PLAN.md](./PLAN.md)** — full architecture, tech stack rationale, data model, and the
  3-phase feature roadmap (MVP → group chat/uploads → RAG bot).
- **[GUIDE.md](./GUIDE.md)** — the step-by-step build log for Phase 1: what each file does
  and why, gotchas hit along the way, and current progress.

## Status

Phase 1 (MVP) backend is complete through Step 6. Frontend (Step 7) is next.
See [GUIDE.md](./GUIDE.md#progress) for the live step-by-step checklist.

| Phase | Scope | Status |
|---|---|---|
| 1 — MVP | Auth, 1-to-1 WebSocket chat, pagination, presence/typing, frontend UI | 🔶 In progress (backend done, frontend next) |
| 2 | Group chats, read receipts, file uploads, push notifications | ⬜ Not started |
| 3 | RAG bot: pgvector + Celery ingestion + @mention answers | ⬜ Not started |

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + React + TypeScript |
| Backend | FastAPI (Python), async-native |
| Realtime | Native WebSockets |
| Database | PostgreSQL (SQLAlchemy async + `Base.metadata.create_all()` — see GUIDE.md for why no Alembic yet) |
| Cache / presence | Redis |
| Infra | Docker Compose |

## Running locally

```bash
docker compose up --build
```

This starts four containers: `postgres-chat-app`, `redis-chat-app`, `backend-chat-app`
(port `8000`), `frontend-chat-app` (port `3000`). Requires a root `.env` — see
`docker-compose.yml` for the variables it expects (not committed; keep your own local copy).

- Backend health check: `http://localhost:8000/health`
- Interactive API docs (Swagger UI): `http://localhost:8000/docs`
- Frontend: `http://localhost:3000`

## API overview (Phase 1)

| Endpoint | Purpose |
|---|---|
| `POST /auth/signup` | Create a user |
| `POST /auth/login` | Get an access + refresh token pair |
| `POST /auth/refresh` | Exchange a refresh token for a new access token |
| `POST /conversations/` | Get or create a 1-to-1 conversation with another user |
| `GET /conversations/{id}/messages` | Paginated message history (keyset pagination) |
| `WS /ws/chat/{conversation_id}` | Live chat connection — messages, presence, typing |

## Project structure

```
backend/app/
├── core/       # config, security (JWT/hashing), redis client
├── db/         # SQLAlchemy engine/session, table creation
├── models/     # SQLAlchemy models (User, Conversation, Participant, Message)
├── schemas/    # Pydantic request/response shapes
├── services/   # ConnectionManager (WebSocket registry), presence
├── api/
│   ├── deps.py       # get_current_user
│   ├── routes/       # REST endpoints (auth, conversations)
│   └── ws/           # WebSocket endpoint (chat)
└── main.py     # FastAPI app, router wiring, lifespan startup

frontend/       # Next.js app (Step 7, not yet built)
```
