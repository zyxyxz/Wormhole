# Wormhole 全面优化与重构 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在保持现有功能可用的前提下，分阶段修复安全漏洞、修复 WebSocket 稳定性问题、合并 HTTP/WS 重复路径、拆分巨型文件、补齐限流/索引/限速等基础工程，并扩展核心功能（离线发送、编辑、reactions、@、搜索、楼中楼、vault 加固）。SQLite 暂留，多实例与 Postgres 迁移延后。

**Architecture:**
- 后端：FastAPI 拆出 `app/services/` 业务层（chat_service / log_service / notify_service），WS 端点收敛到 `app/api/ws/`，HTTP 端点专注查询。
- 前端：小程序 `app.js` 与 `pages/chat/chat.js` 按职责拆模块（`utils/auth.js / utils/theme.js / utils/network.js / utils/badge.js / utils/lock.js`；chat 页拆出 `chat-ws.js / chat-voice.js / chat-sticker.js / chat-reply.js / chat-list.js`）。
- 实时通道：服务端发心跳 + 客户端指数退避重连，CDN 900s 超时前主动 ping；WS 作为消息发送 SSOT，HTTP `/api/chat/send` 弃用。
- 操作日志：从主请求路径剥离，走 `BackgroundTasks` + 批量；增 DB 索引。

**Tech Stack:** FastAPI + SQLAlchemy async + SQLite + WebSocket、阿里云 OSS、微信小程序原生（WeChat MiniProgram）。新增依赖：`slowapi`（限流）、`alembic`（迁移）、`pytest-asyncio` + `httpx`（测试）。

---

## 执行总览

| Phase | 主题 | 风险 | 时长估算 | 必须先于 |
|---|---|---|---|---|
| 1 | P0 安全 | 高（鉴权、数据泄漏） | 1 天 | 全部 |
| 2 | WS 稳定性 + HTTP/WS 合并 | 中（影响实时通道） | 2 天 | 3,4,5 |
| 3 | 后端架构与代码质量 | 中（重构） | 3 天 | 5 |
| 4 | 前端架构与代码质量 | 中（重构） | 3 天 | 5 |
| 5 | 功能增强 | 低（增量） | 5 天 | — |

每个 Task 完成后立即 commit，message 用 `<phase>: <action>`，例如 `sec: enforce JWT secret at startup`。

---

# Phase 1 — P0 安全修复

## Task 1: 启动时强制 `AUTH_JWT_SECRET` 必填

**Files:**
- Modify: `Wormhole_backend/app/security.py:25-26`
- Modify: `Wormhole_backend/app/config.py:32-33`
- Modify: `Wormhole_backend/app/main.py`（startup 校验）
- Test: `Wormhole_backend/tests/test_security_bootstrap.py`（新建）

**Step 1: 写失败测试**
```python
# tests/test_security_bootstrap.py
import importlib, os, pytest

def test_missing_jwt_secret_raises(monkeypatch):
    monkeypatch.delenv("AUTH_JWT_SECRET", raising=False)
    monkeypatch.setenv("WORMHOLE_ENV", "production")
    import app.security as sec
    importlib.reload(sec)
    with pytest.raises(RuntimeError, match="AUTH_JWT_SECRET"):
        sec.assert_jwt_secret_configured()
```

**Step 2: 运行测试预期失败**
```bash
cd Wormhole_backend && pytest tests/test_security_bootstrap.py -v
```
Expected: FAIL（`assert_jwt_secret_configured` 未定义）

**Step 3: 实现**
```python
# app/security.py 顶部新增
def assert_jwt_secret_configured() -> None:
    env = os.getenv("WORMHOLE_ENV", "development")
    if env == "production" and not settings.AUTH_JWT_SECRET:
        raise RuntimeError(
            "AUTH_JWT_SECRET is required in production"
        )
```
```python
# app/main.py lifespan / startup（迁移到 lifespan 见 Task 12，先在 startup 内调用）
from app.security import assert_jwt_secret_configured
@app.on_event("startup")
async def startup():
    assert_jwt_secret_configured()
    ...
```
同时改 `JWT_SECRET` 计算：`= settings.AUTH_JWT_SECRET or "wormhole-dev-secret"`（**移除 WECHAT_APP_SECRET 回退**）。

