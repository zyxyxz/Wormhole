# 未读状态机设计 — 2026-05-07

## 问题

1. 聊天红点回弹：进 chat → 清 → 切走 → 红点重新出现。
   根因：Task 32 把 chat 未读改成 `MIN(ChatRead.last_read_message_id) over devices`，
   旧设备 ID 永远拖后退，红点几乎清不掉。
2. 动态未读没有 WS 推送，时延差。
3. 动态用户希望看到带计数徽标。

## 决策

- **多设备语义：全局已读 (MAX)** — 一台读完所有设备都消。
- **动态徽标：带计数**，最大显示 `99+`。
- **进聊天页就清** — onShow 无条件 markReadLatest，不再依赖 isAtBottom。

## 实现

### 后端

| 改动 | 文件 |
|---|---|
| 新增 `space_members.last_read_post_id INTEGER DEFAULT 0`，迁移时 backfill 为该空间当前 max(post.id) | `models/space.py`, `app/migrations.py` |
| `/api/chat/unread-count` 改读 `SpaceMember.last_read_message_id`（已 MAX over devices），不再 `MIN(ChatRead)` | `app/api/chat.py` |
| `/api/feed/unread-count` 重写为 `count(posts where id > last_read_post_id and user_id != me)` | `app/api/feed/posts.py` |
| 新 `POST /api/feed/mark-read` 更新 `last_read_post_id = MAX(current, given)` | 同上 |
| `POST /api/feed/create` 完成后 `event_manager.broadcast(feed_unread_inc)` | 同上 |

### 前端

| 改动 | 文件 |
|---|---|
| `bumpNotesBadge / setNotesBadgeCount` 与 chat 对称 | `utils/badge.js` |
| `markNotesRead` 改成同时 POST `/api/feed/mark-read` | 同上 |
| `refreshNotesBadge` 不再用 `since_ts`；用 `/unread-count` 单参 | 同上 |
| `space-events.js` 处理 `feed_unread_inc`（在 notes/explore 页 → 自动 mark-read，否则 bump） | `utils/space-events.js` |
| `chat.js onShow` 无条件 `markReadLatest()` | `pages/chat/chat.js` |
| `notes.js` 进页拿 latest post id 调 `app.markNotesRead(spaceId, latestId)` | `pages/notes/notes.js` |

### 兼容 / 风险

- `ChatRead` 表保留写入（Task 32），只是 unread-count 不读它；零改动客户端发 `read` 事件那条路径。
- 迁移 backfill 让现存 SpaceMember 的 `last_read_post_id = max(post.id)`，避免首次部署红点显示全部为新。
- 旧客户端的 `notes_last_seen_<spaceId>` storage 保留（不会被读，无副作用）。
