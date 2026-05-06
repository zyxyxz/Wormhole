# Wormhole（虫洞私密共享空间）

一个“私密共享空间”全栈项目，前端为微信小程序，后端基于 FastAPI + SQLite。支持房间号进入共享空间，并提供聊天、动态（图文/视频+评论，前身为“笔记”）、钱包与设置（成员/黑名单/房主）等功能。整体 UI 采用浅色系蓝绿色（青绿/水色）现代科技风，包含骨架屏、空态等通用组件。

## 功能速览
- 房间与进入
  - 6 位空间号可直接进入；空间不存在时自动创建
  - 分享口令 + 自定义 6 位码加入同一共享空间（多码指向同一真实空间），分享码 5 分钟有效且仅可使用一次
  - 首位进入者自动成为房主
- 聊天
  - WebSocket 实时聊天（带作者 alias），HTTP 历史加载
  - 支持文本 / 图片 / 语音消息，语音支持按住说话、点击播放
- 动态（原“笔记”页重构）
  - 发布文本/图片/视频，支持评论
  - 图片点击预览、作者/房主可软删除动态、点赞互动（单人单赞）
  - 列表为卡片流（支持骨架/空态）
- 钱包
  - 余额展示、充值、交易记录（带作者 alias）
- 设置
  - 修改空间号、删除空间（仅房主）
  - 分享空间（仅房主，生成8位口令）
  - 房主成员管理（移除/拉黑/取消拉黑），黑名单禁止再次进入
  - 房间内别名与头像设置

## 代码结构
- `Wormhole_miniapp/` 微信小程序前端
  - `pages/` 聊天、动态、钱包、设置、发布动态、充值、口令加入等
  - `components/` 空态、骨架屏、（保留）导航栏组件
  - `styles/` 主题样式（浅色青绿科技风）
  - `utils/config.js` 配置基础 API/WS 地址
- `Wormhole_backend/` FastAPI 后端
  - `app/` 应用、路由、配置、数据库
  - `models/` SQLAlchemy 模型（spaces/aliases/members/blocks/chat/notes/feed/wallet 等）
  - `schemas/` Pydantic 模型
  - `scripts/reset_db.py` 重建数据库脚本
  - `wormhole.db`（已被 .gitignore 忽略）

## 启动与开发

### 后端（FastAPI）
1. 进入目录并安装依赖
   ```bash
   cd Wormhole_backend
   pip install -r requirements.txt
   ```
2. 可选：配置微信登录（小程序登录换 openid）
   - 新建 `.env`（已被忽略，不会提交）：
     ```env
     WECHAT_APP_ID=your_appid
     WECHAT_APP_SECRET=your_app_secret
     ```
   - 未配置时，将使用开发模式 `dev_{code}` 作为 openid
3. 重建数据库（会删除旧的 `wormhole.db` 并重建全部表）
   ```bash
   python scripts/reset_db.py
   ```
4. 启动服务
   - 方式A（推荐，读取 .env 中 HOST/PORT）
     ```bash
     python scripts/run.py
     ```
   - 方式B（手动指定）
     ```bash
     uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
     ```
   - .env 支持：
     ```env
     HOST=0.0.0.0
     PORT=8000
     ```
   - 上传存储：阿里云 OSS（/api/upload 返回 OSS 链接）
   - 主要 API 前缀：`/api/*`（space/chat/notes/feed/wallet/settings/user/auth/upload）
   - 每次启动会自动执行 `app/migrations.py` 中的轻量数据库迁移（含 `posts.deleted_at` 等升级），云端拉取最新代码并重启即可完成 Schema 更新

### 前端（微信小程序）
1. 使用微信开发者工具打开 `Wormhole_miniapp` 目录
2. 根据实际后端地址修改：`Wormhole_miniapp/utils/config.js`
   ```js
   const BASE_URL = 'http://127.0.0.1:8000';
   const WS_URL = 'ws://127.0.0.1:8000';
   ```
3. 运行项目，首页输入 6 位空间号即可进入（自动进入，无需按钮）

## 重要说明
- 版本控制已忽略：
  - 数据库：`Wormhole_backend/wormhole.db`
  - 上传文件：`Wormhole_backend/static/uploads/`
  - 私密变量：`Wormhole_backend/.env`
  - Python 缓存与系统杂项：`__pycache__/`、`.DS_Store` 等
- 若需要生产级数据库迁移，建议引入 Alembic；当前开发流程使用一次性重建脚本。

## 安全策略