**Step 4: 运行测试**
```bash
pytest tests/test_security_bootstrap.py -v
```
Expected: PASS

**Step 5: Commit**
```bash
git add Wormhole_backend/app/security.py Wormhole_backend/app/main.py Wormhole_backend/tests/test_security_bootstrap.py
git commit -m "sec: enforce AUTH_JWT_SECRET in production, drop wechat-secret fallback"
```

---

## Task 2: 移除 query 中 `user_id` 的鉴权回退

**Files:**
- Modify: `Wormhole_backend/app/security.py:105-115, 168-201, 199-201, 256-263`
- Modify: `Wormhole_miniapp/app.js:296-336`（`patchNetworkSecurity`）
- Modify: `Wormhole_miniapp/app.js:246-256`（`appendUserIdToUrl`，仅 WS 保留）

**Step 1: 写失败测试** — `tests/test_security_query_fallback.py`
```python
async def test_query_user_id_no_longer_authenticates(client):
    resp = await client.get("/api/chat/history?space_id=1&user_id=oeXXX")
    assert resp.status_code in (401, 403)
```

**Step 2: 运行预期失败**

**Step 3: 实现**
- `_extract_query_user_id` 仅 WebSocket 端点使用（小程序 WS 无法发自定义 header），HTTP 路径完全忽略。把 `verify_request_user` 与 `get_header_user_id` 拆为 `verify_http_user` / `verify_ws_user`，前者不再读 query。
- 前端 `patchNetworkSecurity` 移除 `wx.request` / `wx.uploadFile` 的 `appendUserIdToUrl`；保留 `wx.connectSocket` 的 query 注入。

**Step 4: 全量回归**
```bash
pytest tests/ -v
# 手动：用微信开发者工具走一遍登录、聊天、发动态
```

**Step 5: Commit**
```bash
git commit -am "sec: stop accepting user_id from query string on HTTP endpoints"
```

---

## Task 3: CORS 与凭证模式修正

**Files:**
- Modify: `Wormhole_backend/app/main.py:40-46`
- Modify: `Wormhole_backend/app/config.py`

**Step 1: 在 config 增字段**
```python
ALLOWED_ORIGINS: str = "https://servicewechat.com"  # 逗号分隔
```

**Step 2: 改 main.py CORS**
```python
allowed = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed,
    allow_credentials=False,  # 小程序不携带 cookie
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "X-Auth-Token", "X-User-Id", "X-Openid", "Content-Type"],
)
```

**Step 3: 验证小程序仍可正常请求** — wx 不受 CORS 约束，PC web 调试时按需放白。

**Step 4: Commit** — `sec: tighten CORS to specific origins and methods`

---

## Task 4: 关键端点限流（slowapi）

**Files:**
- Create: `Wormhole_backend/app/utils/limiter.py`
- Modify: `Wormhole_backend/app/main.py`
- Modify: `Wormhole_backend/app/api/auth.py`、`upload.py`、`logs.py`、`space.py`（join-by-share）
- Modify: `Wormhole_backend/requirements.txt`（`slowapi==0.1.9`）

**Step 1: 写失败测试** — `tests/test_rate_limit.py`：连续 11 次调 `/api/auth/login` 第 11 次应得 429。

**Step 2: 实现**
```python
# app/utils/limiter.py
from slowapi import Limiter
from slowapi.util import get_remote_address
limiter = Limiter(key_func=get_remote_address)
```
```python
# main.py
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from app.utils.limiter import limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```
单点装饰：
- `/api/auth/login` → `@limiter.limit("10/minute")`
- `/api/upload` → `@limiter.limit("30/minute")`
- `/api/logs/track` → `@limiter.limit("60/minute")`
- `/api/space/join-by-share` → `@limiter.limit("10/minute")`

**Step 3: 运行测试 PASS**

**Step 4: Commit** — `sec: add slowapi rate limits on auth/upload/logs/share-join`

---

