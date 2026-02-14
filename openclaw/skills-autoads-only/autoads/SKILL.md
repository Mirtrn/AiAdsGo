---
name: autoads
description: 通过 AutoAds OpenClaw API 执行广告运营动作（严格遵循 canonical 路由与队列确认链路，禁止猜测端点或走公网回退）。
metadata: { "openclaw": { "emoji": "🧭" } }
---

# AutoAds（Canonical + Queue）

## 核心规则（必须遵守）

1. 写操作（`POST`/`PUT`/`PATCH`/`DELETE`）只走 `/api/openclaw/commands/execute`。
2. 读操作（`GET`）只走 `/api/openclaw/proxy`。
3. 不猜测 API 路径；出现路由错误时，立即回到下面的 canonical 路由表。
4. 如果响应包含 `canonical web flow` 或 `410`，说明走了错误/下线路径，必须改用 canonical 路径。
5. OpenClaw 与 AutoAds 同容器部署时，业务 API 只能走内网地址：`INTERNAL_APP_URL` 或 `http://127.0.0.1:${PORT:-3000}`。
6. `127.0.0.1:18789` 是 OpenClaw Gateway 端口，不是 AutoAds 业务 API 基址。
7. 内网可达时禁止回退公网域名，避免 Cloudflare 拦截与鉴权错配。
8. 允许通过 shell/curl 仅调用 /api/openclaw/proxy、/api/openclaw/commands/execute、/api/openclaw/commands/confirm；禁止直连 /api/offers/*、/api/campaigns/*、/api/click-farm/* 等业务路由。
9. 飞书绑定场景禁止向用户索要 token；默认使用 OPENCLAW_GATEWAY_TOKEN 调用 /api/openclaw/*，若 401 先补齐 channel/senderId/accountId/tenantKey 后重试一次。

## 认证与 Token 类型

- `/api/openclaw/*` 请求统一使用 `Authorization: Bearer <token>`。
- `OPENCLAW_GATEWAY_TOKEN` 仅用于 Gateway 入口鉴权，不可直接拿去请求 `/api/offers/*`、`/api/campaigns/*` 等业务路由。
- 业务路由必须通过 `/api/openclaw/proxy` 或 `/api/openclaw/commands/execute` 以用户身份转发执行。
- 飞书场景下必须透传绑定元信息（header 或 body 均可）：`channel`、`senderId`、`accountId`、`tenantKey`。

## Canonical 路由速查（高频）

- 创建 Offer：
  - `POST /api/offers/extract`
  - `POST /api/offers/extract/stream`
- 查询提取任务：
  - `GET /api/offers/extract/status/:taskId`
- 重建 Offer：
  - `POST /api/offers/:id/rebuild`
- 生成创意（仅 A/B/D）：
  - `POST /api/offers/:id/generate-creatives-queue`（`body.bucket` 仅 `A`/`B`/`D`）
- 查询创意任务：
  - `GET /api/creative-tasks/:taskId`
- 查询 Offer 创意列表：
  - `GET /api/offers/:id/creatives`
- 发布广告：
  - `POST /api/campaigns/publish`
- 创建补点击任务：
  - `POST /api/click-farm/tasks`
- 查询命令执行记录：
  - `GET /api/openclaw/commands/runs`

## 禁止使用的常见旧路径

- `POST /api/offers`（已下线）
- `POST /api/offers/:id/generate-ad-creative`（同步旧链路，OpenClaw 禁止）
- `POST /api/offers/:id/generate-creatives`（旧链路，OpenClaw 禁止）
- `POST /api/ad-creatives`（旧链路，OpenClaw 禁止）

## 队列化写操作流程

1. 可选预解析：`POST /api/openclaw/commands/parse`。
2. 提交执行：`POST /api/openclaw/commands/execute`，至少携带：`method`、`path`、`body`、`intent`、`idempotencyKey`。
3. 处理状态：`queued` / `pending_confirm` / `duplicate`。
4. 若 `pending_confirm`：调用 `POST /api/openclaw/commands/confirm`（`runId` + `confirmToken` + `decision`）。
5. 追踪记录：`GET /api/openclaw/commands/runs`。
6. `execute`/`confirm` 返回的 `taskId` 是命令队列任务 ID（`queueTaskId`），不是业务任务 ID；禁止直接用于 `/api/offers/extract/status/:taskId`。

## 标准调用模板

### 读操作模板（proxy）

```bash
curl -sS "$AUTOADS_HOST/api/openclaw/proxy" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "GET",
    "path": "/api/offers"
  }'
```

### 写操作模板（execute）

```bash
curl -sS "$AUTOADS_HOST/api/openclaw/commands/execute" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "POST",
    "path": "/api/offers/extract",
    "intent": "offer.create",
    "idempotencyKey": "offer-extract-<unique>",
    "channel": "feishu",
    "senderId": "<sender_open_id>",
    "accountId": "<account_id>",
    "tenantKey": "<tenant_key>",
    "body": {
      "affiliate_link": "https://example.com/aff-link",
      "target_country": "US"
    }
  }'
```

### 高风险确认模板（confirm）

```bash
curl -sS "$AUTOADS_HOST/api/openclaw/commands/confirm" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "runId": "<RUN_ID>",
    "confirmToken": "<CONFIRM_TOKEN>",
    "decision": "confirm",
    "channel": "feishu",
    "senderId": "<sender_open_id>",
    "accountId": "<account_id>",
    "tenantKey": "<tenant_key>"
  }'
```
