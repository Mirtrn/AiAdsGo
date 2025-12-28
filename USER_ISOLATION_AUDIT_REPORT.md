# 广告数据同步用户隔离审查报告

生成时间: 2025-12-28
审查范围: 广告系列数据同步流程的用户级别隔离机制

---

## 📋 审查摘要

| 项目 | 状态 | 风险等级 |
|------|------|----------|
| API认证隔离 | ✅ 已实现 | 低 |
| 队列任务隔离 | ✅ 已实现 | 低 |
| 数据库查询隔离 | ✅ 已实现 | 低 |
| 数据写入隔离 | ✅ 已实现 | 低 |
| 外键约束 | ✅ 已实现 | 低 |
| 同步状态隔离 | ✅ 已实现 | 低 |

**总体评估**: ✅ 用户隔离机制完善，无安全隐患

---

## 🔍 详细审查

### 1. API层用户认证隔离

**文件**: `src/app/api/sync/trigger/route.ts`

**机制**:
```typescript
// ✅ 第11-17行: 使用 verifyAuth() 验证用户身份
const authResult = await verifyAuth(request)
if (!authResult.authenticated || !authResult.user) {
  return NextResponse.json({ error: '未授权' }, { status: 401 })
}
const userId = authResult.user.userId

// ✅ 第29行: 仅同步当前用户的数据
dataSyncService.syncPerformanceData(userId, 'manual')
```

**评估**: ✅ **安全**
- 使用JWT认证，确保只能触发自己的同步任务
- 无法跨用户触发同步

---

### 2. 队列系统用户隔离

**文件**: `src/lib/queue-triggers.ts`

**机制**:
```typescript
// ✅ 第37-42行: taskData 中包含 userId
const taskData: SyncTaskData = {
  userId,  // ← 用户ID绑定到任务数据
  syncType: options.syncType || 'manual',
  googleAdsAccountId: options.googleAdsAccountId,
  // ...
}

// ✅ 第45-52行: 任务入队时传递 userId
const taskId = await queue.enqueue(
  'sync',
  taskData,
  userId,  // ← 用户ID作为队列参数
  { priority: 'high', maxRetries: 3 }
)
```

**评估**: ✅ **安全**
- 每个队列任务都绑定了 `userId`
- 任务执行时会使用 `taskData.userId` 而不是全局变量

---

### 3. 核心同步服务用户隔离

**文件**: `src/lib/data-sync-service.ts`

#### 3.1 僵尸任务清理隔离

```typescript
// ✅ 第185-193行: 清理僵尸任务时限定 user_id
await db.exec(`
  UPDATE sync_logs
  SET status = 'failed', error_message = '...', completed_at = ?
  WHERE user_id = ?  // ← 限定用户
    AND status = 'running'
    AND started_at < ?
`, [startedAt, userId, zombieThreshold])
```

**评估**: ✅ **安全** - 只清理当前用户的僵尸任务

#### 3.2 Google Ads凭证隔离

```typescript
// ✅ 第211行: 获取用户专属凭证
const credentials = await getGoogleAdsCredentialsFromDB(userId)
```

**评估**: ✅ **安全** - 每个用户使用自己的Google Ads凭证

#### 3.3 Google Ads账户查询隔离

```typescript
// ✅ 第230-236行: 查询用户的Google Ads账户
const accounts = await db.query(`
  SELECT id, customer_id, refresh_token, user_id, service_account_id
  FROM google_ads_accounts
  WHERE user_id = ? AND ${isActiveCondition}  // ← 限定用户
`, [userId])
```

**评估**: ✅ **安全** - 只查询当前用户的Google Ads账户

#### 3.4 Campaign查询隔离

```typescript
// ✅ 第265-272行: 查询用户的Campaigns
const campaigns = await db.query(`
  SELECT c.id, c.google_campaign_id, c.campaign_name
  FROM campaigns c
  WHERE c.user_id = ?  // ← 限定用户
    AND c.google_ads_account_id = ?  // ← 限定账户
    AND c.google_campaign_id IS NOT NULL