## Task 5: 自动锁屏默认 ON 回归测试（保留现行行为）

**Files:**
- Test: `Wormhole_miniapp/__tests__/auto_lock.spec.js`（如未配 jest，添加 `package.json` script + 安装 `jest`）

**Step 1-5:** 加最小 unit 测试覆盖 `getAutoLockOnHide()` 与 `getAutoLockSeconds()`，保证默认值不被误改；commit。若测试基建缺失，本任务降级为在 `app.js` 注释里加 `// SECURITY: do not change defaults` 并写到 README "安全策略" 段。

---

# Phase 2 — WebSocket 稳定性 + HTTP/WS 合并

## Task 6: 排查并修复"在线人数为 0"bug

**Hypothesis（按优先级）：**
1. **A:** wx onOpen 注册前服务端已 broadcast presence，客户端错过初始事件。
2. **B:** CDN 在 900s 时关闭连接但不发 close 帧，服务端 `await websocket.receive()` 阻塞，客户端 onClose 触发 → 重连，但旧连接被服务端视为活跃。
3. **C:** `register_user` 的 user_id 为空（鉴权头被 CDN 剥离）。

**Files:**
- Modify: `Wormhole_backend/app/main.py:96-99`（连接后单播 presence）
- Modify: `Wormhole_backend/app/ws.py`（增 `send_presence_to(ws)`）
- Modify: `Wormhole_backend/app/security.py` 增 WS 调试日志

**Step 1: 加诊断日志**
```python
# main.py websocket_endpoint
logger.info("WS_CONNECT space=%s user=%s headers=%s query=%s",
            space_id, ws_user_id, dict(websocket.headers), dict(websocket.query_params))
```

**Step 2: 修 A —— 单播初始 presence**
```python
# app/ws.py
async def send_presence_to(self, websocket: WebSocket, space_id: int):
    online = self.get_online_users(space_id)
    try:
        await websocket.send_json({
            "event": "presence",
            "online_user_ids": online,
            "online_count": len(online),
        })
    except Exception:
        pass
```
```python
# main.py 连接成功处
await chat_manager.connect(space_id, websocket)
chat_manager.register_user(space_id, websocket, ws_user_id)
await chat_manager.send_presence_to(websocket, space_id)  # 直接给本人
await chat_manager.broadcast_presence(space_id)            # 通知其他人
```

**Step 3: 验证**
```bash
# 1. 启动后端，开发者工具开 chat 页面
# 2. 看后端日志 WS_CONNECT
# 3. 观察 onlineCount 立即出现 ≥1
```

**Step 4: Commit** — `fix(ws): send initial presence directly to connecting socket`

---

## Task 7: 服务端 WS 心跳 + idle kick（解决 CDN 900s 断连）

**Files:**
- Modify: `Wormhole_backend/app/main.py:78-115`
- Modify: `Wormhole_backend/app/ws.py`（记录 last_seen）

**Step 1: 在 ChatStateManager 增 last_seen**
```python
self.last_seen: Dict[WebSocket, float] = {}
def touch(self, websocket): self.last_seen[websocket] = time.time()
```
`register_user` 与每次收到 packet 都调 `touch`。

**Step 2: 增服务端心跳任务**
```python
# main.py websocket_endpoint，accept 后启动 heartbeat task
async def _heartbeat():
    while True:
        await asyncio.sleep(60)
        try:
            await websocket.send_json({"event": "server_ping", "ts": int(time.time())})
        except Exception:
            return
hb_task = asyncio.create_task(_heartbeat())
```
finally 中：`hb_task.cancel()`。

**Step 3: idle kick** — 在心跳里检查 `time.time() - last_seen[websocket] > 180` → `await websocket.close(code=4408)`。

**Step 4: 客户端 onMessage 里忽略 `server_ping`**（chat.js handleWsEvent 已忽略未知 event，无需改）。

**Step 5: Commit** — `feat(ws): server heartbeat every 60s + 180s idle kick (CDN 900s safe)`

---

## Task 8: 客户端 WS 指数退避重连 + 状态机

