# Build Guide — Phase 1 (MVP)

How to use this doc: each step tells you **which folder/file to create** and,
in plain English, **what that file should do**. No code here — you write the
code, this just tells you the flow and responsibility of each piece. Follow
the steps in order; each one builds on the last.

Phase 1 scope (from PLAN.md): Docker scaffold → backend auth → 1-to-1
WebSocket chat with pagination → presence/typing → frontend auth + chat UI.

## Progress

| Step | Status |
|---|---|
| 1 — Project skeleton & Docker scaffold | ✅ Done |
| 2 — Backend skeleton & config | ✅ Done |
| 3 — Database models & table creation | ✅ Done |
| 4 — Auth endpoints | ✅ Done |
| 5 — 1-to-1 WebSocket chat + pagination | ✅ Done |
| 6 — Presence & typing indicators (Redis) | ✅ Done |
| 7 — Frontend: auth + chat UI | ✅ Done |
| 8 — Backend: group chats (Phase 2) | ✅ Done |
| 9 — Frontend: group chats (Phase 2) | ✅ Done |
| 10 — Backend: read receipts (Phase 2) | ✅ Done |
| 11 — Frontend: read receipts (Phase 2) | ✅ Done |
| 12 — Backend: file/image uploads (Phase 2) | ✅ Done |
| 13 — Frontend: file/image uploads (Phase 2) | ✅ Done |
| 14 — Backend: push notifications (Phase 2) | ⬜ Not started |
| 15 — Frontend: push notifications (Phase 2) | ⬜ Not started |

**Next up: Step 14** — the last Phase 2 feature before Phase 3's RAG work.
File/image uploads (Steps 12-13) are fully done and verified end-to-end
against a real AWS S3 bucket: presign → direct browser-to-S3 `PUT` →
WebSocket relay/echo with a fresh presigned download URL → inline image
(with a click-to-expand lightbox) or a download link for non-images,
confirmed both via live WebSocket/API testing and by actually clicking
through the running frontend in a browser. See the verification callouts
inside Steps 12 and 13 below for the real bugs hit along the way (an
attachment-before-commit ordering bug, a missing S3 CORS policy, a couple of
bad import paths) and how each was diagnosed and fixed.

Steps 14-15 are planned but not yet built — worth flagging the one design
point that's easy to get backwards going in: a push notification should
fire when a recipient has NO active WebSocket connection, not when they're
online. An already-connected recipient already receives the message live
through the existing fan-out relay in `chat.py` — pushing them an OS
notification on top of that would just double up on something already on
their screen. See Step 14's "Design decisions locked in" callout below for
the full reasoning and where this hooks into the existing code.

> **Step 11 verification, and a real bug it surfaced**: confirmed live in
> the browser with the Chrome extension, using one real session ("N") plus a
> backend-minted JWT standing in for a second user — "Seen" appeared
> instantly under both of N's messages the moment the other user's mark-read
> call landed, no reload. Getting to that point surfaced a genuine bug, not
> a Step 11 mistake: **the backend never echoed a sent message back to its
> own sender** (a deliberate Phase 1 decision), so a sender's own message
> only ever existed locally under a fake placeholder id (`-Date.now()`) —
> and a `"read"` event carries the REAL database id, which a fake id can
> never match. "Seen" was structurally unreachable for your own messages
> within a live session (a reload masked it, since reloading re-fetches real
> ids from history). Fixed by reversing that decision: `chat.py` now echoes
> the persisted message back to the sender's own socket too, and
> `app/chat/[conversationId]/page.tsx` reconciles its optimistic placeholder
> against that echo via a FIFO queue (`pendingSentIdsRef`) — see the
> "Bug hit and fixed" callout inside Step 11 below for the full detail. Also
> updated `CLAUDE.md`'s architecture notes, since this reversed a pattern
> documented there.
>
> **Testing gotcha worth remembering**: an earlier "it's not working" report
> turned out to be two Incognito windows of the SAME Chrome instance — Chrome
> shares one off-the-record session across all its Incognito windows, so
> both windows were silently sharing one `localStorage`, and logging into
> the second account overwrote the first window's token. Testing two users
> live requires either two different browsers, one regular + one Incognito
> window, or two separate OS-level Chrome profiles — never two Incognito
> windows of the same browser, and never two tabs of the same window.

> **Step 10 verification** (scripted against the running `docker compose`
> stack, via `requests` + `websockets` from the host — no manual browser
> steps, since this is all REST/WS calls): restarted the backend to pick up
> the new `message_reads` table (confirmed via `\d message_reads` in psql —
> right columns, the `UniqueConstraint` present as a unique index), then:
> - 1-to-1: Alice sent 3 messages over WS; `read_by` was `[]` for all 3 on
>   Bob's history fetch; Bob POSTed all 3 ids to the mark-read route and got
>   back `{"marked": [...all 3...]}`; Alice's already-open WS connection
>   received exactly ONE `{"type": "read", "message_ids": [...all 3...],
>   "user_id": bob.id}` event (confirms the batched-broadcast refinement —
>   not 3 separate events); re-fetching history afterward showed
>   `read_by: [bob.id]` on all 3 messages.
> - Idempotency: re-POSTing the same already-read ids returned
>   `{"marked": []}` — no duplicate rows, no unique-constraint crash.
> - Validation refinement: POSTing a message id from nowhere/foreign
>   (`999999`) returned `{"marked": []}` instead of erroring or inserting
>   garbage — confirms the "filter message_ids against this
>   conversation_id" check works.
> - Self-read exclusion: the SENDER (Alice) POSTing her own message's id
>   came back `{"marked": []}` — confirms a user can't mark their own
>   message "read by me."
> - Group fan-out (3-person group: Alice, Bob, Carol): Carol marking
>   Alice's message read caused BOTH Bob's and Alice's open sockets to each
>   receive one `{"type": "read", ...}` event — confirms the "loop over
>   every other participant" broadcast works for >2 participants, not just
>   1-to-1.
> - Checked backend container logs across the whole run — no tracebacks or
>   errors.

---

## Step 1 — Project skeleton & Docker scaffold ✅ Done

> **What actually got built, and where it differs from the plan below:**
> - `docker-compose.yml` reads secrets from root `.env` via `${VAR}`
>   interpolation (compose does this automatically for any `.env` file sitting
>   next to it) plus `env_file: .env` on the backend service, instead of
>   hardcoded values.
> - Both `backend-chat-app` and `frontend-chat-app` bind-mount their source
>   folder (`./backend:/app`, `./frontend:/app`) for live reload, exactly as
>   planned.
> - `backend/Dockerfile` is a single production-ready image (non-root user,
>   `HEALTHCHECK`, no `--reload` baked into `CMD`); dev-mode `--reload` is
>   supplied instead by `command:` in `docker-compose.yml`, which overrides
>   the Dockerfile's `CMD` at runtime.
> - `frontend/Dockerfile` is multi-stage (`deps` → `builder` → `runner` for a
>   lean production image), with an extra `dev` stage
>   (`FROM deps AS dev` running `npm run dev`) that `docker-compose.yml`
>   targets via `build.target: dev` for local development. Compose also adds
>   an anonymous volume on `/app/node_modules` so the container's own
>   Linux-built `node_modules` isn't clobbered by the host's bind mount.
> - Verified end-to-end: `docker compose up --build` starts all four
>   containers; frontend serves the default Next.js page with hot reload
>   working; backend correctly fails at this point with
>   `Attribute "app" not found in module "app.main"` — that failure is
>   expected and is exactly what Step 2 fixes.

**Create the root folders:**
```
Prectice_project/
├── backend/
├── frontend/
├── docker-compose.yml
└── .env
```

**`docker-compose.yml`** (root)
Plain-English flow:
- Define a `postgres` service using the official `postgres` image, with a volume
  so data survives restarts, and env vars for db name/user/password.
