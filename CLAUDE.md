# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A practice project for building full-stack engineering skills — not a CRUD demo. It's a
real-time chat app (Next.js + FastAPI + PostgreSQL + Redis + Docker) built specifically to
exercise WebSockets, presence, async job processing, pub/sub, file storage, push
notifications, and RAG together, the way a real product would need them.

**Working agreement** (from PLAN.md): the user (dev2) writes and manages all code and
infrastructure. Claude's role is guidance — architecture decisions, reviewing approach,
answering questions, unblocking design problems — **not writing the implementation unless
explicitly asked**. Default to explaining the plain-English flow/reasoning rather than
producing code, matching the style already used in GUIDE.md.

Read **PLAN.md** (full architecture, tech stack rationale, data model, 3-phase roadmap) and
**GUIDE.md** (step-by-step build log — what each file does, why, gotchas hit) before making
changes. GUIDE.md's progress table is the source of truth for what phase/step the project is
currently on.

## Current status

Phase 1 (MVP) is functionally complete through Step 7: backend (auth, 1-to-1 WebSocket chat
with keyset pagination, Redis presence/typing) plus a working frontend (auth pages, chat list,
live messaging, typing indicator, presence). GUIDE.md's own Step 7 write-up still needs to be
authored to match its established documentation style — the code is done, the log entry isn't.

The backend gained one addition beyond GUIDE.md's original Step 5 plan: `GET /conversations/`
(`app/api/routes/conversations.py`) lists the current user's conversations with the other
participant's info, presence, and last message — needed because the frontend's conversation
list has nothing else to fetch from. There is still no way to look up/search other users by
name or email; starting a new conversation requires knowing the other user's numeric id.

Phase 2 (group chats, read receipts, file uploads, push notifications) and Phase 3 (pgvector
+ Celery + RAG bot participant) are not started; their services (MinIO, Celery worker,
pgvector) are not yet in `docker-compose.yml`.

## Commands

Run everything through Docker Compose — there's no documented bare-metal workflow, and the
backend/frontend containers bind-mount source for live reload:

```bash
docker compose up --build      # starts postgres, redis, backend (:8000), frontend (:3000)
docker compose down -v         # drop containers AND the postgres volume (needed after a
                                # Postgres major-version bump — see "Gotchas" below)
```

Requires a root `.env` (gitignored) with `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
plus whatever `backend/app/core/config.py`'s `Settings` class expects (JWT secret, Redis URL,
etc.) — `docker-compose.yml` is the definitive list of what's interpolated.

- Backend health check: `http://localhost:8000/health`
- Swagger UI: `http://localhost:8000/docs`
- Frontend: `http://localhost:3000`

Frontend-only commands (run inside the `frontend/` container or locally if Node is set up):
```bash
npm run dev     # next dev
npm run build
npm run start
npm run lint    # eslint
```

There is no test suite yet in either backend or frontend.

## Architecture

### Backend (`backend/app/`)

```
core/       # config.py (Settings, pydantic-settings, single source of truth for env vars),
            # security.py (password hashing, JWT create/decode), redis.py (shared client)
db/         # session.py (async engine/session factory, get_db() dependency),
            # base.py (declarative Base + model imports), init_db.py (create_all() on startup)
models/     # SQLAlchemy: User, Conversation, Participant, Message
schemas/    # Pydantic request/response shapes — deliberately separate from models
            # (e.g. UserCreate/UserResponse never expose hashed_password)
services/   # connection_manager.py (in-memory WebSocket registry, singleton `manager`),
            # presence.py (Redis online/offline with TTL self-healing)
api/
  deps.py       # get_current_user — the shared auth dependency
  routes/       # REST: auth.py (signup/login/refresh), conversations.py (create, paginated history)
  ws/chat.py    # the WebSocket endpoint — auth via ?token= query param (not header), message
                # persistence + relay, typing-event relay, presence set on connect/disconnect
main.py     # FastAPI app, CORS, lifespan (calls init_models()), router wiring
```

Key patterns to preserve when extending this code:

- **No Alembic.** Tables are created via `Base.metadata.create_all()` on startup
  (`db/init_db.py`). This only creates missing tables — it never alters existing ones. Adding
  a column to an existing table requires a manual `ALTER TABLE` against Postgres. This was a
  deliberate simplification for a single-developer project (see GUIDE.md Step 3); revisit
  Alembic if this ever needs to run consistently across multiple environments.
- **WebSocket auth differs from HTTP auth.** Browsers can't set custom headers on the WS
  handshake, so the JWT is passed as `?token=...` and `chat.py` manually calls `decode_token()`
  instead of reusing the `OAuth2PasswordBearer`-based `get_current_user`. Every WS/HTTP
  endpoint that touches a conversation independently re-checks the requesting user is actually
  a `Participant` — never trust the URL alone.
- **`ConnectionManager` is an in-memory singleton** (`services/connection_manager.py`),
  keyed by `user_id -> list[WebSocket]` (a list, since one user may have multiple tabs/devices
  open). This only works with a single backend replica; scaling to multiple replicas requires
  Redis pub/sub for fan-out (planned, not yet built — see PLAN.md's note on why Redis pub/sub
  matters).