`, [userId, account.id])
```

**评估**: ✅ **安全** - 双重隔离 (user_id + account_id)

#### 3.5 性能数据写入隔离

```typescript
// ✅ 第332-362行: 写入性能数据时绑定 user_id
await db.exec(`
  INSERT INTO campaign_performance (
    user_id, campaign_id, date,  // ← user_id 字段
    impressions, clicks, conversions, cost, ...
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ...)
  ON CONFLICT(campaign_id, date) DO UPDATE SET ...
`, [
  userId,  // ← 始终使用传入的 userId
  campaign.id,
  record.date,
  // ...
])
```

**评估**: ✅ **安全** - 性能数据始终绑定到正确的用户

#### 3.6 同步日志隔离

```typescript
// ✅ 第252-260行: 创建同步日志时绑定 user_id
const logResult = await db.exec(`
  INSERT INTO sync_logs (
    user_id, google_ads_account_id, sync_type, status, ...
  ) VALUES (?, ?, ?, 'running', 0, 0, ?)
`, [userId, account.id, syncType, startedAt])
```

**评估**: ✅ **安全** - 同步日志正确归属到用户

---

### 4. 数据库层用户隔离

#### 4.1 外键约束

**google_ads_accounts 表**:
```sql
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
UNIQUE(user_id, customer_id)  -- 同一用户不能重复添加同一账户
```

**campaigns 表**:
```sql
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
```

**campaign_performance 表**:
```sql
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
UNIQUE(campaign_id, date)  -- 同一campaign同一天只能有一条记录
```

**sync_logs 表**:
```sql
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL
```

**评估**: ✅ **安全**
- 所有表都有 `user_id` 外键约束
- `ON DELETE CASCADE` 确保用户删除时级联删除数据
- UNIQUE 约束防止数据重复

#### 4.2 索引优化

```sql
-- google_ads_accounts
CREATE INDEX idx_google_ads_user_active ON google_ads_accounts(user_id, is_active);

-- campaign_performance
CREATE INDEX idx_campaign_performance_campaign_date ON campaign_performance(campaign_id, date DESC, user_id);
CREATE INDEX idx_performance_user_campaign ON campaign_performance(user_id, campaign_id);
CREATE INDEX idx_performance_user_date ON campaign_performance(user_id, date);

-- sync_logs
CREATE INDEX idx_sync_logs_user ON sync_logs(user_id, started_at);
```

**评估**: ✅ **优秀**
- 索引包含 `user_id`，查询性能优化
- 支持高效的用户级别数据过滤

---

### 5. 内存状态隔离

**文件**: `src/lib/data-sync-service.ts`

```typescript
// ✅ 第80行: 使用 Map 结构按用户隔离同步状态
private syncStatus: Map<number, SyncStatus> = new Map()

// ✅ 第94-102行: getSyncStatus 按用户ID查询
getSyncStatus(userId: number): SyncStatus {
  return this.syncStatus.get(userId) || { /* 默认值 */ }
}

// ✅ 第196-204行: 更新状态时使用 userId 作为key
this.syncStatus.set(userId, {
  isRunning: true,
  lastSyncAt: null,
  // ...
})
```

**评估**: ✅ **安全**
- 使用 `Map<userId, status>` 隔离不同用户的同步状态
- 不会出现用户A的同步阻塞用户B的同步

---

### 6. 定时任务用户隔离

**文件**: `scripts/cron-sync-data.ts`

```typescript
// ✅ 第42-64行: 查询每个用户的配置
const configs = await db.query<UserSyncConfig>(`
  SELECT u.id AS user_id, ...
  FROM users u
  LEFT JOIN system_settings s_enabled ON s_enabled.user_id = u.id
  LEFT JOIN system_settings s_interval ON s_interval.user_id = u.id
  WHERE COALESCE(s_enabled.value, 'true') = 'true'
