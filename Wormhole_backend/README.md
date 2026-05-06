# 虫洞私密共享空间

一个基于FastAPI开发的私密共享空间后端服务，支持聊天、笔记、钱包等功能。

## 功能特点

- 🔒 私密空间：通过6位数字空间号进入专属空间
- 💬 即时聊天：支持空间内的即时消息交流
- 📝 共享笔记：支持创建和编辑共享笔记
- 💰 共享钱包：支持余额查看、充值和支付
- ⚙️ 空间设置：支持修改空间号、分享空间和删除空间

## 技术栈

- 后端框架：FastAPI
- 数据库：SQLite
- 对象存储：阿里云OSS
- API文档：Swagger UI

## 聊天消息接口

聊天消息发送统一走 WebSocket `/ws/chat/{space_id}`。HTTP `POST /api/chat/send` 自 Task 10 起返回 410 Gone（在 OpenAPI 中保留为 `deprecated`），客户端必须改用 WS。详见根目录 README 的「WebSocket 协议」一节。

## 快速开始

1. 克隆项目 
