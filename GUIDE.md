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
| 7 — Frontend: auth + chat UI | ⬜ Not started |

**Next up: Step 4** — Step 3 is fully done: `users`, `conversations`,
`participants`, `messages` all created automatically via
`Base.metadata.create_all()` on startup. Time to build the auth endpoints:
`app/schemas/user.py`, `app/schemas/auth.py`, `app/api/deps.py`,
`app/api/routes/auth.py`.

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

## After Phase 1

Once every checkpoint above passes, Phase 1 (MVP) is done. Come back and I'll
write the same style of guide for Phase 2 (group chats, read receipts, file
uploads, push notifications).
