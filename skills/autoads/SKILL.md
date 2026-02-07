---
name: autoads
description: 通过 AutoAds OpenClaw API 执行广告运营动作。适用于飞书/聊天中要求创建、修改、发布、暂停、下线、批量操作、复盘查询等场景。写操作优先使用队列化命令链路 `/api/openclaw/commands/execute`（必要时 `/api/openclaw/commands/confirm`），只读查询使用 `/api/openclaw/proxy`。
---

# AutoAds（Queue-Aware）

将 AutoAds 操作分成两类：

1. **写操作（默认走队列）**
   - 方法为 `POST`/`PUT`/`PATCH`/`DELETE`。
   - 路径涉及 `publish`、`pause`、`offline`、`delete`、`batch`、`bulk` 等高风险词。
   - 统一走 `/api/openclaw/commands/execute`。
2. **读操作（直连代理）**
   - 方法为 `GET` 且无副作用。
   - 走 `/api/openclaw/proxy`。

## 认证

- 使用 `Authorization: Bearer <token>`。
- 若由飞书通道触发，优先透传：
  - `x-openclaw-channel`
  - `x-openclaw-sender`
  - `x-openclaw-account-id`
  - `x-openclaw-tenant-key`

## 队列化写操作流程

### 1) 可选预解析

先调用 `/api/openclaw/commands/parse` 获取风险等级与是否需要确认。

### 2) 提交执行

调用 `/api/openclaw/commands/execute`，携带：

- `method`
- `path`
- `query`
- `body`
- `channel`
- `senderId`
- `intent`
- `idempotencyKey`（强烈建议，防止重复提交）

### 3) 处理返回状态

- `queued`: 已入队，记录 `runId` 与 `taskId`。
- `pending_confirm`: 等待确认，向用户解释影响后再走确认接口。
- `duplicate`: 复用历史请求，直接复用已有 `runId`。

### 4) 确认接口

当 `pending_confirm` 时，调用 `/api/openclaw/commands/confirm`：

- `runId`
- `confirmToken`
- `decision` (`confirm` 或 `cancel`)

### 5) 追踪执行

通过 `/api/openclaw/commands/runs` 追踪状态：

- 例：`status=queued|running|failed|completed`
- 重点读取：`errorMessage`、`responseStatus`、`confirmStatus`

## 只读查询流程

调用 `/api/openclaw/proxy`，请求体：

- `method`
- `path`
- `query`
- `body`（如无可省略）

## 强制安全约束

- 禁止调用被封禁前缀：`/api/admin`、`/api/cron`、`/api/test`、`/api/openclaw`。
- 不使用绝对 URL，不允许路径穿越。
- 高风险操作先给用户一行影响摘要，再执行。

## 示例

### 读：日报查询（proxy）

```bash
curl -sS "$AUTOADS_HOST/api/openclaw/proxy" \
  -H "Authorization: Bearer $OPENCLAW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "GET",
    "path": "/api/dashboard/kpis",
    "query": {"days": 7}
  }'
```

### 写：发布广告（execute）

```bash
curl -sS "$AUTOADS_HOST/api/openclaw/commands/execute" \
  -H "Authorization: Bearer $OPENCLAW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "POST",
    "path": "/api/campaigns/publish",
    "intent": "campaign.publish",
    "idempotencyKey": "publish-offer-123-creative-456",
    "body": {
      "offerId": 123,
      "adCreativeId": 456,
      "googleAdsAccountId": 789,
      "campaignConfig": {
        "campaignName": "Brand_US_Search",
        "adGroupName": "Brand_Group_1",
        "budgetAmount": 50,
        "budgetType": "DAILY",
        "targetCountry": "US",
        "targetLanguage": "en",
        "biddingStrategy": "MAXIMIZE_CONVERSIONS",
        "maxCpcBid": 1.2,
        "keywords": ["keyword1", "keyword2"]
      }
    }
  }'
```

### 确认：高风险操作

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

### 查询执行记录

```bash
curl -sS "$AUTOADS_HOST/api/openclaw/commands/runs?status=failed&limit=20" \
  -H "Authorization: Bearer $OPENCLAW_TOKEN"
```

