"""Verify the WS presence handshake sends a unicast presence frame to the connecting socket."""
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.ws import ChatStateManager


@pytest.mark.asyncio
async def test_send_presence_to_emits_current_snapshot():
    mgr = ChatStateManager()
    ws_a = MagicMock()
    ws_a.send_json = AsyncMock()
    ws_b = MagicMock()
    ws_b.send_json = AsyncMock()

    # Two users in space 1: alice already connected
    mgr.ws_user[ws_a] = "alice"
    mgr.user_counts[1] = {"alice": 1}
    mgr.active[1] = {ws_a}

    # Bob just connected; send him the presence snapshot directly
    await mgr.send_presence_to(ws_b, 1)

    ws_b.send_json.assert_awaited_once()
    payload = ws_b.send_json.await_args.args[0]
    assert payload["event"] == "presence"
    assert payload["online_user_ids"] == ["alice"]
    assert payload["online_count"] == 1


@pytest.mark.asyncio
async def test_send_presence_to_swallows_send_errors():
    mgr = ChatStateManager()
    ws_dead = MagicMock()
    ws_dead.send_json = AsyncMock(side_effect=ConnectionError("dead"))

    # Empty space; should not raise even if the socket is broken
    await mgr.send_presence_to(ws_dead, 1)
    ws_dead.send_json.assert_awaited_once()
