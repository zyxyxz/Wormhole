"""Shared slowapi Limiter instance.

Routes import `limiter` from this module and decorate themselves with
`@limiter.limit("N/minute")`. `app.main` wires this same instance onto
`app.state.limiter` and registers the exception handler so the decorator
can resolve at request time.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

# In-memory fixed-window limiter keyed by client IP. This is per-process and
# does not share state across workers; for a single-process deployment that's
# fine. Move to a shared backend (e.g. Redis) if/when we scale out.
limiter = Limiter(key_func=get_remote_address)