**Files:**
- Modify: `Wormhole_miniapp/pages/chat/chat.js:262-352`（暂时局部改，后续 Task 21 拆模块）

**Step 1: 替换固定 3s 重连为指数退避**
```js
// 在 page data 增 _wsRetryCount = 0
const delay = Math.min(30000, 1000 * Math.pow(2, this._wsRetryCount || 0));
this._wsReconnectTimer = setTimeout(() => {
  this._wsRetryCount = (this._wsRetryCount || 0) + 1;
  this.initWebSocket({ force: true });
}, delay);
// onOpen 成功后：this._wsRetryCount = 0;
```

**Step 2: app `onShow` 立即触发重连尝试**（解决冷启动后的连接恢复）：
```js
// chat.js onShow
if (!this._wsReady && this._wsKeepAlive) this.initWebSocket({ force: true });
```

**Step 3: 增网络状态监听**
```js
// chat.js onLoad
this._netListener = (res) => {
  if (res.isConnected && !this._wsReady) this.initWebSocket({ force: true });
};
wx.onNetworkStatusChange(this._netListener);
// onUnload: wx.offNetworkStatusChange(this._netListener)
```

**Step 4: Commit** — `feat(ws): exponential backoff reconnect + net change recovery`

---

## Task 9: 抽 `chat_service.send_message`（DRY）

**Files:**
- Create: `Wormhole_backend/app/services/chat_service.py`
- Modify: `Wormhole_backend/app/api/chat.py:162-281`
- Modify: `Wormhole_backend/app/main.py:181-305`

**Step 1: 写测试** — `tests/test_chat_service.py::test_send_message_persists_and_broadcasts`，用 in-memory SQLite + mock chat_manager。

**Step 2: 提取**
```python
# app/services/chat_service.py
async def send_message(
    db, *, space_id, user_id, content, message_type, media_url,
    media_duration, reply_to_id, reply_to_user_id, reply_to_content,
    reply_to_type, live_cover_url=None, live_video_url=None,
    client_id=None, ip=None, user_agent=None,
) -> tuple[Message, dict]:
    """统一处理：校验 → 持久化 → 操作日志 → 推送 → 返回 (msg, payload)"""
    ...
```
HTTP 路由与 WS handler 都 `await send_message(...)` 然后调 `chat_manager.broadcast`。

**Step 3: 测试 PASS + 手动联调**

**Step 4: Commit** — `refactor(chat): extract chat_service.send_message used by HTTP and WS`

---

## Task 10: 弃用 HTTP `/api/chat/send`，改 WS-only

**Files:**
- Modify: `Wormhole_backend/app/api/chat.py:162` (mark deprecated, return 410 Gone)
- Modify: `Wormhole_miniapp/pages/chat/chat.js`（删除 fallback HTTP send）
- Modify: `Wormhole_backend/README.md`

**Step 1:** chat.py 的 send 改为
```python
@router.post("/send", deprecated=True)
async def send_message_deprecated():
    raise HTTPException(status_code=410, detail="Use WebSocket /ws/chat/{space_id}")
```

**Step 2:** 前端搜索所有 `BASE_URL}/api/chat/send` 调用并改成 WS 发送或排队（Task 26 outbox）。

**Step 3:** 删除 README 中的 HTTP send 行；新增 `WS protocol` 一节。

**Step 4: Commit** — `refactor(chat): retire HTTP /api/chat/send, WS is the SSOT`

---

## Task 11: 用 event_manager 推未读，移除 chat-badge 10s 轮询

**Files:**
- Modify: `Wormhole_backend/app/services/chat_service.py`（send_message 末尾推 event_manager）
- Modify: `Wormhole_miniapp/app.js:907-921`（删 startChatBadgeTimer）

**Step 1:** chat_service 内 broadcast 后另发到 event_manager：
```python
await event_manager.broadcast(space_id, {
    "event": "unread_inc",
    "from_user_id": user_id,
    "message_id": msg.id,
})
```

**Step 2:** 前端 `app.js` 增加全局 `event_manager` 客户端（独立 ws 连接到 `/ws/space/{space_id}`），收到 `unread_inc` 调 `bumpChatBadge`。**注意：当前 chat 页面也连接同一 space 的 event_manager 会导致两连接，先优化为只在非 chat 页有连接，进入 chat 页后切换。**