- **Presence uses Redis TTL keys** (`presence:{user_id}`, 30s TTL), refreshed by a background
  heartbeat task tied to the WebSocket's lifetime (started on connect, cancelled in the same
  `finally` block that calls `manager.disconnect()`). This makes presence self-healing if a
  connection drops without a clean close.
- **Typing indicators are NOT persisted and don't use Redis** — they piggyback on the same
  in-memory `ConnectionManager.send_to_user()` used for messages, just with `{"type": "typing"}`
  instead of being saved to the DB. Redis pub/sub was deliberately deferred here since it only
  matters once there are multiple backend replicas.
- **Pagination is keyset-based** (`Message.id < cursor`, ordered desc), not `OFFSET`-based —
  chosen because `OFFSET` degrades as you page deeper; this stays fast regardless of depth.
- Any WebSocket receive loop's cleanup (`manager.disconnect`, presence, heartbeat cancellation)
  belongs in a `finally` block, not a specific `except` clause — an early bug here leaked
  connection-registry entries on non-`WebSocketDisconnect` errors.

### Frontend (`frontend/`)

Built out per GUIDE.md's Step 7 plan: `app/(auth)/login`, `app/(auth)/signup`, `app/chat/`
(conversation list), `app/chat/[conversationId]/` (live chat), `components/` (ConversationList,
MessageList, MessageInput), `lib/` (`config.ts` for `API_BASE_URL`/`WS_BASE_URL`, `auth.ts`,
`api.ts`, `websocket.ts`), `types/index.ts` mirroring the backend's Pydantic schemas. Root `/`
just redirects to `/login`.

- **Tokens live in `localStorage`** (`lib/auth.ts`), matching GUIDE.md's own note for this
  practice phase. `apiJson`/`apiFetch` (`lib/api.ts`) attach the access token and retry once
  after a silent refresh on a 401.
- **The current user id is read from the JWT `sub` claim client-side** (`getCurrentUserId()` in
  `lib/auth.ts`), decoded locally without verifying the signature — fine since every real
  request is re-authenticated by the backend anyway.
- **`lib/websocket.ts`'s `useChatSocket` hook** opens one WebSocket per conversation and
  implements the typing throttle/timeout design from GUIDE.md: sends are throttled to ~1 event
  per 2s, and the receiving side auto-hides its "Typing…" indicator after ~3s of silence rather
  than waiting for an explicit "stopped typing" event — mirrors the backend presence TTL's
  self-healing approach.
- **The backend never echoes a sent message back to its own sender** (`chat.py` only relays to
  the *other* participant) — so `app/chat/[conversationId]/page.tsx`'s `handleSend` appends the
  outgoing message to local state itself rather than waiting on the socket.
- **Reading `localStorage` during render breaks hydration.** The conversation page needs the
  current user id to render, but `getCurrentUserId()` is a browser-only read — computing it
  inline mismatches SSR (always `null`) against the client's first render (a real id). Fixed
  with `useSyncExternalStore(subscribe, getCurrentUserId, () => null)`, which is also what the
  stricter `eslint-plugin-react-hooks` rules want instead of a `setState` call directly in a
  `useEffect` body. Any future client component that reads browser-only storage during render
  should follow the same pattern.
- **No user search/lookup endpoint exists.** Starting a new conversation means typing the other
  user's numeric id directly (`app/chat/page.tsx`) — there's no way to find it except knowing it
  already (e.g. from the signup response) or checking the DB.

`frontend/CLAUDE.md` / `frontend/AGENTS.md` note that this Next.js version has framework
changes since training data — check `node_modules/next/dist/docs/` before writing frontend
code that touches Next.js-specific APIs or conventions.

### Data model

```
users(id, email, hashed_password, display_name, created_at)
conversations(id, created_at)
participants(id, conversation_id, user_id, joined_at)
messages(id, conversation_id, sender_id, content, type, created_at)
```
`is_group` on `conversations` and `last_read_message_id` on `participants` are deferred to
Phase 2. Phase 3 adds `documents` and `embeddings` (pgvector) tables — see PLAN.md.

## Gotchas worth knowing before debugging similar issues

- SQLAlchemy's async engine needs `greenlet` explicitly in `requirements.txt` — not pulled in
  transitively by `sqlalchemy` or `asyncpg` alone.
- `EmailStr` needs `pydantic[email]`, not plain `pydantic`.
- Comparing a JWT `sub` claim (always a string) against an `Integer` PK column crashes under
  `asyncpg` — cast with `int(user_id)` before querying.
- Don't use `image: postgres` (untagged/latest) in `docker-compose.yml` — an unplanned major
  version bump breaks compatibility with an existing `postgres_data` volume's on-disk format.
  Pinned to `postgres:16`; if this ever needs bumping, `docker compose down -v` first.
- `response_model=<SQLAlchemy model>` fails at route *registration* time, not request time —
  always use a Pydantic schema for `response_model`.
