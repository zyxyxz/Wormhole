import json
from models.logs import OperationLog


def add_operation_log(
    db,
    *,
    user_id: str | None,
    action: str | None,
    space_id: int | None = None,
    detail=None,
    ip: str | None = None,
    user_agent: str | None = None,
):
    if not user_id or not action:
        return
    detail_value = detail
    if detail is not None and not isinstance(detail, str):
        try:
            detail_value = json.dumps(detail, ensure_ascii=False)
        except Exception:
            detail_value = str(detail)
    db.add(OperationLog(
        user_id=user_id,
        action=action,
        page=None,
        detail=detail_value,
        space_id=space_id,
        ip=ip,
        user_agent=user_agent
    ))
