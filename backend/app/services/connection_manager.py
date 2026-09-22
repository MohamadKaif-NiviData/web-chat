# Why: a WebSocket connection is a live, in-memory Python object — there's
# no way to "look one up" later except by keeping your own registry. This
# class IS that registry, so app/api/ws/chat.py can ask "is this user
# online, and if so, which socket(s) do I push a message to?"
#
# Plain-English steps:
# 1. Import `WebSocket` from `fastapi`.
# 2. `class ConnectionManager:` with, in `__init__`:
#    `self.active_connections: dict[int, list[WebSocket]] = {}` — a LIST per
#    user, not a single socket, because the same user might have the app
#    open in two browser tabs or two devices at once.
# 3. `async def connect(self, user_id: int, websocket: WebSocket):`
#    - `await websocket.accept()` — completes the WebSocket handshake;
#      nothing can be sent or received on this socket before this line runs.
#    - `self.active_connections.setdefault(user_id, []).append(websocket)`.
# 4. `def disconnect(self, user_id: int, websocket: WebSocket):`
#    - remove `websocket` from `self.active_connections[user_id]`.,.
#      `active_connections` slowly fills up with empty lists for every user
#      who's ever disconnected.
# 5. `async def send_to_user(self, user_id: int, message: dict):`
#    - loop over `self.active_connections.get(user_id, [])` and
#      `await ws.send_json(message)` on each. If the user has no entry
#      (offline), this is just a no-op — not an error.
# 6. At the BOTTOM of the file (module level, outside the class):
#    `manager = ConnectionManager()` — ONE shared instance, imported by
#    `chat.py`. This must be a singleton: if every WebSocket connection
#    created its own `ConnectionManager()`, they'd never see each other's
#    connections and no message could ever be delivered.
#
# Known limitation (stated plainly, not a bug to fix now): this registry
# lives in this Python process's memory. Fine for a single backend
# container (all this project runs), but wouldn't work across multiple
# backend replicas — user A connected to replica 1 would be invisible to a
# message arriving on replica 2. Fixing that needs a shared broker (e.g.
# Redis pub/sub) instead of an in-memory dict — out of scope for Phase 1.

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, list[WebSocket] ] = {}

    async def connect(self,user_id:int, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.setdefault(user_id, []).append(websocket)

    def disconnect(self,user_id:int, websocket: WebSocket):
        connections = self.active_connections.get(user_id)
        if connections and websocket in connections:
            connections.remove(websocket)
            if not connections:
                del self.active_connections[user_id]
    
    async def send_to_user(self, user_id:int, message: dict):
        for ws in self.active_connections.get(user_id, []):
            await ws.send_json(message)


manager = ConnectionManager()

