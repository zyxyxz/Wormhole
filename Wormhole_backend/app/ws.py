from typing import Dict, Set, Optional
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


class ChatStateManager(ConnectionManager):
    def __init__(self):
        super().__init__()
        self.ws_user: Dict[WebSocket, str] = {}
        self.user_counts: Dict[int, Dict[str, int]] = {}
        self.typing_users: Dict[int, Set[str]] = {}

    def register_user(self, space_id: int, websocket: WebSocket, user_id: str):
        if not user_id:
            return
        current = self.ws_user.get(websocket)
        if current == user_id:
            return
        if current:
            self._decrement(space_id, current)
        self.ws_user[websocket] = user_id
        self._increment(space_id, user_id)

    def _increment(self, space_id: int, user_id: str):
        counts = self.user_counts.setdefault(space_id, {})
        counts[user_id] = counts.get(user_id, 0) + 1

    def _decrement(self, space_id: int, user_id: str):
        counts = self.user_counts.get(space_id, {})
        if user_id in counts:
            counts[user_id] -= 1
            if counts[user_id] <= 0:
                del counts[user_id]

    def set_typing(self, space_id: int, user_id: str, typing: bool):
        if not user_id:
            return
        typing_set = self.typing_users.setdefault(space_id, set())
        if typing:
            typing_set.add(user_id)
        else:
            typing_set.discard(user_id)

    def get_online_users(self, space_id: int) -> list[str]:
        return list(self.user_counts.get(space_id, {}).keys())

    def get_typing_users(self, space_id: int) -> list[str]:
        return list(self.typing_users.get(space_id, set()))

    def disconnect(self, space_id: int, websocket: WebSocket) -> Optional[str]:
        user_id = self.ws_user.pop(websocket, None)
        if user_id:
            self._decrement(space_id, user_id)
            self.typing_users.get(space_id, set()).discard(user_id)
        super().disconnect(space_id, websocket)
        return user_id

    async def broadcast_presence(self, space_id: int):
        online_users = self.get_online_users(space_id)
        await self.broadcast(space_id, {
            "event": "presence",
            "online_user_ids": online_users,
            "online_count": len(online_users),
        })


chat_manager = ChatStateManager()
event_manager = ConnectionManager()
