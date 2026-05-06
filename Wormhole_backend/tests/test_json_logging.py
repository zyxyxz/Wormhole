"""Verify JSON formatter produces single-line JSON."""
import json
import logging

from app.utils.logging import JsonFormatter, configure_logging


def test_json_formatter_outputs_valid_json():
    fmt = JsonFormatter()
    rec = logging.LogRecord(
        name="test", level=logging.INFO, pathname="x.py", lineno=10,
        msg="hello %s", args=("world",), exc_info=None,
    )
    out = fmt.format(rec)
    parsed = json.loads(out)
    assert parsed["message"] == "hello world"
    assert parsed["level"] == "INFO"
    assert parsed["logger"] == "test"
    assert parsed["line"] == 10


def test_json_formatter_includes_extra_fields():
    fmt = JsonFormatter()
    rec = logging.LogRecord(
        name="test", level=logging.INFO, pathname="x.py", lineno=10,
        msg="event", args=(), exc_info=None,
    )
    rec.user_id = "alice"
    rec.action = "send"
    out = fmt.format(rec)
    parsed = json.loads(out)
    assert parsed["user_id"] == "alice"
    assert parsed["action"] == "send"


def test_json_formatter_handles_exception():
    fmt = JsonFormatter()
    try:
        raise ValueError("boom")
    except ValueError:
        import sys
        rec = logging.LogRecord(
            name="test", level=logging.ERROR, pathname="x.py", lineno=10,
            msg="oh no", args=(), exc_info=sys.exc_info(),
        )
    out = fmt.format(rec)
    parsed = json.loads(out)
    assert "exc" in parsed
    assert "ValueError" in parsed["exc"]


def test_json_formatter_handles_unserializable_extras():
    """Non-JSON-serializable extras should fall back to str() rather than crash."""
    fmt = JsonFormatter()
    rec = logging.LogRecord(
        name="test", level=logging.INFO, pathname="x.py", lineno=10,
        msg="event", args=(), exc_info=None,
    )

    class Weird:
        def __repr__(self):
            return "<Weird>"

    rec.thing = Weird()
    out = fmt.format(rec)
    parsed = json.loads(out)
    assert parsed["thing"] == "<Weird>"


def test_configure_logging_is_idempotent():
    """Calling configure_logging twice should not raise."""
    configure_logging()
    configure_logging()
