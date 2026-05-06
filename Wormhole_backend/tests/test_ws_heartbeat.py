"""Verify ChatStateManager tracks last_seen and identifies idle sockets."""
import time
from unittest.mock import MagicMock

from app.ws import ChatStateManager


def test_touch_records_recent_activity():
    mgr = ChatStateManager()
    ws = MagicMock()
    before = time.time()
    mgr.touch(ws)
    after = time.time()
    assert before <= mgr.last_seen[ws] <= after


def test_register_user_touches_socket():
    mgr = ChatStateManager()
    ws = MagicMock()
    mgr.register_user(space_id=1, websocket=ws, user_id="alice")
    assert ws in mgr.last_seen


def test_is_idle_threshold():
    mgr = ChatStateManager()
    ws = MagicMock()
    mgr.last_seen[ws] = time.time() - 200  # 200s ago
    assert mgr.is_idle(ws, threshold_s=180) is True
    assert mgr.is_idle(ws, threshold_s=300) is False


def test_disconnect_cleans_last_seen():
    mgr = ChatStateManager()
    ws = MagicMock()
    mgr.register_user(space_id=1, websocket=ws, user_id="alice")
    assert ws in mgr.last_seen
    mgr.disconnect(space_id=1, websocket=ws)
    assert ws not in mgr.last_seen


def test_is_idle_unknown_socket_treats_as_idle():
    """A socket we never saw has last_seen=0; treat as idle so a stale connection is kicked."""
    mgr = ChatStateManager()
    ws = MagicMock()
    assert mgr.is_idle(ws, threshold_s=180) is True