**Step 3:** 删 `startChatBadgeTimer / stopChatBadgeTimer / refreshChatBadge` 中 setInterval 部分。保留 `refreshChatBadge` 作为冷启动初始拉取的 HTTP fallback。

**Step 4: Commit** — `feat(badge): replace 10s polling with WS push via event_manager`

---

# Phase 3 — 后端架构与代码质量

## Task 12: 迁移到 FastAPI lifespan

**Files:** `app/main.py`

```python
from contextlib import asynccontextmanager
@asynccontextmanager
async def lifespan(app):
    assert_jwt_secret_configured()
    await create_tables()
    try:
        from fastapi.staticfiles import StaticFiles
        app.mount("/static", StaticFiles(directory="static"), name="static")
    except Exception as e:
        logger.error("static mount failed: %s", e)
    yield

app = FastAPI(title="虫洞私密共享空间", lifespan=lifespan)
```
删 `@app.on_event("startup")`。

Commit: `chore: migrate to FastAPI lifespan`

---

## Task 13: `operation_log` 异步化

**Files:**
- Modify: `Wormhole_backend/app/utils/operation_log.py`
- Modify: 所有调用方（grep `add_operation_log`）

**Step 1:** 改为基于 `asyncio.Queue` 的后台 writer：
```python
# app/services/log_service.py
_queue: asyncio.Queue = asyncio.Queue(maxsize=10000)
async def enqueue_log(**kwargs): _queue.put_nowait(kwargs)
async def log_worker():
    while True:
        batch = [await _queue.get()]
        try:
            while len(batch) < 100:
                batch.append(_queue.get_nowait())
        except asyncio.QueueEmpty:
            pass
        async with AsyncSessionLocal() as s:
            s.add_all([OperationLog(**k) for k in batch])
            await s.commit()
```
lifespan 中 `asyncio.create_task(log_worker())`。

**Step 2:** 所有 `add_operation_log(db, ...)` 改 `enqueue_log(...)`，移除 `await db.commit()` 因不再持有同 session。

**Step 3:** 加索引 `(space_id, created_at)` 与 `(action, created_at)`（新建 migration）。

Commit: `perf(logs): batch operation_log via async queue, off the request path`

---

## Task 14: 拆 `main.py`（WS endpoints 出文件）

**Files:**
- Create: `Wormhole_backend/app/api/ws/chat.py`
- Create: `Wormhole_backend/app/api/ws/space_events.py`
- Modify: `Wormhole_backend/app/main.py`（仅保留 router 注册 + lifespan）

**Step 1:** 把 `websocket_endpoint`（chat）整个搬到 `app/api/ws/chat.py`，导出 `router`，main.py 注册 `app.include_router(ws_chat.router)`（FastAPI WS 也走 router）。

**Step 2:** 同理搬 `websocket_space_events`。

**Step 3:** 验证 `wscat -c ws://...` 通。

Commit: `refactor: move WS endpoints out of main.py`

---

## Task 15: 拆 `settings.py` (654 行) 与 `feed.py` (526 行)

**约定：** 单文件 > 400 行触发拆分。按业务子域：

`feed.py` →
- `app/api/feed/posts.py`（CRUD）
- `app/api/feed/comments.py`
- `app/api/feed/likes.py`
- `app/api/feed/__init__.py`（聚合 router）

`settings.py` →
- `app/api/settings/space.py`（空间设置）
- `app/api/settings/member.py`（成员/黑名单）
- `app/api/settings/system.py`（review_mode 等系统开关）
- `app/api/settings/preferences.py`（主题、自动锁）

每拆完一个子文件单独 commit，message: `refactor(feed): split posts/comments/likes`。

---

## Task 16: 关键索引

**Files:** `Wormhole_backend/models/*.py`（增 `Index`）+ 新建迁移脚本

