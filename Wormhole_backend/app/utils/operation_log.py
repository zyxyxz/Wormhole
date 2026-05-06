"""Compatibility shim — call sites pass ``db`` and use this entry point.

Internally enqueues to the async log worker (see :mod:`app.services.log_service`).
The ``db`` parameter is accepted for backwards compatibility but is unused;
the worker writes via its own session, off the request path.
"""
from app.services.log_service import enqueue_log


def add_operation_log(
    db,
    *,
    user_id: str | None,
    action: str | None,
    space_id: int | None = None,
    detail=None,
    page: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
):
    """Enqueue an operation log entry.

    The ``db`` parameter is kept for callsite compatibility but unused — the
    worker persists asynchronously through its own session.
    """
    enqueue_log(
        user_id=user_id,
        action=action,
        space_id=space_id,
        detail=detail,
        page=page,
        ip=ip,
        user_agent=user_agent,
    )
