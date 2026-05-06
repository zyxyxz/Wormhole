"""Task 31: nested replies (楼中楼) on feed comments.

Covers the model-level invariants — that ``Comment.parent_id`` round-trips
through the DB — and the route-level depth/cross-post validation that
caps the tree at two levels.

Route-layer checks invoke the handler directly with a hand-rolled fake
``Request`` and an in-memory ``AsyncSession``. The full app + auth dance
in ``test_e2e.py`` is too heavy and brittle for this slice; calling the
handler directly is enough to exercise the validation branches.
"""
import pytest
import pytest_asyncio
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.api.feed.comments import add_comment
from models.feed import Comment, Post
from models.space import Space, SpaceMember
from schemas.feed import CommentCreate

# Importing the model modules registers them on Base.metadata so create_all
# materialises every table the handler might touch.
import models.feed  # noqa: F401
import models.user  # noqa: F401
import models.space  # noqa: F401
import models.logs  # noqa: F401


@pytest_asyncio.fixture()
async def memdb():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        yield session
    await engine.dispose()


def _fake_request(user_id: str = "alice"):
    """Minimal stand-in for ``starlette.Request`` that ``add_comment`` reads."""
    return SimpleNamespace(
        client=SimpleNamespace(host="127.0.0.1"),
        headers={"user-agent": "pytest"},
        state=SimpleNamespace(user_id=user_id),
    )


async def _seed_post_with_membership(db: AsyncSession, *, space_id=1, post_id=1, owner="alice"):
    """Create the Space/Post/SpaceMember rows ``add_comment`` requires."""
    space = Space(id=space_id, owner_user_id=owner, code="ABC")
    db.add(space)
    db.add(SpaceMember(space_id=space_id, user_id=owner))
    db.add(SpaceMember(space_id=space_id, user_id="bob"))
    db.add(Post(id=post_id, space_id=space_id, user_id=owner, content="hello"))
    await db.commit()


@pytest.mark.asyncio
async def test_comment_supports_parent_id(memdb):
    """Round-trip: ``parent_id`` is persisted and readable from the model."""
    parent = Comment(post_id=1, user_id="alice", content="top")
    memdb.add(parent)
    await memdb.commit()
    await memdb.refresh(parent)
    assert parent.parent_id is None

    child = Comment(post_id=1, user_id="bob", content="reply", parent_id=parent.id)
    memdb.add(child)
    await memdb.commit()
    await memdb.refresh(child)

    assert child.parent_id == parent.id


@pytest.mark.asyncio
async def test_add_comment_accepts_parent_id(memdb):
    await _seed_post_with_membership(memdb)
    parent = Comment(post_id=1, user_id="alice", content="top")
    memdb.add(parent)
    await memdb.commit()
    await memdb.refresh(parent)

    with patch("app.api.feed.comments.verify_request_user", return_value="bob"), \
         patch("app.api.feed.comments.add_operation_log"):
        resp = await add_comment(
            CommentCreate(post_id=1, user_id="bob", content="reply", parent_id=parent.id),
            _fake_request("bob"),
            memdb,
        )

    assert resp.parent_id == parent.id
    assert resp.content == "reply"


@pytest.mark.asyncio
async def test_add_comment_rejects_three_level_nesting(memdb):
    """A reply targeting a reply (parent already has a parent) must 400."""
    await _seed_post_with_membership(memdb)
    top = Comment(post_id=1, user_id="alice", content="top")
    memdb.add(top)
    await memdb.commit()
    await memdb.refresh(top)
    mid = Comment(post_id=1, user_id="bob", content="mid", parent_id=top.id)
    memdb.add(mid)
    await memdb.commit()
    await memdb.refresh(mid)

    with patch("app.api.feed.comments.verify_request_user", return_value="alice"), \
         patch("app.api.feed.comments.add_operation_log"):
        with pytest.raises(HTTPException) as exc:
            await add_comment(
                CommentCreate(post_id=1, user_id="alice", content="grandchild", parent_id=mid.id),
                _fake_request("alice"),
                memdb,
            )
    assert exc.value.status_code == 400
    assert "三级" in exc.value.detail


@pytest.mark.asyncio
async def test_add_comment_rejects_missing_parent(memdb):
    await _seed_post_with_membership(memdb)
    with patch("app.api.feed.comments.verify_request_user", return_value="bob"), \
         patch("app.api.feed.comments.add_operation_log"):
        with pytest.raises(HTTPException) as exc:
            await add_comment(
                CommentCreate(post_id=1, user_id="bob", content="orphan", parent_id=999),
                _fake_request("bob"),
                memdb,
            )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_add_comment_rejects_cross_post_parent(memdb):
    """A reply whose parent lives under a different post must 400."""
    await _seed_post_with_membership(memdb, post_id=1)
    # Second post in the same space so membership still passes.
    memdb.add(Post(id=2, space_id=1, user_id="alice", content="other"))
    parent = Comment(post_id=2, user_id="alice", content="other-top")
    memdb.add(parent)
    await memdb.commit()
    await memdb.refresh(parent)

    with patch("app.api.feed.comments.verify_request_user", return_value="bob"), \
         patch("app.api.feed.comments.add_operation_log"):
        with pytest.raises(HTTPException) as exc:
            await add_comment(
                CommentCreate(post_id=1, user_id="bob", content="wrong-post", parent_id=parent.id),
                _fake_request("bob"),
                memdb,
            )
    assert exc.value.status_code == 400
    assert "不匹配" in exc.value.detail
