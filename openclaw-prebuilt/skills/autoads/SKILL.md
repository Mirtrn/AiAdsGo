---
name: autoads
description: 通过 AutoAds OpenClaw API 执行广告运营动作（严格遵循 canonical 路由，禁止猜测端点）。
---

# AutoAds（Canonical + Queue）

## 核心规则（必须遵守）

1. 写操作（`POST`/`PUT`/`PATCH`/`DELETE`）只走 `/api/openclaw/commands/execute`。
2. 读操作（`GET`）只走 `/api/openclaw/proxy`。
3. 不猜测 API 路径；出现路由错误时，立即回到下面的 canonical 路由表。
4. 如果响应包含 `canonical web flow` 或 `410`，说明走了错误/下线路径，必须改用 canonical 路径。

## 认证

- 使用 `Authorization: Bearer <OPENCLAW_USER_TOKEN>`。
- Token 获取路径：`OpenClaw -> 配置中心 -> OpenClaw Access Tokens -> 生成新 Token`。

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

## 标准调用模板

### 读操作模板（proxy）

```bash
curl -sS "$AUTOADS_HOST/api/openclaw/proxy" \
  -H "Authorization: Bearer $OPENCLAW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "GET",
    "path": "/api/offers"
  }'
```

### 写操作模板（execute）

```bash
curl -sS "$AUTOADS_HOST/api/openclaw/commands/execute" \
  -H "Authorization: Bearer $OPENCLAW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "POST",
    "path": "/api/offers/extract",
    "intent": "offer.create",
    "idempotencyKey": "offer-extract-<unique>",
    "body": {
      "affiliate_link": "https://example.com/aff-link",
      "target_country": "US"
    }
  }'
```

### 高风险确认模板（confirm）

```bash
curl -sS "$AUTOADS_HOST/api/openclaw/commands/confirm" \
  -H "Authorization: Bearer $OPENCLAW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "runId": "<RUN_ID>",
    "confirmToken": "<CONFIRM_TOKEN>",
    "decision": "confirm"
  }'
```
