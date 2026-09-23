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

