# Real-Time Chat Application — Project Plan

## Goal
A practice project to build real full-stack engineering skills (React/Next.js/TS,
FastAPI, PostgreSQL, Docker) through a genuinely non-trivial system — a real-time
chat application — with a RAG-powered AI assistant integrated as a chat participant.

Not a CRUD demo: the point is to exercise WebSockets, presence, async job
processing, caching/pub-sub, file storage, push notifications, and retrieval-
augmented generation together, the way a real product would need them.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router) + React + TypeScript | Target skills; SSR for chat list, client components for live chat |
| Realtime transport | Native WebSockets (FastAPI `WebSocket`) | Learn the protocol directly, no Socket.IO abstraction |
| Backend | FastAPI (Python) | Async-native, handles WS + REST in one service |
| Database | PostgreSQL | Users, conversations, messages, receipts |
| Vector search (Phase 3) | pgvector extension on same Postgres | RAG bot embeddings, no extra DB service |
| Pub/Sub + presence | Redis | WS fan-out across instances, online/offline TTL keys, typing events |
| Background jobs | Celery + Redis broker | Doc ingestion/embedding for RAG bot, push notification dispatch |
| File storage | MinIO (S3-compatible, local) | Image/file uploads via pre-signed URLs |
| Push notifications | Web Push API (VAPID) | Standard, self-hostable, no vendor lock-in |
| Infra | Docker Compose | frontend, backend, worker, postgres, redis, minio — one command up |

---

## Architecture

```
Next.js (TS) ──WebSocket/HTTP── FastAPI ──┬── Postgres (users, chats, messages, read receipts)
                                            ├── Redis (pub/sub for WS fan-out, presence, typing state)
                                            ├── Celery worker (doc ingestion → embed → pgvector)
                                            ├── MinIO/S3 (file & image uploads)
                                            └── Web Push (VAPID) for notifications
```

**Why Redis pub/sub matters**: if more than one FastAPI instance runs, a
WebSocket connected to instance A can't see a message sent via instance B
unless something broadcasts between instances. Redis pub/sub is the bridge —
worth doing even locally via `docker-compose scale backend=2` to feel the
problem firsthand.

**RAG placement**: the AI assistant is a special `user` row that can be added
to any conversation. Dropping a document into a conversation triggers a
Celery ingestion job (extract → chunk → embed → store in pgvector). Mentioning
the bot triggers a similarity search + streamed, cited answer back into the
chat like a normal message.

---

## Feature Scope

### MVP — Phase 1 (no RAG yet)
- Auth (JWT + refresh)
- 1-to-1 chat over WebSocket
- Message persistence + cursor-based (keyset) pagination
- Online/offline status
- Typing indicators

### Phase 2
- Group chats (multi-participant conversations)
- Read receipts
- File/image uploads
- Push notifications (for offline users)

### Phase 3 — RAG payoff
- AI bot as a chat participant
- Document upload → Celery embeds into pgvector
- @mention triggers streamed, cited RAG answer in-chat

---

## Data Model (core tables)

```
users(id, email, password_hash, ...)
conversations(id, is_group, created_at)
participants(conversation_id, user_id, joined_at, last_read_message_id)
messages(id, conversation_id, sender_id, content, type, created_at)
message_reads(message_id, user_id, read_at)
attachments(id, message_id, file_url, mime_type)

-- Phase 3
documents(id, conversation_id, file_url, status)
embeddings(id, document_id, chunk_text, embedding vector(1536))
```

---

## Build Order / Roadmap

1. Scaffold Docker Compose (frontend, backend, postgres, redis, minio)
2. Backend auth (JWT/refresh) + user schema
3. 1-to-1 WebSocket chat + message persistence + cursor pagination
4. Presence (online/offline) + typing indicators via Redis
5. Frontend: auth pages + chat UI (conversation list + live message view)
6. Group chats + read receipts
7. File/image uploads via MinIO
8. Push notifications (Web Push/VAPID)
9. RAG: pgvector setup + Celery ingestion pipeline
10. RAG: AI bot participant with streamed, cited answers

---

## Working Agreement
- The user (dev2) writes and manages all code and infrastructure.
- Claude's role is guidance: architecture decisions, reviewing approach,
  answering questions, unblocking design problems — not writing the
  implementation unless explicitly asked.