```python
# models/chat.py
__table_args__ = (
    Index("ix_messages_space_id_id", "space_id", "id"),
    Index("ix_messages_space_deleted", "space_id", "deleted_at"),
)
```
对应 `posts`, `feed_comments`, `feed_likes` 也加。

迁移：写一段 raw SQL 进 `app/migrations.py`：
```python
CREATE INDEX IF NOT EXISTS ix_messages_space_id_id ON messages(space_id, id);
...
```

Commit: `perf: add composite indexes for hot read paths`

---

## Task 17: `/healthz` + 结构化日志

**Files:** `app/main.py`, `app/utils/logging.py`（新）

```python
# /healthz
@app.get("/healthz")
async def healthz():
    return {"ok": True, "ts": int(time.time())}
```
日志改 `logging.config.dictConfig`，输出 JSON（structlog 可选）。

Commit: `chore: add /healthz and JSON logging`

---

## Task 18: 引入 Alembic

**Files:**
- `Wormhole_backend/alembic.ini`
- `Wormhole_backend/alembic/env.py`
- `Wormhole_backend/alembic/versions/0001_baseline.py`

**Step 1:** `alembic init alembic`，配置 `target_metadata = Base.metadata`，sqlalchemy.url 从 settings 读。

**Step 2:** baseline 迁移：以当前 schema 为起点，stamp 到 head；现有 `app/migrations.py` 改为只做"启动时执行未跑过的 alembic upgrade head"。

**Step 3:** 测试 `alembic upgrade head` 在空库与现有库都正常。

Commit: `chore: introduce alembic for schema migrations`

---

## Task 19: 最小测试套件 + CI

**Files:**
- `Wormhole_backend/tests/conftest.py`（in-memory sqlite + httpx AsyncClient）
- `.github/workflows/test.yml`

最少 5 个端到端测试：登录、入空间、发文本消息（WS）、发动态、点赞。

Commit: `test: minimal pytest suite + GH Actions CI`

---

# Phase 4 — 前端架构与代码质量

## Task 20: 拆 `app.js`（948 行）

**目标分模块（`Wormhole_miniapp/utils/`）：**
- `auth.js` — `ensureOpenId / getAuthHeaders / patchNetworkSecurity`
- `theme.js` — 全套主题逻辑（THEME_PRESETS, applyThemePreference, applyThemeForRoute）
- `badge.js` — `refreshNotesBadge / refreshChatBadge / setChatBadgeCount / bumpChatBadge`
- `lock.js` — 自动锁 + foreground hold + inactivity timer
- `activity.js` — page wrapper（recordUserActivity / Page hijack）
- `app-logger.js` — `logOperation / logPageView`
- `app.js` 仅做 `App({})` 与模块装配

每模块 commit 一次：`refactor(app): extract <module> from app.js`。

完成后 `app.js` 应 < 200 行。

---

## Task 21: 拆 `pages/chat/chat.js`（2193 行）

**目标分文件（`Wormhole_miniapp/pages/chat/`）：**
- `chat.js` — Page 装配、data 定义、生命周期（< 400 行）
- `chat-ws.js` — WebSocket 状态机（initWebSocket、心跳、重连、handleWsEvent、sendWsEvent）
- `chat-voice.js` — 录音、按住说话、播放、波形
- `chat-sticker.js` — 贴纸面板与发送
- `chat-reply.js` — 回复气泡、引用渲染
- `chat-list.js` — 列表渲染、滚动、虚拟化、未读分隔线
- `chat-input.js` — 输入框、@、表情、长文限制

**Step 1:** 在 chat.js 顶部 `const wsModule = require('./chat-ws.js')`，模块导出函数 `wsModule.bind(pageInstance)` 把方法注入 page。

**Step 2:** 一次拆一个模块 + commit + 在微信开发者工具回归。

Commit pattern: `refactor(chat): extract chat-ws into its own module`

---

## Task 22: openid/accessToken 内存缓存

**Files:** `utils/auth.js`

```js
let _openid = '';
let _accessToken = '';
function getOpenIdSync() { return _openid || wx.getStorageSync('openid') || ''; }
function setAuthFromLogin(openid, token) {
  _openid = openid; _accessToken = token;
  wx.setStorageSync('openid', openid);
  wx.setStorageSync('accessToken', token);
}
```
`patchNetworkSecurity` 用内存读，避免每次同步 IO。