- **自动锁屏（默认 ON）**：应用进入后台后，默认会锁定（`autoLockOnHide=true`）。后台不活跃 1 小时（`autoLockSeconds=3600`）后会强制重新进入空间号。这两个默认值是为了保护隐私 —— **修改默认值之前必须经过安全评审**。相关代码：`Wormhole_miniapp/app.js` 的 `getAutoLockOnHide()`、`getAutoLockSeconds()`、`globalData.autoLockSeconds`。
- **JWT 密钥**：生产环境必须设置 `AUTH_JWT_SECRET`（≥ 32 字符），未设置时启动会失败。`WECHAT_APP_SECRET` 仅用于微信登录，**不参与** JWT 签名。
- **HTTP 鉴权**：HTTP 路由仅接受 `Authorization: Bearer <jwt>`、`X-Auth-Token`、`X-User-Id`、`X-Openid` 这四个 header；URL query 中的 `user_id` / `token` 在 HTTP 上不被信任。WebSocket 因 CDN 限制保留 query 回退。
- **CORS**：生产环境通过 `ALLOWED_ORIGINS`（逗号分隔）显式列出可信来源；通配符 `*` 已禁用。
- **限流**：登录、上传、日志上报、空间口令加入均有 IP 级速率限制（slowapi）。

## 主要接口速查
- 空间/分享
  - `POST /api/space/enter`（space_code, user_id）
  - `POST /api/space/share`（space_id, operator_user_id，仅房主）
  - `POST /api/space/join-by-share`（share_code, new_code, user_id；新空间号若已被自己使用需先删除）
  - `GET /api/space/info?space_id`、`GET /api/space/members?space_id`、`GET /api/space/blocks?space_id`
  - `POST /api/space/remove-member|block-member|unblock-member|delete`
- 聊天
  - `GET /api/chat/history?space_id`
  - `WS /ws/chat/{space_id}` —— 消息发送统一走 WS（Task 10 起，HTTP `POST /api/chat/send` 返回 410 Gone）
  - 详见下文 [WebSocket 协议](#websocket-协议)
- 动态（feed）
  - `POST /api/feed/create`（space_id, user_id, content, media_type, media_urls[]）
  - `GET /api/feed/list?space_id&user_id`（user_id 可选，返回 liked_by_me 与点赞头像列表）
  - `POST /api/feed/comment`、`GET /api/feed/comments?post_id`
  - `POST /api/feed/comment/delete`（comment_id, operator_user_id）
  - `POST /api/feed/delete`（post_id, operator_user_id；作者或房主）
  - `POST /api/feed/like`（post_id, user_id, like=true/false）
  - `POST /api/upload`（OSS 上传）
- 钱包
  - `GET /api/wallet/info|transactions?space_id`
  - `POST /api/wallet/recharge|pay`（space_id, amount, user_id）
- 用户/认证
  - `POST /api/auth/login`（小程序 code 换 openid；开发模式返回 dev_openid）
  - `GET /api/user/alias`、`POST /api/user/set-alias`（alias + avatar_url 可选）

## WebSocket 协议

聊天消息发送统一走 WebSocket `/ws/chat/{space_id}`，HTTP `POST /api/chat/send` 自 Task 10 起返回 410 Gone（保留在 OpenAPI 中标记 `deprecated`，不再处理业务）。

**鉴权**：URL query `?user_id=<openid>`（CDN 会剥离 WS 自定义 header，因此走 query；HTTP 路由仍然要求 Bearer/Header 鉴权，参见上文“安全策略”）。

**客户端发送格式**（`event` 字段缺省/为空时视为聊天消息）：
```json
{
  "message_type": "text",
  "content": "hello",
  "media_url": null,
  "media_duration": null,
  "reply_to_id": null,
  "reply_to_user_id": null,
  "reply_to_content": null,
  "reply_to_type": null,
  "live_cover_url": null,
  "live_video_url": null,
  "client_id": "uuid"
}
```

服务端持久化后会向房间广播一条带 `id` 的完整 `MessageResponse`，客户端通过 `client_id` 把乐观 UI 的“pending”消息升级为已确认状态。

**服务端事件**（`event` 字段非空时为系统事件）：
- `presence`：`{event: "presence", online_user_ids, online_count}` —— 在线列表与人数（连接 / 断开时各推一次）
- `typing`：`{event: "typing", user_id, typing}` —— 正在输入指示
- `read_update`：`{event: "read_update", user_id, last_read_message_id}` —— 已读位点变化
- `message_deleted`：`{event: "message_deleted", message_id}` —— 消息被作者或房主删除
- `server_ping`：`{event: "server_ping", ts}` —— 服务端心跳，客户端忽略即可
- `pong`：客户端 `ping` 后的回包

**心跳与超时**：服务端每 60 秒推一次 `server_ping`；客户端不活跃超过 180 秒会被服务端 `close(4408)`（CDN 900s 安全阈值内）。客户端断开后按指数退避（1s, 2s, 4s … 最多 30s）重连，并监听网络状态恢复时立刻重连。

**离线发送**：当 WS 未就绪时，客户端会把消息排入内存队列，下次 `onOpen` 时 flush。Task 26 将把该队列升级为跨页面重启持久化的 outbox。

## 许可
本项目未附加开源许可协议，默认保留所有权利。如需开放许可或选择具体 License，可在 README 中更新并添加 LICENSE 文件。