`)

// ✅ 第77-110行: 逐个用户触发同步
for (const config of configs) {
  const userId = config.user_id
  const taskId = await triggerDataSync(userId, {
    syncType: 'auto',
    priority: 'normal',
  })
}
```

**评估**: ✅ **安全**
- 遍历用户列表，为每个用户独立触发同步任务
- 每个用户的同步间隔配置独立

---

## 🧪 测试建议

### 测试用例1: 跨用户数据隔离测试

```sql
-- 准备测试数据
INSERT INTO users (id, username, email) VALUES (100, 'test_user_a', 'a@test.com');
INSERT INTO users (id, username, email) VALUES (101, 'test_user_b', 'b@test.com');

INSERT INTO google_ads_accounts (user_id, customer_id, account_name) VALUES (100, '1111111111', 'Account A');
INSERT INTO google_ads_accounts (user_id, customer_id, account_name) VALUES (101, '2222222222', 'Account B');

-- 测试查询
SELECT * FROM google_ads_accounts WHERE user_id = 100;  -- 应只返回Account A
SELECT * FROM google_ads_accounts WHERE user_id = 101;  -- 应只返回Account B
```

### 测试用例2: 同步任务隔离测试

```bash
# 用户A触发同步
curl -X POST http://localhost:3000/api/sync/trigger \
  -H "Authorization: Bearer <USER_A_JWT>" \
  -H "Content-Type: application/json"

# 用户B触发同步
curl -X POST http://localhost:3000/api/sync/trigger \
  -H "Authorization: Bearer <USER_B_JWT>" \
  -H "Content-Type: application/json"

# 验证: sync_logs 表中应该有两条记录，分别对应用户A和用户B
SELECT user_id, google_ads_account_id, status FROM sync_logs ORDER BY started_at DESC LIMIT 2;
```

### 测试用例3: 级联删除测试

```sql
-- 删除用户
DELETE FROM users WHERE id = 100;

-- 验证: 所有关联数据应该被级联删除
SELECT COUNT(*) FROM google_ads_accounts WHERE user_id = 100;  -- 应返回 0
SELECT COUNT(*) FROM campaigns WHERE user_id = 100;            -- 应返回 0
SELECT COUNT(*) FROM campaign_performance WHERE user_id = 100; -- 应返回 0
SELECT COUNT(*) FROM sync_logs WHERE user_id = 100;            -- 应返回 0
```

---

## ✅ 结论

### 优势

1. **多层隔离**: API认证 → 队列任务 → 数据库查询 → 数据写入，每一层都有用户隔离
2. **外键约束**: 数据库层面强制用户数据隔离
3. **内存隔离**: 同步状态使用 `Map<userId, status>` 隔离
4. **审计日志**: sync_logs 表完整记录每个用户的同步历史
5. **级联删除**: 用户删除时自动清理所有关联数据

### 无风险项

- ❌ 未发现跨用户数据泄露风险
- ❌ 未发现用户A可以触发用户B同步的漏洞
- ❌ 未发现用户A可以查看用户B数据的漏洞

### 建议（可选）

1. **添加审计日志**: 在 sync_logs 中记录触发来源 (manual/auto/admin)
2. **添加速率限制**: 限制单个用户的同步频率 (例如: 每小时最多3次手动同步)
3. **添加监控告警**: 如果发现跨用户查询，立即告警

---

## 📊 风险评级

| 风险类型 | 评级 | 说明 |
|---------|------|------|
| 跨用户数据泄露 | 🟢 极低 | 多层隔离机制完善 |
| 越权触发同步 | 🟢 极低 | JWT认证 + userId验证 |
| 数据污染 | 🟢 极低 | 外键约束 + UNIQUE约束 |
| 性能影响 | 🟢 极低 | 索引优化 + 队列隔离 |

**总体风险评级**: 🟢 **极低 (安全)**

---

生成时间: 2025-12-28
审查人员: Claude Code
审查版本: v1.0