- Define a `redis` service using the official `redis` image (no config needed yet,
  you'll use it starting Step 6).
- Define a `backend` service that builds from `./backend`, mounts the backend
  folder as a volume (so code changes reload live), exposes a port (e.g. 8000),
  and depends on `postgres` and `redis` being up first.
- Define a `frontend` service that builds from `./frontend`, mounts the folder
  as a volume, exposes port 3000, and depends on `backend`.
- Put shared secrets (db password, JWT secret, etc.) in `.env` and reference
  them in the compose file instead of hardcoding.

**`.env`** (root)
Plain-English flow:
- List every secret/config value the containers need: Postgres user/password/db
  name, a JWT secret string, Redis connection info. Keep this file out of git.

**`backend/Dockerfile`**
Plain-English flow:
- Start from a Python base image.
- Set a working directory inside the container.
- Copy just the dependency file first and install dependencies (so Docker can
  cache this layer and not reinstall on every code change).
- Copy the rest of the backend code in.
- Set the container's start command to run the FastAPI app with a dev server
  that supports auto-reload.

**`frontend/Dockerfile`**
Plain-English flow:
- Start from a Node base image.
- Set a working directory inside the container.
- Copy dependency files first, install dependencies (same caching trick).
- Copy the rest of the frontend code in.
- Set the start command to run the Next.js dev server, exposing port 3000.

**Checkpoint**: running the compose command should bring up all four
containers, with backend and frontend both reachable in a browser, even
before there's any real logic — this proves the plumbing works before you
build features on top of it.

---

## Step 2 — Backend skeleton & config ✅ Done

Status: `requirements.txt`, `app/core/config.py`, `app/core/security.py`,
and `app/main.py` are all done. Backend container now starts correctly and
`/health` returns 200.

**Create inside `backend/`:**
```
backend/
├── requirements.txt
└── app/
    ├── main.py
    └── core/
        ├── config.py
        └── security.py
```

**`requirements.txt`** ✅ done
Plain-English flow:
- List the libraries you'll need for this phase: the FastAPI framework itself,
  an ASGI server, a Postgres driver + ORM (SQLAlchemy), a migration tool
  (Alembic), a password-hashing library, a JWT library, and a Redis client.

**`app/core/config.py`** ✅ done
Why: every other file (db session, security, routes) needs values like the
db connection string or JWT secret. If each file read `os.environ` directly,
the same env var names would be scattered everywhere, easy to typo, and hard
to see at a glance what the app depends on. Centralizing means one object
(`settings`) is the single source of truth, and it's this file's only job to
ever touch a raw environment variable.
Plain-English flow:
- Define one settings class (via `pydantic-settings`) with one field per env
  var: db connection string, Redis URL, JWT secret, JWT algorithm, access
  token expiry, refresh token expiry.
- Point it at the root `.env` file as a fallback for running outside Docker.
- Create exactly one instance, `settings`, that every other file imports.

**`app/core/security.py`** ✅ done
Why: password hashing and JWT creation/validation are security-sensitive and
used from multiple places (signup, login, the auth dependency, refresh).
Writing this logic once here — instead of re-implementing hashing or token
checks inline in each route — means there's only one place that can get the
crypto wrong, and it's easy to review.
Plain-English flow:
- `hash_password` / `verify_password`: bcrypt (via `passlib`'s
  `CryptContext`) one-way hashes a password with a random salt baked into
  the output string; verifying re-hashes the attempt with that same salt and
  compares the result — never decrypts anything.
- `create_access_token` / `create_refresh_token`: build a JWT payload
  (`sub` = user id, `exp` = expiry using `settings.access_token_expire_minutes`
  / `settings.refresh_token_expire_days`, plus a `type` claim to tell them
  apart), sign it with `settings.jwt_secret` / `settings.jwt_algorithm` via
  `jwt.encode`.
- `decode_token`: `jwt.decode` recomputes the signature and checks
  expiry, raising a `JWTError` if either fails; on success returns
  `payload["sub"]` (just the user id, not the whole payload) — Step 4's
  `get_current_user` is what turns a raised error into an HTTP 401.

**`app/main.py`** ✅ done
Why: something has to actually construct the FastAPI app, and it's the one
file the Docker container's start command points at (`uvicorn app.main:app`)
— that's also why Step 1's compose-up failed with "Attribute app not found":
this file is what creates that `app` object.
Plain-English flow:
- `app = FastAPI()` creates the app instance.
- `CORSMiddleware` is registered with `allow_origins=["http://localhost:3000"]`
  and `allow_credentials=True` so the future Next.js frontend (a different
  origin) is allowed to call this API and send the `Authorization` header.
- `GET /health` returns a simple JSON status — used for the checkpoint below
  and for container health checks.
- Router registration (auth in Step 4, chat in Step 5) still to be added once
  those files exist.

**Checkpoint**: hitting the health-check endpoint from your browser or curl
should return a 200 response. ✅ Verified.

---

## Step 3 — Database models & table creation ✅ Done

> **Plan change**: originally this step used Alembic for migrations. We
> dropped that in favor of a simpler `Base.metadata.create_all()` call on
> app startup — see `app/db/init_db.py` below. `create_all()` only creates
> missing tables, it never alters an existing one — so once a table already
> has real data, changing that model requires a manual `ALTER TABLE`
> statement run directly against Postgres (e.g.
> `ALTER TABLE users ADD COLUMN avatar_url TEXT;`). This is data-safe for
> additive changes (new nullable/defaulted column) since existing rows just
> get `NULL`/the default — genuine data loss only happens with explicitly
> destructive statements like `DROP COLUMN` or an incompatible type change,
> same as it would with any migration tool. Revisit Alembic later if this
> ever needs to run consistently across multiple environments/teammates.

**Create inside `backend/`:**
```
backend/
└── app/
    ├── db/
    │   ├── base.py
    │   ├── session.py
    │   └── init_db.py
    └── models/
        ├── user.py
        ├── conversation.py
        └── message.py
```

**`app/db/base.py`** ✅ done
Plain-English flow:
- `Base(DeclarativeBase)` — the shared declarative base every model inherits
  from, so they all register onto the same `Base.metadata`.
- Imports `user`, `conversation`, `message` at the bottom so each model's
  class body actually executes and registers its table — a model file that's
  never imported stays invisible to `Base.metadata` even though it exists on
  disk.

**`app/models/user.py`** ✅ done
Plain-English flow:
- `User` table (`users`): id, email (unique + indexed), hashed_password,
  display_name, created_at.

**`app/models/conversation.py`** ✅ done
Plain-English flow:
- `Conversation` table (`conversations`): id, created_at.
- `Participant` table (`participants`): id, conversation_id (FK →
  conversations.id), user_id (FK → users.id), joined_at.
- Deferred to Phase 2 (deliberately, low cost to add later since nothing
  depends on them yet): `is_group` on Conversation, `last_read_message_id`
  on Participant (for read receipts).

**`app/models/message.py`** ✅ done
Plain-English flow:
- `Message` table (`messages`): id, conversation_id (FK → conversations.id),
  sender_id (FK → users.id), content (Text), type (default "text"),
  created_at.
- Deferred to later (MVP has low message volume, add when pagination
  actually gets slow): `index=True` on conversation_id, and a composite
  `__table_args__` index on (conversation_id, created_at) for fast
  keyset-pagination queries in Step 5.

**`app/db/session.py`** ✅ done
Plain-English flow:
- `engine = create_async_engine(settings.database_url, echo=True)` — built
  from the root `.env`'s `DATABASE_URL`, already using the correct
  `postgresql+asyncpg://` scheme for the `asyncpg` driver.
- `AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)` —
  the shared session factory.
- `get_db()` — an async generator dependency: opens a session, yields it to
  the route, closes it automatically via `async with` once the route
  returns (success or error).

**`app/db/init_db.py`**
Why: on every app startup, make sure every table your models define
actually exists in Postgres — `Base.metadata.create_all` creates whatever's
missing and is a no-op for tables that already exist.
Plain-English steps:
1. Import `Base` from `app.db.base` and `engine` from `app.db.session`.
2. Write `async def init_models(): async with engine.begin() as conn: await
   conn.run_sync(Base.metadata.create_all)` — `run_sync` is the bridge that
   lets your async engine call `create_all` (a plain sync function).

**Wire it into `app/main.py`**
Plain-English steps:
1. Import `asynccontextmanager` from `contextlib` and `init_models` from
   `app.db.init_db`.
2. Define a `lifespan(app)` async context manager that calls
   `await init_models()` before `yield`.
3. Pass it in: `app = FastAPI(lifespan=lifespan)` — this runs table creation
   once, automatically, every time the container starts.

**Checkpoint**: `docker compose up --build`, then connect to Postgres with
any db client and confirm all four tables (`users`, `conversations`,
`participants`, `messages`) exist with the right columns. ✅ Verified.

> **Gotcha hit along the way**: `requirements.txt` was missing `greenlet`
> (SQLAlchemy's async engine needs it for `conn.run_sync(...)`, but it isn't
> pulled in automatically by `sqlalchemy` or `asyncpg` alone) — added
> `greenlet==3.1.1`. Separately, `docker-compose.yml`'s `postgres-chat-app`
> used an untagged `image: postgres` (= "latest"), which had drifted to a
> Postgres 18+ image incompatible with the existing `postgres_data` volume's
> older on-disk format — Postgres refused to start, which then made the
> backend's `postgres-chat-app` hostname fail to resolve (not a networking
> config issue, just a symptom of Postgres being down). Fixed by pinning
> `image: postgres:16` and running `docker compose down -v` once to drop the
> incompatible old volume.

---

## Step 4 — Auth endpoints ✅ Done

**Create inside `backend/app/`:**
```
app/
├── schemas/
│   ├── user.py
│   └── auth.py
└── api/
    ├── deps.py
    └── routes/
        └── auth.py
```

> **Gotchas hit along the way** (for future reference / interview talking
> points):
> - `EmailStr` needs the separate `email-validator` package — not pulled in
>   by plain `pydantic`. Fixed via `pydantic[email]==2.10.4` in
>   `requirements.txt`.
> - Comparing a JWT's `sub` claim (always a string) against an `Integer`
>   primary key column crashes under `asyncpg` specifically — Postgres has
>   no `integer = varchar` operator, and asyncpg won't silently coerce the
>   type the way some drivers do. Fixed with `int(user_id)` in
>   `deps.py`/routes before querying.
> - Hit `UnboundLocalError` twice from the same root cause: naming a local
>   variable the same as a function you're calling on the same line (e.g.
>   `access_token = access_token(...)`), or the same as a route's own
>   parameter (`decode_token(refresh_token)` when the real parameter was
>   `payload: RefreshRequest`). Python treats a name as local to the whole
>   function the moment it's assigned anywhere in that function — so using
>   it earlier in the same function, even before the assignment line, fails.

**`app/schemas/user.py`** ✅ done
Why: SQLAlchemy models (Step 3) define what's in the DATABASE. Pydantic
schemas define what's allowed over the WIRE (the API) — these are
deliberately different shapes. A signup request should never accept a raw
`hashed_password`, and a user response should never leak `hashed_password`
back out. Two separate classes make each direction explicit instead of
accidentally exposing a DB column through the API.
Plain-English steps:
1. `UserCreate(BaseModel)`: `email: EmailStr`, `password: str` (plain-text,
   only ever exists in-memory for the length of the signup request — never
   stored, always run through `hash_password()` from `security.py` first),
   `display_name: str`.
2. `UserResponse(BaseModel)`: `id: int`, `email: EmailStr`, `display_name: str`
   — deliberately no password field of any kind. Add
   `model_config = ConfigDict(from_attributes=True)` so you can return a
   SQLAlchemy `User` object directly from a route and FastAPI converts it
   through this schema automatically.

**`app/schemas/auth.py`** ✅ done
Why: same reasoning as above, scoped to login/token exchange instead of user
data.
Plain-English steps:
1. `LoginRequest(BaseModel)`: `email: EmailStr`, `password: str`.
2. `TokenResponse(BaseModel)`: `access_token: str`, `refresh_token: str`,
   `token_type: str = "bearer"` — `"bearer"` is the standard value clients
   look for to know how to send the token back (`Authorization: Bearer <token>`).
3. `RefreshRequest(BaseModel)`: `refresh_token: str` — added so the refresh
   endpoint takes the token from the JSON body instead of a URL query
   parameter (a bare `str` route parameter defaults to a query param in
   FastAPI, which would put a secret token in the URL/logs).

**`app/api/deps.py`** ✅ done
Why: every protected route needs to answer "who is making this request?" —
writing that logic once as a dependency means routes just declare
`current_user: User = Depends(get_current_user)` instead of each
reimplementing header-parsing and token-checking.
Plain-English steps:
1. Use FastAPI's `OAuth2PasswordBearer` (or manually read the `Authorization`
   header) to extract the raw token string from the request.
2. Call `decode_token()` from `security.py` — if it raises, catch it and
   raise `HTTPException(status_code=401)` instead of letting the JWT
   library's raw exception reach the client.