Commit: `perf(app): cache openid/token in memory`

---

## Task 23: typing / logOperation 节流与批量

**Files:** `pages/chat/chat-input.js`、`utils/app-logger.js`

**Step 1:** typing 节流：
```js
this._typingThrottle = throttle((typing) => this.sendWsEvent({event:'typing', typing}), 800);
```

**Step 2:** logOperation 批量：
```js
const queue = [];
let timer = null;
function logOperation(p) {
  queue.push({...p, ts: Date.now()});
  if (!timer) timer = setTimeout(flush, 5000);
  if (queue.length >= 20) flush();
}
function flush() {
  const batch = queue.splice(0);
  timer = null;
  if (!batch.length) return;
  wx.request({url: `${BASE_URL}/api/logs/track-batch`, method:'POST', data:{events: batch}});
}
```
后端新增 `/api/logs/track-batch` 接收 `events[]` 一次入队列。

Commit: `perf(logs): throttle typing and batch client log events`

---

## Task 24: 删 discover 旧页面

**Files:**
- Delete: `Wormhole_miniapp/pages/discover/`（确认已被 explore 替代且无引用）
- Modify: `app.json`、`app.js`（`SPACE_ROUTES / CUSTOM_NAV_ROUTES / TAB_ROUTES`）

**Step 1:** `grep -r "pages/discover" Wormhole_miniapp` 确认无残留引用。

**Step 2:** 删除目录 + 更新 app.json `pages` 列表。

**Step 3:** 微信开发者工具构建无 warning。

Commit: `chore: remove deprecated discover page in favor of explore`

---

## Task 25: 暗色模式资源 SVG 化（可选，若小程序 svg 限制大可跳过）

**Files:** `Wormhole_miniapp/assets/icons/`、`pages/chat/chat.wxml` 等

将 light/dark 双份 png 改为单 svg + `mask-image`/CSS filter。**风险：** 微信小程序 `<image>` 对 svg 支持有限，建议改用 iconfont 字体方案：
- 引入 iconfont（unicode 或 class），`color` 直接跟主题切换。

如果重构成本高，本任务降级为"将 chat/feed/notebook/settings 4 套图标整合为 4 个双色 png 而非 8 个单色 png"。

Commit: `chore(theme): consolidate icon assets`

---

# Phase 5 — 功能增强

## Task 26: 离线消息 outbox

**Files:**
- Create: `Wormhole_miniapp/utils/chat-outbox.js`
- Modify: `pages/chat/chat-input.js`

**逻辑：**
- 用户发送 → 即写本地 outbox（`wx.setStorageSync('chat_outbox_<spaceId>', [...])`）+ 设消息状态 `sending`
- WS 已连接 → 立即 send；WS 未连接 → 留存
- WS 重连 onOpen → 遍历 outbox 重发
- 收到对应 `client_id` 的回执 → 从 outbox 移除并改状态 `sent`
- 失败 N 次 → 状态 `failed`，UI 显示重试按钮

UI：消息气泡角落小圈圈/对勾/叹号（`status` 字段）。

Commit: `feat(chat): offline outbox with auto-resend on reconnect`

---

## Task 27: 消息编辑

**Files:**
- Migration: 新增 `messages.edited_at`, `messages.edit_history`(JSON Text)
- `app/services/chat_service.py::edit_message`
- `app/api/ws/chat.py`（接收 `event: 'edit'` 事件）
- `pages/chat/chat-input.js` + 长按菜单

权限：仅本人 5 分钟内可编辑（房主可配置）。

Commit: `feat(chat): message edit with 5min window`

---

## Task 28: 消息 reactions（表情回应）

**Files:**
- Migration: 新表 `message_reactions(message_id, user_id, emoji, created_at)`，唯一约束 `(message_id, user_id, emoji)`
- `app/api/feed/...` not applicable; 用 `app/api/chat/reactions.py`
- WS event：`reaction_add`, `reaction_remove`
- `pages/chat/chat-list.js` 长按消息出 emoji bar（6 个常用 emoji + "更多"）

