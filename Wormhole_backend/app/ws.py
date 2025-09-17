from typing import Dict, Set
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.active: Dict[int, Set[WebSocket]] = {}

    async def connect(self, space_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active.setdefault(space_id, set()).add(websocket)

    def disconnect(self, space_id: int, websocket: WebSocket):
        try:
            self.active.get(space_id, set()).discard(websocket)
        except Exception:
            pass

    async def broadcast(self, space_id: int, message: dict):
        for ws in list(self.active.get(space_id, set())):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(space_id, ws)


chat_manager = ConnectionManager()
event_manager = ConnectionManager()
