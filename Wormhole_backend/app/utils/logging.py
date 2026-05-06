"""Structured (JSON) logging configuration.

Activated by calling `configure_logging()` once at startup. Uses stdlib
logging only — no external deps. Each log record becomes a single JSON line
on stdout, suitable for ELK/Loki/CloudWatch.
"""
import json
import logging
import logging.config
from typing import Any, Dict


class JsonFormatter(logging.Formatter):
    """Render log records as single-line JSON.

    Standard fields: ts, level, logger, message, module, line.
    Includes `exc_info` traceback when present.
    Any extra=... kwargs supplied by callers are merged at the top level.
    """

    DEFAULT_LOG_RECORD_KEYS = {
        "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
        "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
        "created", "msecs", "relativeCreated", "thread", "threadName",
        "processName", "process", "message", "asctime", "taskName",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "ts": int(record.created * 1000),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        # Merge any extra= fields the caller passed in.
        for key, value in record.__dict__.items():
            if key in self.DEFAULT_LOG_RECORD_KEYS:
                continue
            try:
                json.dumps(value)
            except (TypeError, ValueError):
                value = str(value)
            payload[key] = value
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    """Apply JSON-line logging config. Idempotent."""
    logging.config.dictConfig({
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {"()": JsonFormatter},
        },
        "handlers": {
            "stdout": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "formatter": "json",
            },
        },
        "root": {
            "handlers": ["stdout"],
            "level": level,
        },
        "loggers": {
            "uvicorn": {"handlers": ["stdout"], "level": level, "propagate": False},
            "uvicorn.access": {"handlers": ["stdout"], "level": level, "propagate": False},
            "uvicorn.error": {"handlers": ["stdout"], "level": level, "propagate": False},
        },
    })
