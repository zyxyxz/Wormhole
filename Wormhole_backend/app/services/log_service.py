"""Async background worker that batches operation log writes off the request path.

Callers stay synchronous via ``enqueue_log(...)``. A background coroutine
``log_worker`` drains the queue (up to ``BATCH_SIZE`` entries at a time) and
persists them via the application's ``AsyncSessionLocal``.

Started/stopped from ``app.main`` lifespan via :func:`start_log_worker` and
:func:`stop_log_worker`.
"""
import asyncio
import json
import logging
from typing import Any, Dict, Optional

from app.database import AsyncSessionLocal
from models.logs import OperationLog


_logger = logging.getLogger("wormhole.logs")

QUEUE_MAX_SIZE = 10000
BATCH_SIZE = 100
DRAIN_TIMEOUT_S = 5.0  # how long to wait on shutdown for the worker to flush

_queue: Optional[asyncio.Queue] = None
_worker_task: Optional[asyncio.Task] = None
_shutdown_event: Optional[asyncio.Event] = None


def _serialize_detail(detail: Any) -> Optional[str]:
    if detail is None or isinstance(detail, str):
        return detail
    try:
        return json.dumps(detail, ensure_ascii=False)
    except Exception:
        return str(detail)


def enqueue_log(
    *,
    user_id: Optional[str],
    action: Optional[str],
    space_id: Optional[int] = None,
    detail: Any = None,
    page: Optional[str] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    """Enqueue an operation log entry.

    Drops silently if the queue is full or the worker hasn't started yet
    (e.g. running under a unit test that never spins up the worker).
    """
    if not user_id or not action:
        return
    if _queue is None:
        # Worker hasn't started — drop the log to avoid blocking. Tests use this path.
        _logger.debug(
            "log_service queue not initialized; dropping log %s/%s", user_id, action
        )
        return
    payload: Dict[str, Any] = {
        "user_id": user_id,
        "action": action,
        "space_id": space_id,
        "detail": _serialize_detail(detail),
        "page": page,
        "ip": ip,
        "user_agent": user_agent,
    }
    try:
        _queue.put_nowait(payload)
    except asyncio.QueueFull:
        _logger.warning(
            "operation log queue full; dropping entry user=%s action=%s",
            user_id,
            action,
        )


async def _drain_one_batch() -> bool:
    """Block on first item, then opportunistically drain up to BATCH_SIZE more.

    Returns True if any items were processed.
    """
    if _queue is None:
        return False
    batch = [await _queue.get()]
    try:
        while len(batch) < BATCH_SIZE:
            batch.append(_queue.get_nowait())
    except asyncio.QueueEmpty:
        pass
    try:
        async with AsyncSessionLocal() as session:
            session.add_all([OperationLog(**entry) for entry in batch])
            await session.commit()
    except Exception:
        _logger.exception(
            "log_worker failed to persist batch of %d entries", len(batch)
        )
    finally:
        for _ in batch:
            try:
                _queue.task_done()
            except ValueError:
                # task_done called more times than items put — defensive only.
                pass
    return True


async def log_worker() -> None:
    """Drain the queue until the shutdown event fires AND the queue is empty."""
    assert _queue is not None and _shutdown_event is not None
    _logger.info("log_worker started")
    while not _shutdown_event.is_set() or not _queue.empty():
        try:
            # wait_for guards against permanently blocking on an empty queue
            # at shutdown; on timeout we re-check the loop condition.
            await asyncio.wait_for(_drain_one_batch(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        except asyncio.CancelledError:
            break
        except Exception:
            _logger.exception("log_worker iteration failed")
    _logger.info("log_worker stopped")


def start_log_worker() -> None:
    """Initialize the queue and start the worker. Idempotent."""
    global _queue, _worker_task, _shutdown_event
    if _worker_task is not None and not _worker_task.done():
        return
    _queue = asyncio.Queue(maxsize=QUEUE_MAX_SIZE)
    _shutdown_event = asyncio.Event()
    _worker_task = asyncio.create_task(log_worker(), name="wormhole-log-worker")


async def stop_log_worker() -> None:
    """Signal the worker to drain and exit. Cancels if drain exceeds DRAIN_TIMEOUT_S."""
    global _worker_task, _shutdown_event, _queue
    if _worker_task is None or _shutdown_event is None:
        return
    _shutdown_event.set()
    try:
        await asyncio.wait_for(_worker_task, timeout=DRAIN_TIMEOUT_S)
    except asyncio.TimeoutError:
        _worker_task.cancel()
        try:
            await _worker_task
        except (asyncio.CancelledError, Exception):
            pass
    _worker_task = None
    _shutdown_event = None
    _queue = None