3. Use the user id `decode_token()` returned to load the matching `User` row
   from the db via `get_db()` (Step 3's session dependency) — if no such
   user exists (e.g. deleted after the token was issued), also 401.
4. Return the `User` object — this is what shows up as `current_user` in
   every route that depends on this function.

**`app/api/routes/auth.py`** ✅ done
Why: this is where signup/login/refresh actually live — the one place that
ties together `schemas` (shape), `security.py` (hashing/tokens), and the
`User` model (storage).
Plain-English steps:
- **Signup** (`POST /auth/signup`, body: `UserCreate`, response: `UserResponse`):
  query the db for an existing user with that email — if found, raise 409
  (conflict); otherwise call `hash_password()`, create and save the new
  `User` row, return it (FastAPI converts it via `UserResponse`).
- **Login** (`POST /auth/login`, body: `LoginRequest`, response: `TokenResponse`):
  look up the user by email — if not found, raise 401 (deliberately the same
  error as "wrong password," so you don't leak which emails are registered);
  call `verify_password()` against the stored hash; if it matches, call
  `create_access_token()` + `create_refresh_token()` and return both.
- **Refresh** (`POST /auth/refresh`, body: just the refresh token, response:
  `TokenResponse` or just a new access token): call `decode_token()` on the
  refresh token (checking the `"type": "refresh"` claim from `security.py` if
  you added it, so an access token can't be used here), then issue a fresh
  access token for that user id.

**Checkpoint**: signup, then login, then call a protected test endpoint with
the returned token to confirm `get_current_user` correctly identifies you.

**Wire the router into `app/main.py`** ✅ done
Why: the routes exist as an `APIRouter`, but FastAPI's `app` doesn't know
about them until you explicitly register it — right now hitting `/auth/login`
would 404.
Plain-English steps:
1. `from app.api.routes import auth`.
2. `app.include_router(auth.router, prefix="/auth", tags=["auth"])` — the
   `prefix` is why the route defined as `@router.post("/login")` in
   `auth.py` ends up reachable at `/auth/login`.

Verified: `/auth/signup`, `/auth/login`, `/auth/refresh`, and `/health` all
registered correctly on the running app.

**Checkpoint**: with the containers running, `POST /auth/signup` with a new
email/password/display_name returns a 201/200 with a `UserResponse` body (no
password field); `POST /auth/login` with those same credentials returns a
`TokenResponse`; hitting a route that depends on `get_current_user` with the
returned `access_token` in `Authorization: Bearer <token>` succeeds, and
fails with 401 without it.

---

## Step 5 — 1-to-1 WebSocket chat + pagination ✅ Done

**Create inside `backend/app/`:**
```
app/
├── schemas/
│   ├── message.py
│   └── conversation.py
├── services/
│   └── connection_manager.py
└── api/
    ├── routes/
    │   └── conversations.py
    └── ws/
        └── chat.py
```

> **Gotchas hit along the way** (for future reference / interview talking
> points):
> - `response_model=Conversation` (the SQLAlchemy model, not a Pydantic
>   schema) crashes at route-REGISTRATION time, not request time — FastAPI
>   tries to build a response field from it the moment the decorator runs.
>   Fixed by adding a small `ConversationResponse(BaseModel)` in a new
>   `app/schemas/conversation.py`.
> - In `chat.py`'s WebSocket loop, `except WebSocketDisconnect:
>   manager.disconnect(...)` only cleaned up the connection registry for
>   THAT one exception type — any other error (e.g. a malformed client
>   message causing `KeyError`) skipped cleanup entirely, leaking a stale
>   entry in `ConnectionManager`. Fixed by moving the disconnect call into a
>   `finally` block, which runs regardless of why the loop exited.

**`app/schemas/message.py`** ✅ done
Why: same reasoning as Step 4's schemas — the `Message` model (Step 3)
defines DB storage; this defines what goes over the wire, both for the
WebSocket payload and the HTTP history endpoint.
Plain-English steps:
1. `MessageResponse(BaseModel)`: `id: int`, `conversation_id: int`,
   `sender_id: int`, `content: str`, `type: str`, `created_at: datetime`,
   plus `model_config = ConfigDict(from_attributes=True)` (same reason as
   `UserResponse` — lets you return a SQLAlchemy `Message` object directly).
2. `MessagePage(BaseModel)`: `messages: list[MessageResponse]`,
   `next_cursor: int | None` — `next_cursor` is the id of the oldest message
   in this page; the client sends it back as the `cursor` query param to
   fetch the next (older) page. `None` means there are no more pages.

**`app/schemas/conversation.py`** ✅ done (added mid-step, not in original plan)
Why: `app/api/routes/conversations.py`'s create/get endpoint needs a proper
Pydantic `response_model` — see the gotcha above.
Plain-English steps:
1. `class ConversationResponse(BaseModel): conversation_id: int`.

**`app/services/connection_manager.py`** ✅ done
Why: a WebSocket connection is a live, in-memory Python object — there's no
way to "look one up" later except by keeping your own registry. This class
is that registry, so `chat.py` can ask "is this user online, and if so,
which socket(s) do I push to?"
Plain-English steps:
1. `class ConnectionManager:` with `self.active_connections: dict[int,
   list[WebSocket]] = {}` in `__init__` — a list per user (not a single
   socket) because the same user might have the app open in two tabs or two
   devices at once.
2. `async def connect(self, user_id: int, websocket: WebSocket)`: call
   `await websocket.accept()` (completes the WebSocket handshake — nothing
   can be sent/received before this), then append it to
   `self.active_connections.setdefault(user_id, [])`.
3. `def disconnect(self, user_id: int, websocket: WebSocket)`: remove that
   socket from the user's list; if the list is now empty, delete the key
   entirely so `active_connections` doesn't accumulate empty lists forever.
4. `async def send_to_user(self, user_id: int, message: dict)`: loop over
   `self.active_connections.get(user_id, [])` and `await ws.send_json(message)`
   on each — if the user has no entry (offline), this is a no-op, not an
   error.
5. At the bottom of the file: `manager = ConnectionManager()` — ONE shared
   instance, imported by `chat.py`. This has to be a singleton: if each
   WebSocket connection created its own `ConnectionManager()`, they'd never
   see each other's connections and no message could ever be delivered.
6. Known limitation, worth stating plainly rather than glossing over: this
   registry lives in the Python process's memory. It works perfectly for a
   single backend container (which is all this project runs), but wouldn't
   work if you ever ran multiple backend replicas — user A connected to
   replica 1 would be invisible to a message arriving on replica 2. Fixing
   that requires a shared broker (e.g. Redis pub/sub) instead of an
   in-memory dict — out of scope for Phase 1.

**`app/api/routes/conversations.py`** ✅ done
Why: creating a conversation and fetching message history are normal
request/response HTTP operations — no need for a persistent connection like
the WebSocket, so they get their own regular FastAPI routes.
Plain-English steps:
1. `POST /conversations` (body: `{other_user_id: int}`, uses
   `current_user: User = Depends(get_current_user)`): look for an existing
   conversation between exactly `current_user.id` and `other_user_id` by
   querying `Participant` for conversation ids that include
   `current_user.id`, then checking which of those also have a `Participant`
   row for `other_user_id`. If found, return it. If not, create a new
   `Conversation` row plus two `Participant` rows (one per user) and return
   that.
2. `GET /conversations/{conversation_id}/messages?cursor={id}&limit={n}`
   (also behind `get_current_user`):
   - First, authorization check: query `Participant` to confirm
     `current_user.id` is actually a participant of `conversation_id` — if
     not, raise 403. Never trust the URL alone to prove someone's allowed to
     read a conversation's messages.
   - Query `Message` where `conversation_id` matches, and if `cursor` was
     given, add `Message.id < cursor`; order by `Message.id.desc()`, limit
     to `limit` (+1 trick: fetch `limit + 1` rows — if you get back more
     than `limit`, there's a next page, so set `next_cursor` to the id of
     the `limit`-th row and drop the extra one before returning).
   - This is keyset pagination — filtering by "id less than the last one you
     saw," not `OFFSET n` — because `OFFSET` gets slower the deeper you
     paginate (the db still has to scan and discard all skipped rows), while
     this stays fast no matter how far back you page.

**`app/api/ws/chat.py`** ✅ done
Why: this is the actual live connection — the one endpoint that isn't
request/response but stays open, letting the server push data to the client
without the client asking again.
Plain-English steps:
1. `router = APIRouter()`, then
   `@router.websocket("/ws/chat/{conversation_id}")`.
2. Signature: `async def chat_endpoint(websocket: WebSocket, conversation_id:
   int, token: str = Query(...), db: AsyncSession = Depends(get_db))`. Note
   `token` comes from a query param (`?token=...`), NOT the `Authorization`
   header — browsers' native WebSocket API can't set custom headers on the
   handshake request, so passing the JWT as a query param is the standard
   workaround for WebSocket auth. This means `get_current_user` (built around
   `OAuth2PasswordBearer`, which reads headers) can't be reused as-is here.
3. Manually replicate its logic: call `decode_token(token)` in a
   try/except — on `JWTError`, `await websocket.close(code=1008)` (policy
   violation) and `return` (you can't raise an `HTTPException` after a
   WebSocket handshake has started; closing the socket is the equivalent).
4. Check the decoded user is actually a `Participant` in `conversation_id`
   (same authorization principle as the HTTP history endpoint) — close the
   socket if not.
5. `await manager.connect(user_id, websocket)`.
6. `try: while True: data = await websocket.receive_json()` — expect a
   shape like `{"content": "..."}`. For each message: create a `Message`
   row (`sender_id=user_id`, `conversation_id=conversation_id`,
   `content=data["content"]`), `db.add`/`commit`/`refresh`, then look up the
   OTHER participant's user id (query `Participant` for this
   `conversation_id` excluding `user_id`) and
   `await manager.send_to_user(other_user_id, MessageResponse.model_validate(message).model_dump())`.
7. `except WebSocketDisconnect: manager.disconnect(user_id, websocket)` —
   this is how you detect the tab closed / connection dropped; there's no
   explicit "goodbye" message from the client in the normal case.

**Wire both routers into `app/main.py`** ✅ done
Plain-English steps:
1. `from app.api.routes import conversations` and
   `app.include_router(conversations.router, prefix="/conversations", tags=["conversations"])`.
2. `from app.api.ws import chat` and `app.include_router(chat.router)` — no
   prefix needed since the path is already fully spelled out in the
   `@router.websocket("/ws/chat/{conversation_id}")` decorator.

> Gotcha hit: a duplicate `app.include_router(auth.router, ...)` line
> accidentally registered every auth route twice (didn't crash — FastAPI
> tolerates duplicate paths and just matches the first — but doubled the
> `/docs` Swagger entries). Removed the duplicate.

**Checkpoint**: open two WebSocket connections (e.g. two browser tabs logged
in as different users), send a message from one, confirm it's saved in
Postgres and delivered live to the other. Then reload and confirm the
history endpoint returns it with pagination working across older messages.

---

## Step 6 — Presence & typing indicators (Redis) ✅ Done

> **Plan simplification**: the original plan used Redis pub/sub to broadcast
> typing events. Redis pub/sub earns its keep once you have MULTIPLE backend
> replicas (a typing event arriving on replica 1 needs to reach a user
> connected to replica 2 — the exact scaling problem `connection_manager.py`
> already documents as a known limitation). Phase 1 runs a single backend
> container, so the existing in-memory `manager.send_to_user()` already
> reaches the other participant directly — adding Redis pub/sub on top would
> be solving a problem this project doesn't have yet. Redis is still used
> for PRESENCE (online/offline), where it earns its keep even in a
> single-container setup — see the "why TTL" note below.

**Create inside `backend/app/`:**
```
app/
├── core/
│   └── redis.py
└── services/
    └── presence.py
```

**`app/core/redis.py`** ✅ done
Why: same reasoning as `db/session.py` — one shared client, not a new
connection created by every file that needs Redis.
Plain-English steps:
1. Import `redis.asyncio as redis` (async support built into the `redis`
   package since v4.2+ — no separate library needed) and `settings` from
   `app.core.config`.
2. `redis_client = redis.from_url(settings.redis_url, decode_responses=True)`
   — `decode_responses=True` means you get back normal Python `str`, not
   raw `bytes`, when reading keys.

**`app/services/presence.py`** ✅ done
Why: online/offline status is inherently transient — nobody needs to query
"was Alice online three days ago," so this doesn't belong in Postgres at
all. Redis fits naturally because of its TTL (auto-expiring keys) support.
Plain-English steps:
1. `ONLINE_TTL_SECONDS = 30` (or similar) — how long a presence key survives
   before Redis deletes it automatically if nothing refreshes it.
2. `get_presence_key(user_id) -> f"presence:{user_id}"` — one helper every
   function below calls, so the key format can't drift between them.
3. `async def set_online(user_id: int): await redis_client.set(get_presence_key(user_id), "online", ex=ONLINE_TTL_SECONDS)`.
4. `async def set_offline(user_id: int): await redis_client.delete(get_presence_key(user_id))`.
5. `async def is_online(user_id: int) -> bool: return await redis_client.exists(get_presence_key(user_id)) == 1`.
6. Why the TTL matters even though `chat.py` also calls `set_offline` on
   disconnect: if the server process crashes, or a connection drops in a way
   that never triggers your `finally` block (e.g. the container gets killed
   outright), there'd be no explicit "offline" call — a stale "online" key
   would be stuck forever with a plain key/value store. The TTL is a
   self-healing safety net: worst case, a phantom online status clears
   itself within `ONLINE_TTL_SECONDS` on its own.

**Presence heartbeat — keeping the TTL alive while genuinely connected** ✅ done
Why: `set_online`'s 30s TTL would expire even for a still-connected, just-
quiet user if nothing refreshes it. Refreshing on every chat message isn't
right either — "sent a message recently" isn't the same as "socket is still
open." The correct signal is the connection's own lifetime, so a background
task tied to that lifetime is what refreshes it.
Plain-English steps:
1. `PRESENCE_REFRESH_INTERVAL = 10` — must stay well under `ONLINE_TTL_SECONDS`
   (30) so a little jitter/delay can never let the key expire between
   refreshes.
2. `async def _presence_heartbeat(user_id): while True: await asyncio.sleep(PRESENCE_REFRESH_INTERVAL); await set_online(user_id)`.
3. Start it right after connecting:
   `heartbeat_task = asyncio.create_task(_presence_heartbeat(user_id))`.
4. Cancel it in the SAME `finally` block as `manager.disconnect(...)` —
   `heartbeat_task.cancel()` — so it stops no matter why the connection
   ended, same reasoning as the earlier disconnect-cleanup fix.

**Typing indicator — reuse the existing `ConnectionManager`, no Redis needed** ✅ done
Plain-English steps:
1. In `chat.py`'s receive loop, look up the other participant ONCE per
   incoming message (shared by both branches below), then branch on the
   payload's `type` field: if `data.get("type") == "typing"`, call
   `await manager.send_to_user(other_user_id, {"type": "typing", "user_id": user_id})`
   and `continue` — no DB write, nothing persisted, purely transient.
2. Otherwise (no `type`, or anything else), fall through to the existing
   message-save-and-push logic, unchanged.

**Wire presence into `app/api/ws/chat.py`** ✅ done
Plain-English steps:
1. Import `set_online`, `set_offline` from `app.services.presence`.
2. Right after `await manager.connect(user_id, websocket)`, call
   `await set_online(user_id)`.
3. In the existing `finally` block, alongside `manager.disconnect(...)`, add
   `await set_offline(user_id)`.

**Checkpoint**: with two tabs open, confirm one shows the other going
online/offline, and shows a typing indicator while the other is composing a
message (without it appearing in message history).

---

## Step 7 — Frontend: auth + chat UI

**Create inside `frontend/`:**
```
frontend/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   └── chat/
│       ├── page.tsx
│       └── [conversationId]/page.tsx
├── components/
│   ├── ConversationList.tsx
│   ├── MessageList.tsx
│   └── MessageInput.tsx
├── lib/
│   ├── api.ts
│   ├── auth.ts
│   └── websocket.ts
└── types/
    └── index.ts
```

**`types/index.ts`**
Plain-English flow:
- Mirror the backend's schemas in TypeScript: a `User` type, a `Message`
  type, a `Conversation` type — keep these in sync with the Pydantic schemas
  so the frontend and backend agree on shape.

**`lib/api.ts`**
Plain-English flow:
- A small wrapper around `fetch` that points at the backend base URL,
  automatically attaches the stored auth token to requests, and handles
  refreshing the token if a request comes back 401.

**`lib/auth.ts`**
Plain-English flow:
- Functions to call the signup/login/refresh endpoints, and to store/read the
  token pair (e.g. in memory + a secure cookie, or localStorage for this
  practice phase). A helper to check if the user is currently authenticated.

**`lib/websocket.ts`**
Plain-English flow:
- A function/hook that opens a WebSocket connection to the backend chat
  endpoint for a given conversation, passing the auth token.
- Expose a way for components to send a message or typing event, and a way
  to subscribe to incoming events (new message, presence change, typing).
- Handle cleanup (closing the socket) when the component unmounts.

**Typing indicator: throttle on send, timeout on receive** (design decided
while planning, before the frontend code exists — see below for why)
Why: sending a `{"type": "typing"}` event on literally every keystroke
would flood the WebSocket for no benefit; but waiting for the user to PAUSE
before sending anything (a debounce) would mean the other person only finds
out someone was typing after they've already stopped — the opposite of
useful. The fix is two different techniques, one on each end of the
connection:
- **Sending side — throttle**: while the user is typing, send at most one
  `{"type": "typing"}` event every ~2 seconds (not on every keystroke) —
  "keep sending updates at a limited rate while they're active," not "wait
  for them to stop."
- **Receiving side — timeout, not an explicit "stop" event**: when a
  `"typing"` event arrives, show "X is typing..." and (re)start a
  ~3-second local timer. If no new `"typing"` event arrives before that
  timer runs out, hide the indicator automatically. This is the same
  self-healing idea as the backend's Redis presence TTL (Step 6) — instead
  of requiring the sender to explicitly say "I stopped typing" (which their
  tab might fail to send if it crashes or loses connection), the receiver
  just clears the indicator on its own if updates stop arriving.
- The backend (`app/api/ws/chat.py`, already done) needs no changes for
  this — it already just relays whatever `"typing"` events arrive straight
  to the other participant. All of the throttle/timeout logic above lives
  here, in the frontend.

**`app/(auth)/login/page.tsx`** and **`signup/page.tsx`**
Plain-English flow:
- Simple forms calling the corresponding `lib/auth.ts` functions, redirecting
  to `/chat` on success, showing an error message on failure.

**`app/chat/page.tsx`**
Plain-English flow:
- Fetch the current user's conversations from the backend and render them
  using `ConversationList`. Clicking one navigates to
  `/chat/[conversationId]`.

**`app/chat/[conversationId]/page.tsx`**
Plain-English flow:
- On load, fetch the first page of message history for this conversation,
  then open the WebSocket connection via `lib/websocket.ts`.
- Render `MessageList` (existing history + live incoming messages merged)
  and `MessageInput` (a text box that sends a message event over the socket
  and clears itself, plus fires a throttled typing event on keystroke — see
  the "throttle on send, timeout on receive" note under `lib/websocket.ts`).
- Implement "load older messages" (e.g. scroll-to-top or a button) that calls
  the history endpoint again with the next cursor and prepends results.

**`components/ConversationList.tsx` / `MessageList.tsx` / `MessageInput.tsx`**
Plain-English flow:
- `ConversationList`: renders each conversation with the other participant's
  name and online/offline dot.
- `MessageList`: renders messages in order, distinguishing "sent by me" vs
  "sent by them" visually, shows a typing indicator row that appears when a
  `"typing"` event arrives and disappears on its own after the ~3-second
  timeout described above (no explicit "stopped typing" event needed).
- `MessageInput`: controlled text input + send button, calls the send
  function passed down as a prop; on every keystroke also calls the
  throttled "send typing event" function from `lib/websocket.ts` (not a
  raw send on every character).

**Checkpoint**: full loop — sign up two users in two browser profiles, start
a conversation, send messages live, see typing indicators and online status
update, reload and confirm history + pagination works.

---

## Step 8 — Group chats (Phase 2)

Phase 2 scope (from PLAN.md): group chats → read receipts → file uploads →
push notifications. Doing one feature at a time — this step is group chats
ONLY. Read receipts (the `message_reads` table, the mark-as-read endpoint,
the "Seen" indicator) is deliberately deferred to its own later step, not
bundled in here.

> **Schema decision, discussed and confirmed before writing this step**: no
> new `groups` table. A group is just a `Conversation` with `is_group=True`
> and a `name` — `Participant` already links any number of users to a
> conversation with zero changes needed (it was built as a proper
> many-to-many linking table from Step 3 on, specifically so this wouldn't
> require a schema migration later). The alternative — a `groups` table with
> a single `user_id` foreign key column — can't actually represent more than
> one member per group (a column holds one value; representing 3 members
> would mean 3 rows that all claim to be "the same group," which breaks the
> moment something needs to reference "the group" as one thing). `messages`
> also needs zero changes: `conversation_id` already says which
> conversation/group a message belongs to, `sender_id` already says who sent
> it, regardless of how many people are in that conversation.

> **Decision on group creation UX**: a name field + repeatedly adding member
> emails (reuse the existing `/users/lookup` idea, but resolved server-side
> in one shot rather than N separate frontend round trips — see the new
> endpoint below).

> **Bug this step also forces you to fix**: `app/api/ws/chat.py`'s message
> and typing relay currently do
> `select(Participant.user_id).where(...).scalar_one_or_none()` — that
> assumes there is EXACTLY one other participant. The moment a third person
> joins a conversation, that query returns more than one row and
> `scalar_one_or_none()` raises `MultipleResultsFound`, which crashes the
> whole WebSocket connection (this was hit and confirmed during Step 7
> testing with a degenerate self-conversation). Group chats need this
> rewritten as "loop over every other participant," which fixes the crash as
> a side effect.

**Create/modify inside `backend/app/`:**
```
app/
├── models/
│   └── conversation.py   (modify)
├── schemas/
│   └── conversation.py    (modify)
└── api/
    ├── routes/
    │   └── conversations.py  (modify)
    └── ws/
        └── chat.py           (modify)
```

**`app/models/conversation.py`** (modify)
Why: `Conversation` currently has no way to say "this is a group" or to
store a group name — every conversation today is implicitly 1-to-1.
`Participant` already needs ZERO changes — it's already a plain join table
between conversations and users, so it already supports any number of
members per conversation.
Plain-English steps:
- Add `is_group: Mapped[bool] = mapped_column(Boolean, default=False)` to
  `Conversation` (needs `Boolean` added to the `sqlalchemy` import).
- Add `name: Mapped[str | None] = mapped_column(String, nullable=True)` —
  null for 1-to-1 conversations (the frontend will show the other person's
  display name instead, computed by the backend, not stored).
- Because table creation only happens via `create_all()` (no Alembic), and
  the `conversations` table already exists with data in it from Phase 1
  testing: either run `docker compose down -v` to drop and recreate
  everything fresh, or manually run
  `ALTER TABLE conversations ADD COLUMN is_group BOOLEAN DEFAULT false;` and
  `ALTER TABLE conversations ADD COLUMN name VARCHAR;` against Postgres —
  same trade-off documented back in Step 3.

**`app/schemas/conversation.py`** (modify)
Why: `ConversationSummary` currently has a single `other_user` field, which
only makes sense for exactly-2-participant conversations. Groups need a
shape that works for both cases without the frontend having to special-case
everything.
Plain-English steps:
- Replace `ConversationSummary`'s `other_user: ParticipantSummary` field
  with:
  - `is_group: bool`
  - `name: str` — for a group, the stored group name; for a 1-to-1, the
    OTHER participant's `display_name` (computed by the route, never stored
    for 1-to-1s).
  - `participants: list[ParticipantSummary]` — for a 1-to-1, a list with
    just the other person; for a group, everyone except the current user.
- Add `class GroupCreateRequest(BaseModel): name: str; member_emails: list[str]`
  — the request body for creating a group (see the route below).

**`app/api/routes/conversations.py`** (modify)
Why: every conversation-shaped read/write already lives here; groups are
more endpoints on the same resource, not a new subsystem.

1. **Group creation** — `POST /conversations/group`
   (body: `GroupCreateRequest`, behind `get_current_user`):
   - Look up every email in `member_emails` (same query `/users/lookup`
     already uses). If ANY email doesn't resolve to a user, fail the whole
     request with 404 listing which email(s) — don't create a half-formed
     group. (All-or-nothing, not partial success.)
   - Create one `Conversation(is_group=True, name=payload.name)`, commit,
     refresh to get its id.
   - Create a `Participant` row for `current_user.id` AND for every resolved
     member id, `add_all`, commit.
   - Return the same `ConversationResponse` shape the 1-to-1 endpoint
     already returns (`{"conversation_id": ...}`) — the frontend doesn't
     need to know or care whether what it just created is a group.

2. **List conversations** — rewrite the existing `GET /conversations/`:
   - For each conversation the user's in, fetch `is_group` and the stored
     `name` off the `Conversation` row itself (you'll need to actually
     `SELECT` the `Conversation`, not just `Participant.conversation_id`
     like before).
   - Fetch ALL other participants (drop the implicit "there's only one"
     assumption): `select(User).join(Participant, ...).where(conversation_id == X, user_id != current_user.id)`
     — no `.scalar_one_or_none()`, this can legitimately return many rows
     now; use `.scalars().all()`.
   - Build the summary's `name`: if `is_group`, use the conversation's own
     `name`; if not, use the (single) other participant's `display_name`.
   - Last message + sort-by-recency logic stays the same as before.

3. **Conversation detail** — new `GET /conversations/{conversation_id}`:
   - Same authorization check as the message-history endpoint (current user
     must be a participant, else 403).
   - Returns the same `ConversationSummary` shape as one item from the list
     endpoint. Why this needs to exist separately from the list endpoint:
     the frontend's conversation page only knows the `conversationId` from
     the URL — it has no cheap way to get THIS conversation's participant
     names (for showing "Alice: hello" style sender labels in a group) or
     group name for the header bar, without either re-fetching the whole
     list and filtering client-side, or a dedicated single-conversation
     route. The dedicated route is simpler and cheaper.

**`app/api/ws/chat.py`** (modify)
Why: this is the bug-fix + the feature. Both the message-send path and the
typing-event path currently do "find the ONE other participant" — both need
to become "find ALL other participants, send to each."
Plain-English steps:
- Wherever the code does
  `other = await db.execute(select(Participant.user_id).where(conversation_id == X, user_id != user_id)); other_user_id = other.scalar_one_or_none()`,
  change it to fetch all of them: `other_user_ids = (await db.execute(...)).scalars().all()`.
- Everywhere that used to do
  `if other_user_id is not None: await manager.send_to_user(other_user_id, payload)`,
  change to a loop: `for uid in other_user_ids: await manager.send_to_user(uid, payload)`.
  This applies to BOTH the typing-relay branch and the real-message-relay
  branch — they each currently compute their own "other" independently, so
  both need the same fix.
- Nothing else about the connect/disconnect/presence/heartbeat logic needs
  to change — group chats don't change how any ONE user's socket behaves,
  only how many people a message fans out to.

**Checkpoint**: with two existing users, create a group with a third
(fresh) user via the new endpoint. Open three WebSocket connections (three
browser tabs / accounts). Confirm a message sent by any one of them arrives
live on the OTHER TWO — not just one. Send a `{"type": "typing"}` event from
one tab and confirm BOTH other tabs show a typing indicator.

---

## Step 9 — Frontend: group chats

**Modify inside `frontend/`:**
```
types/index.ts
lib/websocket.ts
app/chat/page.tsx
app/chat/[conversationId]/page.tsx
components/ConversationList.tsx
components/MessageList.tsx
```

**`types/index.ts`**
Plain-English flow:
- `ConversationSummary`: replace `other_user: ParticipantSummary` with
  `is_group: boolean`, `name: string`, `participants: ParticipantSummary[]`
  — mirrors the backend schema change exactly.

**`app/chat/page.tsx`**
Plain-English flow:
- Add a second small form alongside the existing 1-to-1 "start conversation"
  one: a name input, an email input + "Add" button that appends to a local
  list of pending member emails (rendered as removable chips/tags), and a
  "Create group" button that POSTs `{name, member_emails}` to
  `/conversations/group`, then navigates to the returned `conversation_id`
  — same as the 1-to-1 flow already does.

**`components/ConversationList.tsx`**
Plain-English flow:
- Render `conversation.name` as the title (already correct for both cases
  since the backend computes it).
- Online dot: show it if ANY entry in `conversation.participants` has
  `is_online: true` — this happens to work unchanged for 1-to-1 (exactly
  one participant) and now also makes sense for groups (dot means "someone
  in this group is online").

**`app/chat/[conversationId]/page.tsx`**
Plain-English flow:
- On load, also fetch `GET /conversations/${conversationId}` to get
  `is_group`, `name`, and `participants` — store in state, use `name` in the
  header bar (replacing the current bare "← Back" only header) and build a
  quick `id -> display_name` lookup map from `participants` for rendering
  sender names.
- Pass that lookup map down to `MessageList` so it can show a sender name
  above/beside bubbles that aren't the current user's (skip this for 1-to-1
  where it's not needed — there's only one other person).
- Typing indicator: replace the single `isOtherTyping: boolean` with a
  `Set<number>` of currently-typing user ids (still auto-cleared per-user
  after the same ~3s timeout as before — track a timeout per user id, not
  one global timeout, or two people typing at once will incorrectly clear
  each other's indicator early). Render "X is typing…" for one person,
  "X and Y are typing…" for two, "Several people are typing…" beyond that —
  using the participants lookup map for names.

**`components/MessageList.tsx`**
Plain-English flow:
- Accept a `participantsById: Record<number, string>` prop and an
  `isGroup: boolean` prop.
- When `isGroup` and a message isn't the current user's, render the
  sender's display name (looked up via `participantsById[message.sender_id]`)
  in small text above that bubble.

**Checkpoint**: three signed-up users, one creates a group with the other
two by email. All three see it in their chat list with the right name and
an online dot. Messages sent by any one appear live for the other two, with
the sender's name shown on incoming group messages. Typing from two people
at once shows both names.

## Step 10 — Backend: read receipts (Phase 2)

> **Decisions locked in before writing this step**:
> - **Granularity**: per-message, per-user (a `message_reads` table) — not a
>   single `last_read_message_id` pointer. A pointer can't express "Alice's
>   read message 40, Bob's only read message 38" once a conversation has more
>   than 2 people in it.
> - **When a message counts as read**: as soon as it's loaded into a
>   conversation the user has open (on the initial history fetch, and again
>   for each new message that arrives live) — not precise scroll-into-view
>   tracking. Simpler, and "the conversation is open" is a reasonable
>   approximation of "seen" for a practice project.
> - **UI**: a small "Seen" text label under your own message, once every
>   OTHER participant has read it — same plain-text style as the typing
>   indicator, no new icons.

> **Refinements added after review** (two gaps closed before writing any  
> code, both caught by re-reading the mark-read route against patterns this
> codebase already follows elsewhere):
> - **Authorization on `message_ids`, not just on `conversation_id`.** The
>   original draft's mark-read route checked that the current user is a
>   `Participant` of `conversation_id`, but never checked that the requested
>   `message_ids` actually BELONG to that conversation. A stale client cache
>   (or a crafted request) could pass a message id from a different
>   conversation and silently create a `MessageRead` row for it — nobody
>   else's message content leaks, but it's still trusting the request body
>   somewhere this codebase has been careful not to (the "never trust the
>   URL alone" rule from `chat.py`/the history endpoint applies just as much
>   to a request body). Fixed by intersecting `message_ids` against
>   `Message.conversation_id == conversation_id` before doing anything else
>   with them, and separately excluding the current user's own messages
>   (marking your own message "read by you" is meaningless).
> - **Batch the WebSocket broadcast.** The original draft sent one
>   `{"type": "read", ...}` event per newly-read message, per other
>   participant — marking 5 messages read at once in a 3-person group meant
>   10 separate socket sends for a single user action (open the chat once).
>   Changed to one event per participant carrying the FULL list of
>   newly-read message ids in a single send
>   (`{"type": "read", "message_ids": [...], "user_id": ...}`) — same
>   information, a fraction of the socket traffic, same batching instinct
>   already used for the `read_by` query in step 1 below. This changes the
>   event shape Step 11's frontend code needs to handle (updated below too).

**Create/modify inside `backend/app/`:**
```
app/
├── models/
│   └── message_read.py    (new)
├── db/
│   └── base.py             (modify — import message_read)
├── schemas/
│   └── message.py          (modify)
└── api/
    └── routes/
        └── conversations.py (modify)
```

**`app/models/message_read.py`** (new)
Why: read receipts need to answer "which specific users have read this
specific message" — a many-to-many relationship between messages and users
(one message can be read by many users; one user reads many messages) —
same reasoning as `Participant` linking users to conversations. This is a
genuinely new table, unlike group chats which reused `Conversation` — there
is no existing table this data could live on.
Plain-English steps:
- `class MessageRead(Base):` with `__tablename__ = "message_reads"`:
  - `id: Mapped[int] = mapped_column(primary_key=True)`
  - `message_id: Mapped[int] = mapped_column(ForeignKey("messages.id"))`
  - `user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))`
  - `read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())`
- Add `__table_args__ = (UniqueConstraint("message_id", "user_id"),)` inside
  the class body — the DB itself refuses a second read-row for the same
  (message, user) pair. This is a safety net, not the primary mechanism —
  the route below checks first and only inserts what's missing, so the
  constraint mostly guards against a rare double-submit race rather than
  being relied on for every insert. Import `UniqueConstraint` from
  `sqlalchemy` alongside the other imports already used in the model files.
- No Alembic in this project (Step 3) — this is a brand new table though,
  so `create_all()` on the next startup creates it automatically. No manual
  `ALTER TABLE` needed here (unlike Step 8's columns on an existing table).

**`app/db/base.py`** (modify)
Why: same reasoning as every other model — a table that's never imported
never registers on `Base.metadata`, so `create_all()` won't create it.
Plain-English steps:
- Add `message_read` to the bottom-of-file import line:
  `from app.models import user, conversation, message, message_read`.

**`app/schemas/message.py`** (modify)
Why: a message bubble needs to know who's read it to decide whether to show
"Seen".
Plain-English steps:
- Add `read_by: list[int] = []` to `MessageResponse` — the user ids that
  have a `MessageRead` row for this message. This is never a real column on
  `Message` — it gets filled in by the route when building the response
  (see below), same idea as `is_online` being computed rather than stored.

**`app/api/routes/conversations.py`** (modify)
Why: read state is fetched alongside message history, and marked via a new
endpoint on the same conversation resource — no new subsystem needed.

1. **Populate `read_by` on `get_message_history`**:
   - After fetching the page of `Message` rows (existing code), collect
     their ids, then run ONE query:
     `select(MessageRead.message_id, MessageRead.user_id).where(MessageRead.message_id.in_(these_ids))`.
   - Build a `dict[int, list[int]]` mapping `message_id -> [user_id, ...]`
     from those rows (a plain Python loop appending to
     `defaultdict(list)` works fine).
   - When constructing each `MessageResponse`, pass
     `read_by=read_by_map.get(message.id, [])`.
   - Why one batched query instead of one query per message: the same
     N+1-query trap this codebase has avoided everywhere else (see how
     `list_conversations` fetches all participants and all conversations
     up front rather than per-row).

2. **Mark messages read** — new `POST /conversations/{conversation_id}/messages/read`
   (body: `{"message_ids": list[int]}`, behind `get_current_user`):
   - Authorization check — current user must be a `Participant` of
     `conversation_id`, same pattern as every other route here.
   - **Validate `message_ids` before touching the database with them** (see
     the "Refinements added after review" note above for why): run
     `select(Message.id).where(Message.conversation_id == conversation_id, Message.sender_id != current_user.id, Message.id.in_(message_ids))`
     and use ONLY the ids that come back — this drops anything that doesn't
     actually belong to this conversation and anything the current user
     sent themself, in one query. Call this filtered list `valid_ids`; every
     step below uses `valid_ids`, never the raw request body.
   - Find which of `valid_ids` this user has ALREADY read:
     `select(MessageRead.message_id).where(MessageRead.user_id == current_user.id, MessageRead.message_id.in_(valid_ids))`
     — call the result `already_read` (a set).
   - For every id in `valid_ids` that ISN'T in `already_read` (call this
     list `newly_read_ids`), create a `MessageRead(message_id=..., user_id=current_user.id)`,
     `add_all`, `await db.commit()` (remember: `add`/`add_all` are sync,
     `commit` and `refresh` are the ones that need `await` — the exact
     mix-up from Step 8's group endpoint).
   - **Broadcast once per participant, not once per message.** If
     `newly_read_ids` is empty, skip broadcasting entirely (e.g. everything
     requested was already read or got filtered out above — no point
     sending an empty event). Otherwise, fetch every OTHER participant of
     this conversation (identical query to the one already rewritten in
     `chat.py` for group fan-out — `Participant.user_id != current_user.id`)
     and send each of them ONE event carrying the whole batch:
     `await manager.send_to_user(uid, {"type": "read", "message_ids": newly_read_ids, "user_id": current_user.id})`.
     This needs `from app.services.connection_manager import manager`
     added to this file's imports.
   - Return something minimal — a 204 with no body, or
     `{"marked": newly_read_ids}` — the frontend doesn't strictly need the
     response since it already knows what it asked to mark.

**Checkpoint**: open a conversation as one user, send a couple of messages
from a second user (script or second tab), then call the mark-read endpoint
as the first user with those message ids. Re-fetch the conversation's
history and confirm `read_by` now includes the first user's id on those
messages. With both users' sockets open, confirm the SECOND user's socket
receives a `{"type": "read", ...}` event the moment the first user marks
them read — live, no refetch needed.

---

## Step 11 — Frontend: read receipts (Phase 2)

> **Bug hit and fixed while building this step: "Seen" never appeared on
> your OWN messages, even after the other person genuinely read them.**
> Root cause: Phase 1 deliberately never echoed a sent message back to its
> own sender (`chat.py` only relayed to the *other* participant) — the
> sender's own copy of a message it just sent lived only as a locally-added
> placeholder under a fake id (`-Date.now()`). That was harmless until now:
> a `"read"` event carries the REAL database message id, and a placeholder
> under a fake id can never match against it, so `read_by` could never be
> updated for a message you sent — "Seen" was permanently unreachable for
> your own messages within the same session (a full page reload masked
> this, since reloading re-fetches real ids from history). Fixed by
> reversing that Phase 1 decision:
> - **`app/api/ws/chat.py`** (modify): after persisting and relaying a
>   message to every other participant, also
>   `await manager.send_to_user(user_id, payload)` — echo it back to the
>   SENDER's own socket too, carrying the real id.
> - **`app/chat/[conversationId]/page.tsx`**: `handleSend` still adds the
>   optimistic placeholder immediately (for instant-feeling sends), but now
>   also pushes its fake id onto a FIFO queue (`pendingSentIdsRef`). In
>   `onMessage`, check `message.sender_id === currentUserId` first — if
>   true, this is the self-echo, so shift the oldest pending id off the
>   queue and replace that placeholder message with the confirmed one
>   (`setMessages(prev => prev.map(m => m.id === placeholderId ? message : m))`)
>   instead of appending a duplicate. FIFO order is safe here because a
>   single WebSocket connection persists and echoes messages in the exact
>   order they were sent — no need to match by content.
> This also updated the "no echo" note in `CLAUDE.md`'s architecture
> section, since it was a documented pattern that this step deliberately
> reverses.

**Modify inside `frontend/`:**
```
types/index.ts
lib/websocket.ts
app/api/ws/chat.py            (backend — see the self-echo fix above)
app/chat/[conversationId]/page.tsx
components/MessageList.tsx
```

**`types/index.ts`**
Plain-English flow:
- `Message`: add `read_by: number[]`.
- Add `export type ReadEvent = { type: "read"; message_ids: number[]; user_id: number };`
  alongside the existing `TypingEvent` — plural `message_ids`, matching the
  batched broadcast decided in Step 10 (one WebSocket event per participant
  per mark-read call, carrying every newly-read id at once, not one event
  per message).

**`lib/websocket.ts`**
Plain-English flow:
- `useChatSocket`'s handlers object gains a third callback:
  `onRead: (messageIds: number[], userId: number) => void`.
- In `onmessage`, the branching currently checks
  `if (data.type === "typing") { ... } else { ...treat as Message... }`.
  Add a middle branch: `else if (data.type === "read") { handlersRef.current.onRead(data.message_ids, data.user_id); }`
  — same pattern as the typing branch, just a different `type` value and a
  different handler.

**`app/chat/[conversationId]/page.tsx`**
Plain-English flow:
- Wire up `onRead` in the `useChatSocket(...)` call: on each incoming
  `(messageIds, userId)` pair, do ONE `setMessages` update that maps over
  local `messages` state and, for every message whose `id` is in
  `messageIds`, adds `userId` to its `read_by` array (if not already
  present) — same shape as `onMessage`/`onTyping` already use, just checking
  membership in an array instead of a single id match.
- Mark-as-read triggering (per the "on load + on arrival" decision):
  - Right after the initial `Promise.all([...])` history fetch resolves,
    call the mark-read endpoint once with the ids of every loaded message
    NOT sent by the current user (`messages.filter(m => m.sender_id !== currentUserId).map(m => m.id)`)
    — no point marking your own messages as read.
  - In the `onMessage` handler (a new message arriving live), after adding
    it to state, if `message.sender_id !== currentUserId` call the
    mark-read endpoint again with just that one new message's id. Small
    payloads, no batching needed for a single incoming message.
  - Both of these are just `apiJson(`/conversations/${conversationId}/messages/read`, { method: "POST", body: JSON.stringify({ message_ids: [...] }) })`
    calls — fire-and-forget is fine here (no need to block the UI on the
    response).

**`components/MessageList.tsx`**
Plain-English flow:
- Accept an `otherParticipantIds: number[]` prop (the ids of every OTHER
  participant in this conversation — for a 1-to-1 that's a list of one; for
  a group, everyone but you. `conversation.participants.map(p => p.id)`
  from the parent already gives you exactly this).
- For messages where `isMine` is true, compute
  `const seenByEveryone = otherParticipantIds.every(id => message.read_by.includes(id))`.
  When `seenByEveryone` is true, render a small "Seen" label under that
  bubble (same styling as the existing typing-indicator text — muted, small,
  italic optional).
- Messages that aren't yours never show a read indicator — read receipts
  are about "did THEY read MY message," not the reverse.

**Checkpoint**: two users in a 1-to-1, or three in a group. Send a message —
sender sees no "Seen" yet. Have every OTHER participant open the
conversation (triggering the on-load mark-read call) — the sender's message
flips to "Seen" live, without reloading. Send a second message while
everyone already has the conversation open — it should flip to "Seen"
almost immediately (the on-arrival mark-read firing on each recipient's
client). Reload the page entirely and confirm the "Seen" state persists
(comes back from `read_by` on the history fetch, not just live state).

---

## Step 12 — Backend: file/image uploads (Phase 2) ✅ Done

Phase 2 scope (from PLAN.md): group chats ✅ → read receipts ✅ → **file/image
uploads** → push notifications. Originally planned around a local MinIO
container; switched to a real AWS S3 bucket instead (decided after
discussion — see below), which changes a few specifics but not the core
pattern: still a pre-signed-URL upload, still `boto3`.

> **What actually got built, and where it differs from the plan below:**
> - `verify_bucket()`, `presigned_put_url()`, and `presigned_get_url()` ended
>   up living in `core/config.py` alongside `Settings`, not in a separate
>   `core/storage.py` — functionally identical to the plan, just one file
>   instead of two. `main.py` imports `verify_bucket` from `app.core.config`,
>   not `app.core.storage`.
> - The presign route is `POST /uploads/{conversation_id}/presign`
>   (registered with `prefix="/uploads"` in `main.py`), not
>   `POST /conversations/{conversation_id}/uploads/presign` as originally
>   drafted below — the plan's wording was corrected to match what's actually
>   wired up and what the frontend calls.
> - `uploads.py` takes the request as a JSON body (`PresignUploadRequest`),
>   not query params, so it reuses the schema that already existed instead of
>   leaving it dead code.
>
> **Real bugs hit while building this (useful if you hit the same class of
> error again):**
> - `models/attachment.py` first had `from tokenize import String` (a typo —
>   `tokenize.String` is an unrelated token-type constant) and was missing
>   `DateTime`/`func` imports entirely — `NameError` the moment the class
>   body executed. Fixed by importing all four from `sqlalchemy`.
> - Two wrong import paths crashed app startup with `ModuleNotFoundError`:
>   `conversations.py` had `from backend.app.models.attachment import
>   Attachment` (should be `app.models.attachment`, no `backend.` prefix —
>   every other import in that same file already gets this right), and
>   `uploads.py` imported `PresignUploadResponse` from a `app.schemas.uploads`
>   module that never existed (the real file is `app.schemas.attachment`).
> - `db/base.py`'s bottom-of-file import line imported the `Attachment`
>   *class* instead of the `attachment` *module* — `app/models/__init__.py`
>   is empty, so nothing re-exports the class at package level, and this
>   raised `ImportError`. Fixed to match the module-import pattern every
>   other model in that line already uses.
> - `Settings` was missing all four AWS fields even though the module-level
>   `s3_client = boto3.client(...)` line right below referenced
>   `settings.aws_access_key_id` etc. — `AttributeError` at import time.
> - The real ordering bug, and the subtlest one: `Attachment(message_id=
>   message.id, ...)` was originally being built *before* `db.add(message)` /
>   `await db.commit()` / `await db.refresh(message)` — at that point
>   `message.id` is still `None` (SQLAlchemy only assigns a primary key once
>   a row is actually flushed to Postgres), so every attachment was silently
>   saved with `message_id = NULL`. Fixed by creating the message, committing
>   it, refreshing it, and only THEN building the `Attachment` off its now-real
>   `message.id`.
> - `uploads.py` initially had no `get_current_user`/participant check at all
>   (anyone could request an upload URL into ANY conversation) and no
>   content-type/size validation — closed by adding the 403 participant
>   check, a content-type allow-list + 10MB cap (400 on either), and a
>   `uuid4()` prefix on `object_key` so two same-named uploads in one
>   conversation can't silently overwrite each other in S3.
> - `verify_bucket()` originally swallowed every exception and returned
>   `False` instead of raising, and `main.py` wasn't even calling it from
>   `lifespan` — a broken bucket/credentials config would have failed
>   silently instead of refusing to start, exactly the failure mode the
>   design notes below explicitly want to avoid.
>
> **Verification**: tested against a real AWS S3 bucket, not mocks — signed
> up two real users, created a real conversation, then: a non-participant's
> presign request → 403; a disallowed content-type → 400; an oversized
> `size_bytes` → 400; a valid request → got back a real `upload_url` +
> `object_key`; a real `curl -T` PUT of an actual PNG straight to that URL →
> 200, confirmed in the S3 console; a WebSocket message referencing that
> `object_key` → an `attachments` row in Postgres with the CORRECT
> `message_id` (confirming the ordering-bug fix), and both the relay (to the
> other participant) and the self-echo carried a working, openable
> `download_url`; re-fetching conversation history returned the SAME
> attachment with a DIFFERENT signature/timestamp in its `download_url` than
> the WebSocket event had — proof it's regenerated fresh on every read, never
> cached or stored; downloading through that URL produced bytes byte-for-byte
> identical to the original upload. Backend logs stayed clean throughout, no
> tracebacks.

> **Design decisions locked in before writing this step** (discussed and
> confirmed, including two changes from an earlier draft of this plan):
> - **Real AWS S3, not local MinIO.** `boto3` talks to both identically — no
>   backend code differs based on which one you point it at — so this is
>   purely a config choice, not an architecture one. Trade-off worth being
>   deliberate about: real S3 needs real credentials in `.env` (never
>   committed — use an IAM user scoped to ONLY this one bucket, never your
>   AWS root/admin keys) and requires actual internet access even for local
>   dev, whereas MinIO was fully offline and free. Since the AWS account
>   already exists, this is a reasonable trade to make.
> - **Upload transport: pre-signed URLs, not a backend-proxied upload**
>   (already the intent in `PLAN.md`, confirmed again in discussion). The
>   file's bytes flow straight from the browser to S3 over a direct `PUT`;
>   your FastAPI backend never touches the file content at all, only issues
>   a short-lived signed URL first and records metadata after. This matters
>   because an async backend holding a connection open for the full duration
>   of a large upload ties up a worker for no reason — letting the object
>   store handle the heavy lifting is the standard scalable pattern.
> - **This ordering choice also fixes a real bug in an earlier version of
>   this plan.** The first draft was "create the DB row, then upload to S3"
>   — if the upload failed afterward (network blip, crash), you'd be left
>   with a message in the chat claiming to have an image that was never
>   actually stored: a permanently broken bubble for everyone in that
>   conversation, with no clean retry path. The pre-signed flow makes this
>   impossible by construction: the browser's `PUT` to S3 completes (or
>   fails) BEFORE the browser ever tells the backend "attach this to a
>   message" — the DB row only gets created once the upload is already a
>   known-good fact.
> - **Client library: `boto3`.** The standard, most broadly useful (and most
>   interview-relevant) S3 client. `generate_presigned_url` is pure local
>   HMAC signing, no network call — safe to call directly inside an
>   `async def` route without a thread executor, unlike a real upload/
>   download which WOULD block.
> - **Bucket creation: manual, one-time, NOT automatic on backend startup.**
>   This is the one place real AWS genuinely differs from the MinIO plan,
>   and deliberately so: an S3 bucket name is globally unique across ALL of
>   AWS (not just your account) and has real billing/lifecycle implications
>   — auto-creating it from app startup code (fine for throwaway local MinIO
>   infra you recreate constantly) is the wrong instinct for a real cloud
>   resource. Create the bucket once yourself via the AWS Console or CLI;
>   the backend only ever verifies it exists (`head_bucket`) at startup and
>   fails loudly with a clear error if it doesn't, rather than trying to
>   create one.
> - **Known limitation, stated plainly rather than silently skipped:** the
>   presign endpoint validates the CLAIMED `content_type`/`size_bytes` before
>   issuing a URL, but the backend never sees the actual uploaded bytes (that
>   is the entire point of a direct-to-S3 upload) — so a client that lies
>   about those values and then uploads something else entirely isn't
>   caught. A production system would add a post-upload verification step
>   (e.g. an S3 event notification triggering a Lambda/webhook). Out of
>   scope for this practice project; noted here so it's a known, deliberate
>   gap rather than an overlooked one.

**Create/modify:**
```
.env                         (modify — AWS credentials/bucket name)
backend/requirements.txt     (modify — add boto3)
backend/app/
├── core/
│   ├── config.py            (modify — AWS/S3 settings)
│   └── storage.py           (new — boto3 client + verify_bucket())
├── models/
│   └── attachment.py        (new)
├── db/
│   └── base.py              (modify — import attachment)
├── schemas/
│   ├── attachment.py        (new)
│   └── message.py           (modify — MessageResponse gains `attachment`)
├── api/
│   ├── routes/
│   │   ├── uploads.py       (new — presign endpoint)
│   │   └── conversations.py (modify — embed attachment + fresh download URL
│   │                          on history fetch, same batching pattern as
│   │                          Step 10's read_by)
│   └── ws/
│       └── chat.py          (modify — accept an attachment on message send,
│                              embed a fresh download URL in the relay/echo)
└── main.py                  (modify — call verify_bucket() in lifespan)
```

**One-time manual setup (not code — do this yourself before running the
backend):**
1. In the AWS Console, create an S3 bucket (e.g. `your-name-chat-uploads` —
   remember bucket names are globally unique, so a generic name like
   `chat-uploads` is almost certainly already taken by someone else).
   Leave "Block all public access" ON — nothing here should be publicly
   readable; access only ever happens through short-lived pre-signed URLs.
2. Create an IAM user (or role) with a policy scoped to ONLY that bucket —
   `s3:PutObject`, `s3:GetObject`, `s3:HeadBucket` on
   `arn:aws:s3:::your-bucket-name` and `arn:aws:s3:::your-bucket-name/*`.
   Do not reuse your AWS root account's access keys here.
3. Generate an access key pair for that IAM user — this is what goes in
   `.env`, never your root credentials.

**`.env`** (modify)
Plain-English flow:
- Add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (the
  IAM user's credentials and the bucket's region), and `S3_BUCKET_NAME`.

**`backend/app/core/config.py`** (modify)
Plain-English flow:
- Add `aws_access_key_id`, `aws_secret_access_key`, `aws_region`,
  `s3_bucket_name` fields to `Settings`.

**`backend/app/core/storage.py`** (new)
Why: same reasoning as `db/session.py` and `core/redis.py` — one shared
client, created once, imported everywhere that needs object storage,
instead of every route constructing its own.
Plain-English steps:
1. `s3_client = boto3.client("s3", region_name=settings.aws_region, aws_access_key_id=settings.aws_access_key_id, aws_secret_access_key=settings.aws_secret_access_key)`
   — no `endpoint_url` override needed; omitting it means `boto3` talks to
   real AWS by default. (Worth knowing for later: adding an `endpoint_url`
   back in is the ONLY change that would be needed to point this same code
   at a local MinIO instead — e.g. for running tests without touching real
   AWS.)
2. `async def verify_bucket()`: call `s3_client.head_bucket(Bucket=settings.s3_bucket_name)` — if it raises, raise a clear startup error ("bucket X doesn't exist or these credentials can't see it — create it manually first") rather than attempting to create one. Even though this is a sync `boto3` call sitting inside an `async def`, that's fine here: it runs once at startup, not per-request.
3. A small `def presigned_put_url(object_key, content_type) -> str` and
   `def presigned_get_url(object_key) -> str` helper pair, both wrapping
   `s3_client.generate_presigned_url(...)` — centralizing the `ExpiresIn`
   values (short for uploads, e.g. 300s; longer for downloads, e.g. 3600s)
   in one place instead of scattering magic numbers across routes.

**`backend/app/models/attachment.py`** (new)
Why: a message that carries a file needs somewhere to record WHAT file —
same reasoning as `MessageRead` in Step 10, a genuinely new table since
nothing existing can hold this.
Plain-English steps:
- `class Attachment(Base):` `__tablename__ = "attachments"`:
  - `id`, `message_id` (`ForeignKey("messages.id")`), `object_key: str`
    (the S3 object key — deliberately NOT a full URL, since a presigned URL
    expires and gets regenerated fresh on every read; storing one would
    just go stale), `original_filename: str`, `mime_type: str`,
    `size_bytes: int`, `created_at`.
- Brand new table → `create_all()` handles it on next startup, no manual
  `ALTER TABLE` needed (same as `message_reads` in Step 10).

**`backend/app/db/base.py`** (modify)
- Add `attachment` to the bottom-of-file import line, same reasoning as
  every other model.

**`backend/app/schemas/attachment.py`** (new)
Plain-English steps:
- `PresignUploadRequest(BaseModel)`: `filename: str`, `content_type: str`,
  `size_bytes: int`.
- `PresignUploadResponse(BaseModel)`: `upload_url: str`, `object_key: str`.
- `AttachmentResponse(BaseModel)`: `id: int`, `download_url: str`,
  `original_filename: str`, `mime_type: str`, `size_bytes: int`.

**`backend/app/schemas/message.py`** (modify)
- Add `attachment: AttachmentResponse | None = None` to `MessageResponse` —
  same "computed, not a real column" reasoning as `read_by` in Step 10.

**`backend/app/api/routes/uploads.py`** (new)
Why: requesting permission to upload is its own request/response action,
separate from the WebSocket's job of relaying chat events — matches how
`conversations.py` already separates plain HTTP actions (create, history)
from the WebSocket's live-relay job.
Plain-English steps for `POST /uploads/{conversation_id}/presign`
(body: `PresignUploadRequest`, behind `get_current_user`):
1. Authorization — current user must be a `Participant` of
   `conversation_id`, identical pattern to every other route touching a
   conversation. Never trust that being logged in alone means you can
   upload into any conversation.
2. Validate the CLAIMED `content_type` against an allow-list (e.g. common
   image types plus a couple of document types) and `size_bytes` against a
   cap (e.g. 10 MB) — reject with 400 before issuing a URL if either fails.
   Remember the limitation noted above: this only rejects obviously-wrong
   requests up front, it can't verify what actually gets uploaded after.
3. Build a unique object key:
   `f"conversations/{conversation_id}/{uuid4()}-{payload.filename}"` —
   namespaced by conversation (useful for browsing the S3 console), a
   UUID prefix so two people uploading a same-named file never collide or
   silently overwrite each other.
4. `presigned_put_url(object_key, payload.content_type)` from
   `storage.py`, return `PresignUploadResponse(upload_url=..., object_key=object_key)`.

**`backend/app/api/ws/chat.py`** (modify)
Why: sending a file message is still "a message in this conversation" —
reuses the exact same create-relay-echo flow Step 11 just built for text,
just with an optional attachment attached to it.
Plain-English steps:
1. Incoming WS payload for a file message:
   `{"type": "image" | "file", "object_key": "...", "original_filename": "...", "mime_type": "...", "size_bytes": ..., "content": "optional caption"}`.
2. After creating and committing the `Message` row (`type` taken from
   `data.get("type", "text")`, `content` can be empty/caption), if
   `data.get("object_key")` is present: create an
   `Attachment(message_id=message.id, object_key=..., original_filename=..., mime_type=..., size_bytes=...)`,
   `db.add`, `await db.commit()`.
3. When building the relay payload, if the message has an attachment,
   generate a FRESH `presigned_get_url(object_key)` and embed it as
   `attachment: {id, download_url, original_filename, mime_type, size_bytes}`
   — never store or reuse a previously-generated URL, since it may have
   expired.
4. Everything else — relay to every other participant, THEN echo back to
   the sender's own socket (Step 11's fix) — is unchanged; a file message
   fans out and self-reconciles exactly like a text message.

**`backend/app/api/routes/conversations.py`** (modify)
Why: history needs to show past attachments too, with a freshly-generated
(not stale) download URL, same spirit as Step 10's `read_by` batching.
Plain-English steps:
- After fetching the page of `Message` rows, batch-fetch `Attachment` rows
  for those message ids in ONE query (`Attachment.message_id.in_([...])`)
  — same N+1-avoidance reasoning as `read_by`.
- For every message that has a matching `Attachment`, generate a fresh
  `presigned_get_url(object_key)` and attach it when building that
  message's `MessageResponse`.

**`backend/app/main.py`** (modify)
- Import `verify_bucket` from `app.core.config` (see the "what actually got
  built" callout above — it ended up living there, not in a separate
  `storage.py`), call `await verify_bucket()`
  in the `lifespan` alongside the existing `await init_models()` — if the
  bucket doesn't exist or the credentials can't see it, this should fail
  startup loudly and immediately rather than only surfacing as a confusing
  403 the first time someone tries to upload a file.

**Checkpoint**: after completing the one-time manual AWS setup above,
`docker compose up --build` should start cleanly (confirms `verify_bucket()`
found the bucket). Call the presign endpoint for a real conversation with a
valid image content-type/size, `PUT` a real file to the returned
`upload_url` with `curl` or a script, confirm the file appears in the S3
console under the expected `conversations/{id}/...` key. Send a WS message
referencing that `object_key`, confirm a `messages` row AND an
`attachments` row both exist in Postgres, and the relayed/echoed payload
contains a working `download_url` you can open directly in a browser.
Re-fetch conversation history and confirm the attachment still has a valid
(freshly-generated) `download_url`, not the original one.

---

## Step 13 — Frontend: file/image uploads (Phase 2) ✅ Done

> **What actually got built, and where it differs from the plan below:**
> - One addition beyond this plan: `components/MessageList.tsx` also opens a
>   fullscreen lightbox (dark backdrop, image scaled to fit) when you click
>   an inline image — click anywhere or press Escape to close. Not in the
>   original scope, added afterward as a small UX improvement.
> - A real gap this step's testing surfaced: the bucket needed an explicit
>   CORS policy before the browser's direct `PUT` to S3 would work at all.
>   Every backend-side test of Step 12 (curl, a raw Python `websockets`
>   client) had passed cleanly — but neither of those is a browser, and CORS
>   is a browser-only enforcement mechanism, so none of that testing could
>   have caught this. The actual failure in the browser was a generic
>   `TypeError: Failed to fetch` from `lib/uploads.ts`'s raw `fetch(upload_url,
>   { method: "PUT", ... })` call — diagnosed by recognizing that a
>   cross-origin PUT with a non-simple `Content-Type` header triggers a
>   preflight `OPTIONS` request, which S3 refuses without a CORS
>   configuration on the bucket. Fixed with a one-time bucket-level CORS
>   rule (AWS Console → bucket → Permissions → CORS):
>   ```json
>   [{
>     "AllowedHeaders": ["*"],
>     "AllowedMethods": ["PUT", "GET"],
>     "AllowedOrigins": ["http://localhost:3000"],
>     "ExposeHeaders": []
>   }]
>   ```
>   Add the real deployed origin here too once this goes beyond localhost.
>
> **Verification**: `npx tsc --noEmit` and `npm run lint` both clean (one
> benign `next/image` perf suggestion — a plain `<img>` is the right call
> here since presigned URLs expire and aren't worth `next/image`'s remote-
> pattern caching). Confirmed live in a real browser, logged in as a real
> test user: uploaded a real PNG and a real PDF through the exact
> presign → S3 `PUT` → WebSocket-send path the UI code takes; the image
> rendered inline with its caption below it, the PDF rendered as a 📄
> filename link (not a broken image), and clicking the PDF link opened the
> real file through its presigned URL. No console errors, no CORS failures
> loading the S3 image. One thing NOT verified by browser automation in this
> environment: actually clicking the 📎 button and picking a file through the
> OS-native file dialog — the browser-automation tooling used here can't
> drive that native dialog, so that specific interaction needs a manual
> click-through; everything downstream of file selection (`uploadFile`, the
> presign call, the S3 `PUT`, the WebSocket send, and the rendering) has been
> exercised with real data and confirmed working.

**Modify/create inside `frontend/`:**
```
types/index.ts
lib/uploads.ts                            (new)
lib/websocket.ts
components/MessageInput.tsx
components/MessageList.tsx
app/chat/[conversationId]/page.tsx
```

**`types/index.ts`**
Plain-English flow:
- Add `Attachment` interface mirroring `AttachmentResponse`: `id`,
  `download_url`, `original_filename`, `mime_type`, `size_bytes`.
- `Message` gains `attachment?: Attachment | null`.

**`lib/uploads.ts`** (new)
Why: the upload flow is a multi-step dance (ask backend for permission,
then talk to S3 directly) that doesn't belong inlined in a component.
Plain-English steps:
1. `async function uploadFile(conversationId, file): Promise<{object_key, original_filename, mime_type, size_bytes}>`.
2. Call the presign endpoint via the existing `apiJson` helper:
   `POST /uploads/${conversationId}/presign` with
   `{filename: file.name, content_type: file.type, size_bytes: file.size}`.
3. `fetch(upload_url, { method: "PUT", body: file, headers: { "Content-Type": file.type } })`
   — a RAW `fetch`, deliberately NOT `apiJson`/`apiFetch`: this request goes
   to S3, not your backend, and must NOT carry your app's `Authorization`
   bearer token — the presigned URL itself IS the auth, and an unexpected
   extra header could even invalidate S3's signature check.
4. Return the metadata the caller needs to send over the WebSocket next —
   this function's job ends once the bytes are safely in S3.

**`components/MessageInput.tsx`** (modify)
Plain-English flow:
- Add a hidden `<input type="file">` behind a visible button/icon.
- On file selection: disable the input (prevent double-submission while
  uploading), call `uploadFile(conversationId, file)`, then call a new
  `onSendFile` prop with the returned metadata plus a `type` of `"image"`
  if `mime_type.startsWith("image/")`, else `"file"`. Re-enable the input
  once done (success or failure) — show an error inline on failure (e.g.
  the presign request was rejected for size/type) rather than silently
  swallowing it.

**`lib/websocket.ts`** (modify)
- Add a `sendFileMessage(payload)` alongside the existing `sendMessage`,
  sending the richer `{type, object_key, original_filename, mime_type, size_bytes, content}`
  shape over the same socket — `sendMessage` stays untouched for plain text.

**`app/chat/[conversationId]/page.tsx`** (modify)
Plain-English flow:
- `onSendFile` handler mirrors `handleSend` exactly: add an optimistic
  placeholder message immediately (so the UI doesn't wait on the network),
  push its id onto the SAME `pendingSentIdsRef` queue Step 11 already
  built, call `sendFileMessage(...)`. When the self-echo arrives via
  `onMessage` (already reconciling by shifting the oldest pending id), the
  placeholder gets swapped for the confirmed message — attachment,
  real id, and real `download_url` all included for free, no new
  reconciliation logic needed.

**`components/MessageList.tsx`** (modify)
Plain-English flow:
- When a message has `attachment`:
  - If `mime_type` starts with `image/`: render
    `<img src={attachment.download_url} />` inside the bubble (capped
    `max-width`/`max-height`, matching the existing bubble's `max-w-xs`).
  - Otherwise: render a small file icon plus `attachment.original_filename`
    as a clickable `<a href={attachment.download_url} download>` link.
- A message can still have `content` as a caption alongside the attachment
  — render both (image/link first, caption text below or above it) rather
  than treating them as mutually exclusive.

**Checkpoint**: pick an image in a 1-to-1 or group chat — see a brief
"uploading" state, then the image renders inline for the sender (via the
self-echo/reconciliation path) and live for every other open participant
(via the relay). Reload the page and confirm the image still renders (a
freshly-generated `download_url` from the history endpoint, not a stale
cached one — if this breaks, the presigned URL probably expired before the
reload, which would actually indicate the history endpoint isn't
regenerating it fresh as designed). Send a non-image file (e.g. a PDF) and
confirm it renders as a download link, not a broken image tag. Try a file
over the size cap or an unsupported type and confirm the upload is rejected
with a visible error before anything reaches S3.

---

## Step 14 — Backend: push notifications (Phase 2)

Phase 2 scope (from PLAN.md): group chats ✅ → read receipts ✅ → file/image
uploads ✅ → **push notifications**, the last Phase 2 feature before Phase 3's
RAG work begins.

> **Design decisions locked in before writing this step:**
> - **Trigger condition: the recipient has NO active WebSocket connection,
>   not "the recipient is online."** This is the one point worth being
>   explicit about, since it's easy to get backwards: a push notification's
>   entire purpose is reaching someone who ISN'T currently looking at the
>   app. A connected recipient already receives the message live through
>   `chat.py`'s existing fan-out loop (`manager.send_to_user(uid, payload)`)
>   — sending them a push on top of that would just double up as a
>   redundant OS-level popup for something already on their screen.
>   `PLAN.md`'s own feature list says this directly: "Push notifications
>   (for offline users)."
> - **Signal source: `ConnectionManager.active_connections`, not Redis
>   presence.** Both describe roughly the same fact, but `manager`'s own
>   in-memory registry is the literal, zero-latency truth ("is there an open
>   socket for this user on THIS process right now"), whereas Redis presence
>   is a TTL-based derivative of it with up to ~30s of staleness after a real
>   disconnect (Step 6's self-healing design). Using presence here risks
>   skipping a push for someone who disconnected seconds ago but whose
>   presence key hasn't expired yet. Checking `manager` avoids both the
>   staleness window and an extra async Redis round-trip inside the
>   message-send path.
> - **Known, accepted limitation — stated plainly, not silently glossed
>   over:** `ConnectionManager` keys connections by `user_id` alone, not
>   `(user_id, conversation_id)` — a single open tab counts as "connected"
>   regardless of which conversation it's showing. So a user actively
>   chatting in conversation A will NOT get a push for a new message in
>   conversation B, even though they aren't actually looking at B. Correctly
>   scoping "connected to THIS conversation" would need `ConnectionManager`
>   to track which conversation(s) each socket is viewing — a reasonable
>   future refinement, out of scope for this phase (same spirit as the
>   presign endpoint's "can't verify actual uploaded bytes" limitation called
>   out in Step 12).
> - **Delivery: Web Push API + VAPID via `pywebpush`, sent inline from the
>   WebSocket handler — no Celery queue yet.** `PLAN.md`'s tech-stack table
>   originally earmarks Celery for "push notification dispatch," but Celery's
>   actual justification in this project is Phase 3's doc-ingestion/embedding
>   pipeline (a genuinely slow, multi-step background job) — a single push
>   send is one outbound HTTPS call to a browser's push service, fast enough
>   to `await` (wrapped via a thread executor, since `pywebpush` itself is
>   sync/blocking) without holding up the WebSocket loop noticeably. Standing
>   up a whole worker service for this alone would be solving a problem this
>   phase doesn't have yet — same reasoning Step 6 used to defer Redis
>   pub/sub until there's more than one backend replica. Revisit if Phase 3's
>   Celery worker ends up getting built anyway (it will, for RAG ingestion) —
>   at that point moving push dispatch onto the same queue becomes close to
>   free.
> - **A push subscription can go stale** (user revoked notification
>   permission, uninstalled, cleared site data) — `pywebpush` raises an error
>   (commonly a 410 Gone from the push service) when this happens. Handle by
>   deleting that subscription row so future sends don't keep retrying a dead
>   endpoint — don't let a stale subscription silently accumulate failed
>   attempts forever.

**Create/modify:**
```
.env                             (modify — VAPID keypair)
backend/requirements.txt         (modify — add pywebpush)
backend/app/
├── core/
│   └── config.py                (modify — VAPID settings)
├── models/
│   └── push_subscription.py     (new)
├── db/
│   └── base.py                  (modify — import push_subscription)
├── schemas/
│   └── push_subscription.py     (new)
├── services/
│   └── push.py                  (new — send_push_notification())
├── api/
│   ├── routes/
│   │   └── push.py              (new — subscribe/unsubscribe endpoints)
│   └── ws/
│       └── chat.py              (modify — push the offline branch of the
│                                  existing fan-out loop)
└── main.py                      (modify — register push.router)
```

**One-time manual setup (not code):**
1. Generate a VAPID key pair once (e.g. `pywebpush`'s own `vapid.py` CLI, or
   the `py-vapid` package's `vapid --gen` command) — a public key and a
   private key, plus a contact email VAPID requires for its "claims."
2. Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CLAIMS_EMAIL` to
   `.env`. The public key also needs to reach the frontend (it's not a
   secret — browsers need it to create a subscription), so it'll be read
   from a public config value on the frontend side in Step 15, not hardcoded
   twice.

**`backend/app/models/push_subscription.py`** (new)
Why: one user can grant notification permission from multiple
browsers/devices — each is a genuinely separate subscription, so this needs
its own table rather than a column on `users`.
Plain-English steps:
- `class PushSubscription(Base):` `__tablename__ = "push_subscriptions"`:
  - `id`, `user_id` (`ForeignKey("users.id")`), `endpoint: str` (the
    browser's push-service URL — unique per subscription), `p256dh: str`
    and `auth: str` (the two keys the Push API's `subscribe()` call
    returns, needed to encrypt the payload), `created_at`.
- Brand new table → `create_all()` handles it, no manual `ALTER TABLE`
  needed (same as every other new table added so far).

**`backend/app/db/base.py`** (modify)
- Add `push_subscription` to the bottom-of-file import line, same pattern as
  every other model.

**`backend/app/schemas/push_subscription.py`** (new)
Plain-English steps:
- `PushSubscriptionRequest(BaseModel)`: `endpoint: str`, `keys: dict` (or
  explicit `p256dh: str` / `auth: str` fields) — mirrors the exact shape the
  browser's `PushSubscription.toJSON()` produces, so the frontend can send
  it through basically unchanged.

**`backend/app/core/config.py`** (modify)
- Add `vapid_public_key`, `vapid_private_key`, `vapid_claims_email` fields
  to `Settings`.

**`backend/app/services/push.py`** (new)
Why: same "one shared helper, not reimplemented per call site" reasoning as
`storage`'s presigned-URL helpers.
Plain-English steps:
1. `async def send_push_notification(db, user_id, title, body, conversation_id)`:
   query all `PushSubscription` rows for `user_id` (there may be several —
   loop over every one, not just the first).
2. For each subscription, call `pywebpush.webpush(subscription_info={...},
   data=json.dumps({"title": title, "body": body, "conversation_id":
   conversation_id}), vapid_private_key=settings.vapid_private_key,
   vapid_claims={"sub": f"mailto:{settings.vapid_claims_email}"})` — wrapped
   in `asyncio.to_thread(...)` since `pywebpush` itself makes a blocking
   HTTP call.
3. Catch `WebPushException`: if the push service responds 404/410 (endpoint
   gone), delete that `PushSubscription` row — a dead subscription should
   stop being retried, not fail silently forever on every future message.

**`backend/app/api/routes/push.py`** (new)
Plain-English steps for `POST /push/subscribe` (body:
`PushSubscriptionRequest`, behind `get_current_user`):
1. Upsert a `PushSubscription` row for `(current_user.id, endpoint)` — if
   the same browser subscribes twice (e.g. page reload re-registers), update
   the existing row's keys rather than creating a duplicate.
Plain-English steps for `DELETE /push/subscribe` (body: `{endpoint: str}`,
behind `get_current_user`):
1. Delete the matching `PushSubscription` row — lets the frontend clean up
   when the user explicitly disables notifications, instead of only ever
   relying on the 410-triggered cleanup in `push.py`'s service layer.

**`backend/app/api/ws/chat.py`** (modify)
Why: this is the one real behavior change — everywhere the existing code
loops over `other_user_ids` to relay a live message, it now also needs to
decide "did this person actually receive that relay, or are they offline?"
Plain-English steps:
1. Right where the existing loop does
   `for uid in other_user_ids: await manager.send_to_user(uid, payload)`,
   branch per recipient: if `manager.active_connections.get(uid)` is
   truthy, send live exactly as today; if NOT (no open socket for that
   user_id at all), call
   `await send_push_notification(db, uid, title=sender_display_name,
   body=message.content or "Sent an attachment", conversation_id=conversation_id)`
   instead.
2. Nothing about the sender's own self-echo changes — you never push-notify
   yourself.

**`backend/app/main.py`** (modify)
- Import and register `push.router` the same way every other router is
  wired in (`app.include_router(push.router, prefix="/push", tags=["push"])`).

**Checkpoint**: subscribe a test browser via `POST /push/subscribe` with a
real `PushSubscription` payload, confirm the row lands in
`push_subscriptions`. With that same user's WebSocket deliberately NOT
connected, send a message to them from another user and confirm a real OS
notification appears (test via a script calling `send_push_notification`
directly against a real subscription, same spirit as Step 12's curl-based
backend verification before any frontend existed). Then connect that same
user's WebSocket and send another message — confirm NO push fires this time,
only the live relay. Revoke notification permission in the browser, send a
message again, confirm the stale subscription gets deleted after the first
failed send rather than erroring on every subsequent message.

---

## Step 15 — Frontend: push notifications (Phase 2)

**Modify/create inside `frontend/`:**
```
public/sw.js                              (new — service worker)
lib/push.ts                               (new)
lib/config.ts                             (modify — expose VAPID public key)
app/chat/page.tsx                         (modify — "Enable notifications" entry point)
```

**`public/sw.js`** (new)
Why: the Push API fundamentally requires a Service Worker — the browser
delivers a push event to this background script even when no tab for your
site is open, which is the entire point ("offline" here means "no open
WebSocket," but the user's browser itself still needs to be running for a
push to be deliverable at all — that's a Push API constraint, not something
this app's design controls).
Plain-English steps:
1. Listen for the `push` event: parse `event.data.json()` (the
   `{title, body, conversation_id}` payload `services/push.py` sent),
   call `self.registration.showNotification(title, { body, data:
   { conversation_id } })`.
2. Listen for `notificationclick`: close the notification and
   `clients.openWindow()` to `/chat/{conversation_id}` — clicking a push
   should take you straight to the relevant conversation, not just the
   generic chat list.

**`lib/push.ts`** (new)
Plain-English steps:
1. `async function enablePushNotifications()`: call
   `Notification.requestPermission()` — if denied, stop and surface that to
   the caller rather than silently retrying.
2. `navigator.serviceWorker.register("/sw.js")`, then
   `registration.pushManager.subscribe({ userVisibleOnly: true,
   applicationServerKey: VAPID_PUBLIC_KEY })` — `userVisibleOnly: true` is
   required by the Push API spec (a page can't silently receive pushes
   without ever showing the user something).
3. POST the resulting subscription (`subscription.toJSON()`) to
   `/push/subscribe` via the existing `apiJson` helper.

**`lib/config.ts`** (modify)
- Add `VAPID_PUBLIC_KEY` read from a `NEXT_PUBLIC_...` env var — needs the
  `NEXT_PUBLIC_` prefix because, unlike the backend's secret VAPID private
  key, this value legitimately needs to reach client-side JS.

**`app/chat/page.tsx`** (modify)
Plain-English flow:
- Add a small "Enable notifications" button/banner (skip rendering it
  entirely if `Notification.permission === "granted"` already, or if the
  Push API isn't supported in this browser at all) that calls
  `enablePushNotifications()` from `lib/push.ts` on click.

**Checkpoint**: click "Enable notifications," grant the browser permission
prompt, confirm a `push_subscriptions` row appears for your user. Close the
tab (or just the specific conversation — remember Step 14's known
limitation: any open tab counts as "connected," so fully close the app to
test this) and have another user send you a message — confirm a real OS-level
notification appears, and clicking it opens the right conversation. Reopen
the tab/app and send another message from the other side — confirm this
time NO push fires, since you're connected again and get it live instead.