Commit: `feat(chat): emoji reactions on messages`

---

## Task 29: @ 提及

**Files:**
- `pages/chat/chat-input.js` 输入 `@` 触发成员浮层
- 服务端 `messages.mentions` JSON 字段（user_id 数组）
- `notify_dispatcher` 对被提及成员强推

Commit: `feat(chat): @ mentions with directed notification`

---

## Task 30: 全局搜索（SQLite FTS5）

**Files:**
- Migration: 创建 `messages_fts` 虚表 + 触发器
- `app/api/search.py`：`/api/search/messages?space_id=&q=`
- 新增 `pages/search/search.{js,wxml,wxss}`

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(content, content_rowid='id');
CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
-- 类似 update/delete trigger
```

Commit: `feat(search): full-text search via SQLite FTS5`

---

## Task 31: 评论楼中楼

**Files:**
- Migration: `feed_comments.parent_id` 字段
- `app/api/feed/comments.py` 增树形查询（限 2 级）
- `pages/notes-activity/notes-activity.js` 渲染嵌套

Commit: `feat(feed): nested replies in feed comments`

---

## Task 32: 多端读未读改进

**Files:**
- Migration: `chat_reads(space_id, user_id, device_id, last_read_message_id)`，主键 `(space_id, user_id, device_id)`
- WS read 事件携带 `device_id`（小程序 `wx.getStorageSync('device_id')`，无则生成 uuid 持久化）
- 未读 = `min(last_read_message_id over devices)`，避免一端读完别端清零

Commit: `feat(chat): per-device read tracking`

---

## Task 33: 订阅消息引导优化

**Files:** `pages/chat/chat.js`、`pages/post-create/post-create.js`

首次发消息/发动态时调 `wx.requestSubscribeMessage`，被订阅模板 ID 在 settings 配置。

Commit: `feat(notify): proactive subscription request on first send`

---

## Task 34: Vault 安全审计与加固

**Files:** 阅读 `Wormhole_miniapp/utils/vaultCrypto.js` 全文 + `app/api/vault.py`

**审计清单：**
1. 密钥派生：PBKDF2 迭代次数 ≥ 100k？salt 唯一？
2. 加密算法：AES-GCM（带认证标签）还是 CBC？
3. IV 复用：每次新随机 IV？
4. 错误密码限速：N 次错误锁定 M 分钟？
5. 备份提示：用户更换密码时旧文件如何处理？
6. 服务端 vault 字段是否对其他成员可见？

输出 `docs/audits/2026-05-vault.md`，按发现项再开 commit 修复。

Commit: `audit(vault): document findings and fix critical issues`

---

## Task 35: 防误触首页空间号确认

**Files:** `Wormhole_miniapp/pages/index/index.js`

输入第 6 位后 200ms debounce + 显示二次确认（"进入空间 123456 ?"），防止粘贴误进。

Commit: `feat(index): debounce + confirm before entering space`

---

# 完成标准

- [ ] 所有 Task 通过对应测试或回归
- [ ] `wc -l` 检查：`app.js < 200`、`chat.js < 400`、`main.py < 100`、`feed.py / settings.py / chat.py < 400`
- [ ] 后端 `pytest` 通过；CI 配置可在 push 时跑测试
- [ ] 微信开发者工具走完关键路径：登录、进入空间、聊天（含语音/图片/回复/编辑/reaction/@）、发动态、评论、搜索、vault、退出
- [ ] WS 在弱网/CDN 重启场景下能自动恢复，online_count 始终准确
- [ ] 启动时无 `AUTH_JWT_SECRET` 缺失即崩溃（生产模式）
- [ ] 操作日志写入不阻塞请求

# 回滚策略

每个 Phase 都从 main 切独立分支：
- `phase-1-security`
- `phase-2-ws`
- `phase-3-backend-arch`
- `phase-4-frontend-arch`
- `phase-5-features`

各分支单独 PR，merge 前先在测试环境跑 24h。出现严重 regression 直接 revert PR。
