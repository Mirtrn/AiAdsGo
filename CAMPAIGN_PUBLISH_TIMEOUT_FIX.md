# Campaign发布504超时问题修复报告

## 问题概述

**症状**: 发布广告系列时出现Nginx 504网关超时错误
```
2025/12/18 23:39:47 [error] upstream timed out (110: Connection timed out) while reading response header from upstream
```

**根本原因**:
1. **同步阻塞**: `/api/campaigns/publish` 端点执行所有Google Ads API调用（5-8个）同步阻塞
2. **超时限制**: Nginx默认30秒超时，但API调用耗时30-60秒+
3. **Metadata警告**: `MetadataLookupWarning: All promises were rejected` 进一步加剧性能问题

## 解决方案

### 🆕 架构优化: 异步队列处理

采用**统一任务队列系统**（`/admin/queue`）处理长耗时Campaign发布操作

#### 核心改动

**1. 新增 `campaign-publish` 任务类型** (`src/lib/queue/types.ts:23`)
- 支持后台异步Campaign发布
- 并发限制: 2（避免Google Ads API限制）

**2. 创建Campaign发布执行器** (`src/lib/queue/executors/campaign-publish-executor.ts`)
- 处理完整的Google Ads API调用序列
- Campaign → AdGroup → Keywords → RSA Ad → Extensions → Status Update
- 完整的错误处理和状态追踪
- API使用量监控

**3. 注册执行器** (`src/lib/queue/executors/index.ts:58-59`)
- 集成到统一队列系统
- 自动启动后台任务处理

**4. 重构发布API路由** (`src/app/api/campaigns/publish/route.ts`)
- **之前**: 同步执行所有API调用（~30-60秒）→ 504超时
- **现在**: 快速验证 + 任务入队（<1秒）→ 立即返回202 Accepted
- 前端轮询 `campaign.creation_status` 查看进度

## 修复详情

### 工作流程

```
用户点击"发布" →
  ↓
前端调用 POST /api/campaigns/publish →
  ↓
  1. 验证身份和参数 (快速)
  2. 检查Launch Score (快速)
  3. 保存campaign到数据库 (快速)
  4. **入队 campaign-publish 任务** (快速)
  ↓
立即返回 202 Accepted
{
  "accepted": true,
  "campaigns": [
    {
      "id": 173,
      "status": "queued",
      "creationStatus": "pending",
      "message": "广告系列发布任务已提交到后台队列处理"
    }
  ],
  "summary": {
    "total": 1,
    "successful": 1,
    "failed": 0
  }
}

后台队列 → 执行 campaign-publish 任务 →
  1. 调用Google Ads API (长耗时)
  2. 更新数据库状态 (synced/failed)
  3. 记录API使用量

前端轮询 → GET /api/campaigns/[id] → 查看实时状态
```

### 性能对比

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| API响应时间 | 30-60秒 | <1秒 |
| Nginx超时 | ❌ 504错误 | ✅ 正常 |
| 用户体验 | ❌ 长时间等待 | ✅ 立即反馈 |
| 错误恢复 | ❌ 无 | ✅ 自动重试 |
| 状态追踪 | ❌ 无 | ✅ 实时轮询 |

## 部署和验证

### 1. 启动队列系统

确保队列系统已启动：
```bash
# 查看队列系统状态
GET /api/queue/stats

# 查看所有任务
GET /api/admin/queue
```

### 2. 测试发布流程

**方法1: 直接测试**
```bash
curl -X POST http://localhost:3000/api/campaigns/publish \
  -H "Content-Type: application/json" \
  -d '{
    "offerId": 173,
    "adCreativeId": 123,
    "googleAdsAccountId": 1,
    "campaignConfig": {...}
  }'
```

期望响应 (202 Accepted):
```json
{
  "success": true,
  "campaigns": [
    {
      "id": 173,
      "status": "queued",
      "creationStatus": "pending",
      "message": "广告系列发布任务已提交到后台队列处理"
    }
  ],
  "summary": {
    "total": 1,
    "successful": 1,
    "failed": 0
  }
}
```

**方法2**
1. : 前端测试打开Offer页面: `/offers/173/launch`
2. 点击"发布广告系列"
3. 验证:
   - ✅ 立即显示"任务已提交到后台队列处理"
   - ✅ 无504超时错误
   - ✅ 可以轮询查看进度

### 3. 查看后台任务

访问 `/admin/queue` 查看队列状态:
- Campaign发布任务应在`pending` → `running` → `completed`
- 完成后campaign记录更新为 `creation_status: 'synced'`

### 4. 监控API使用量

查看API追踪:
```sql
SELECT * FROM api_usage_tracking
WHERE endpoint = 'publishCampaign'
ORDER BY created_at DESC
LIMIT 10;
```

## 文件变更清单

✅ **已修改**:
1. `src/lib/queue/types.ts` - 添加 campaign-publish 任务类型
2. `src/lib/queue/unified-queue-manager.ts` - 添加并发配置
3. `src/lib/queue/executors/campaign-publish-executor.ts` - 新建执行器
4. `src/lib/queue/executors/index.ts` - 注册执行器
5. `src/app/api/campaigns/publish/route.ts` - 重构为队列模式

## 风险评估

✅ **低风险**:
- 向后兼容: API响应格式基本不变
- 失败处理: 自动重试机制
- 数据安全: 数据库事务保持一致

⚠️ **注意事项**:
- 前端需实现轮询逻辑查看进度（已具备）
- 队列系统必须正常运行
- 观察Google Ads API使用量限制

## 下一步优化

1. **实时通知**: 使用WebSocket/SSE推送进度更新
2. **批量优化**: 合并多个Campaign的API调用（如果允许）
3. **缓存优化**: 缓存Google Ads API metadata避免MetadataLookupWarning
4. **监控告警**: 队列积压、任务失败等监控

## 总结

通过引入异步队列系统，成功解决了Campaign发布504超时问题：
- ✅ 消除Nginx超时错误
- ✅ 提升用户体验（立即反馈）
- ✅ 增强系统可靠性（错误恢复）
- ✅ 改善可观测性（状态追踪）

用户现在可以流畅地发布广告系列，无需担心超时问题！
