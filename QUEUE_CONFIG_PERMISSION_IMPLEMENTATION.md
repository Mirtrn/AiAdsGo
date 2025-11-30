# 队列配置权限控制实现完成

## ✅ 实施日期
2025-11-30

## 🎯 实施目标
为队列配置API添加完整的权限控制，确保只有管理员可以修改系统级别的队列配置。

---

## 📊 数据库层面的区分机制

### 通过 `user_id` 字段区分配置级别

```sql
-- 系统级别配置（user_id = NULL）
SELECT * FROM system_settings
WHERE category = 'queue' AND user_id IS NULL;

-- 用户级别配置（user_id = 具体值）
SELECT * FROM system_settings
WHERE category = 'queue' AND user_id = 1;
```

### 实际数据示例

**系统级别配置**（所有用户共享）:
```
42|queue|global_concurrency|NULL|全局并发限制（所有用户）
43|queue|per_user_concurrency|NULL|单用户并发限制
44|queue|max_queue_size|NULL|队列最大长度
45|queue|task_timeout|NULL|任务超时时间（毫秒）
46|queue|enable_priority|NULL|是否启用优先级队列
```

**用户级别配置**（用户可自定义）:
```
16|proxy|urls|1|代理URL配置列表
17|system|currency|1|默认货币
18|system|language|1|系统语言
```

---

## 🔒 权限控制实现

### 1. API权限检查

**文件**: `src/app/api/queue/config/route.ts`

#### GET /api/queue/config
**权限**: 需要登录

```typescript
export async function GET(request: NextRequest) {
  // 验证用户身份
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }

  // 获取配置（优先级：用户配置 > 系统配置）
  const config = getQueueConfig(auth.user.userId)

  return NextResponse.json({
    success: true,
    config,
  })
}
```

#### PUT /api/queue/config
**权限**: 仅管理员

```typescript
export async function PUT(request: NextRequest) {
  // 1. 验证用户身份
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }

  // 2. 检查用户是否为管理员
  if (auth.user.role !== 'admin') {
    return NextResponse.json(
      {
        error: '权限不足',
        message: '只有管理员可以修改系统队列配置'
      },
      { status: 403 }
    )
  }

  // 3. 验证配置格式
  const validationResult = queueConfigSchema.safeParse(body)
  if (!validationResult.success) {
    return NextResponse.json(
      { error: '配置格式错误', details: validationResult.error.errors },
      { status: 400 }
    )
  }

  // 4. 保存配置到数据库（系统级别，user_id = NULL）
  saveQueueConfig(config, undefined)

  // 5. 更新队列管理器配置（立即生效）
  const queueManager = getQueueManager()
  queueManager.updateConfig(config)

  // 6. 记录操作日志
  console.log(`[QueueConfig] 管理员 ${auth.user.email} (ID: ${auth.user.userId}) 更新了队列配置:`, config)

  return NextResponse.json({
    success: true,
    message: '配置已保存并生效',
    config,
  })
}
```

---

## 🎯 配置项分类

### 系统级别配置（仅管理员可修改）

| 配置项 | 说明 | 默认值 | 存储位置 |
|-------|------|--------|---------|
| `global_concurrency` | 全局并发限制 | 8 | `user_id = NULL` |
| `max_queue_size` | 队列最大长度 | 1000 | `user_id = NULL` |
| `enable_priority` | 启用优先级队列 | true | `user_id = NULL` |

### 可覆盖配置（用户可自定义）

| 配置项 | 说明 | 默认值 | 存储位置 |
|-------|------|--------|---------|
| `per_user_concurrency` | 单用户并发限制 | 2 | `user_id = NULL` 或 `user_id = 具体值` |
| `task_timeout` | 任务超时时间 | 300000 | `user_id = NULL` 或 `user_id = 具体值` |

---

## 🔄 配置继承机制

### 优先级顺序
```
用户实际配置 = 用户自定义配置 ∪ 系统默认配置
```

### 示例

**系统配置**（`user_id = NULL`）:
```json
{
  "globalConcurrency": 8,
  "perUserConcurrency": 2,
  "maxQueueSize": 1000,
  "taskTimeout": 300000,
  "enablePriority": true
}
```

**用户1自定义配置**（`user_id = 1`）:
```json
{
  "perUserConcurrency": 3,
  "taskTimeout": 600000
}
```

**用户1实际生效配置**:
```json
{
  "globalConcurrency": 8,        // 继承自系统配置
  "perUserConcurrency": 3,       // 用户自定义（覆盖系统默认2）
  "maxQueueSize": 1000,          // 继承自系统配置
  "taskTimeout": 600000,         // 用户自定义（覆盖系统默认300000）
  "enablePriority": true         // 继承自系统配置
}
```

---

## 🛡️ 安全机制

### 1. 身份验证
```typescript
const auth = await verifyAuth(request)
if (!auth.authenticated || !auth.user) {
  return NextResponse.json({ error: '未授权' }, { status: 401 })
}
```

### 2. 角色检查
```typescript
if (auth.user.role !== 'admin') {
  return NextResponse.json(
    {
      error: '权限不足',
      message: '只有管理员可以修改系统队列配置'
    },
    { status: 403 }
  )
}
```

### 3. 输入验证
```typescript
const queueConfigSchema = z.object({
  globalConcurrency: z.number().min(1).max(50).optional(),
  perUserConcurrency: z.number().min(1).max(20).optional(),
  maxQueueSize: z.number().min(10).max(10000).optional(),
  taskTimeout: z.number().min(10000).max(600000).optional(),
  enablePriority: z.boolean().optional(),
})
```

### 4. 操作日志
```typescript
console.log(`[QueueConfig] 管理员 ${auth.user.email} (ID: ${auth.user.userId}) 更新了队列配置:`, config)
```

---

## 📋 HTTP状态码

| 状态码 | 说明 | 场景 |
|-------|------|------|
| 200 | 成功 | 配置获取/更新成功 |
| 400 | 请求错误 | 配置格式错误 |
| 401 | 未授权 | 未登录或token无效 |
| 403 | 权限不足 | 非管理员尝试修改配置 |
| 500 | 服务器错误 | 数据库错误或其他异常 |

---

## 🧪 测试场景

### 1. 管理员修改配置（成功）

**请求**:
```bash
curl -X PUT http://localhost:3000/api/queue/config \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "globalConcurrency": 16,
    "perUserConcurrency": 4
  }'
```

**响应**:
```json
{
  "success": true,
  "message": "配置已保存并生效",
  "config": {
    "globalConcurrency": 16,
    "perUserConcurrency": 4
  }
}
```

### 2. 普通用户修改配置（失败）

**请求**:
```bash
curl -X PUT http://localhost:3000/api/queue/config \
  -H "Authorization: Bearer <user_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "globalConcurrency": 16
  }'
```

**响应**:
```json
{
  "error": "权限不足",
  "message": "只有管理员可以修改系统队列配置"
}
```
**状态码**: 403

### 3. 未登录访问（失败）

**请求**:
```bash
curl -X GET http://localhost:3000/api/queue/config
```

**响应**:
```json
{
  "error": "未授权"
}
```
**状态码**: 401

### 4. 配置格式错误（失败）

**请求**:
```bash
curl -X PUT http://localhost:3000/api/queue/config \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "globalConcurrency": 100
  }'
```

**响应**:
```json
{
  "error": "配置格式错误",
  "details": [
    {
      "code": "too_big",
      "maximum": 50,
      "path": ["globalConcurrency"],
      "message": "Number must be less than or equal to 50"
    }
  ]
}
```
**状态码**: 400

---

## 🎨 前端集成

### 队列配置页面权限控制

**文件**: `src/app/(app)/admin/queue/page.tsx`

```typescript
// 配置管理Tab - 保存配置
const saveConfig = async () => {
  setSavingConfig(true)
  try {
    const response = await fetch('/api/queue/config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    })

    const data = await response.json()

    if (!response.ok) {
      // 处理权限错误
      if (response.status === 403) {
        toast.error('权限不足：只有管理员可以修改系统配置')
      } else {
        throw new Error(data.error || '保存配置失败')
      }
      return
    }

    toast.success('配置已保存并生效')
    await fetchStats()
  } catch (error: any) {
    console.error('保存配置失败:', error)
    toast.error(error.message || '保存配置失败')
  } finally {
    setSavingConfig(false)
  }
}
```

---

## 📊 数据流程图

```
┌─────────────────────────────────────────────────────────┐
│ 用户操作                                                 │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ 前端：/admin/queue                                       │
│ - 点击"保存配置"按钮                                      │
│ - 发送 PUT /api/queue/config                            │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ 中间件：middleware.ts                                    │
│ - 验证JWT token                                         │
│ - 注入 x-user-id 和 x-user-role                         │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ API：/api/queue/config/route.ts                         │
│ 1. verifyAuth(request) - 验证身份                        │
│ 2. auth.user.role === 'admin' - 检查角色                │
│ 3. queueConfigSchema.safeParse() - 验证格式             │
│ 4. saveQueueConfig(config, undefined) - 保存配置        │
│ 5. queueManager.updateConfig(config) - 立即生效         │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ 数据库：system_settings                                  │
│ INSERT/UPDATE WHERE user_id IS NULL                     │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ 队列管理器：ScrapeQueueManager                           │
│ - 更新内存中的配置                                        │
│ - 立即生效，影响后续任务                                  │
└─────────────────────────────────────────────────────────┘
```

---

## ✅ 实施清单

- [x] 添加 `verifyAuth` 导入
- [x] GET API 添加身份验证
- [x] PUT API 添加身份验证
- [x] PUT API 添加管理员角色检查
- [x] 添加详细的错误消息
- [x] 添加操作日志记录
- [x] 修复TypeScript类型错误
- [x] 验证编译通过
- [x] 创建实施文档

---

## 🎯 总结

### 实现的功能

1. ✅ **完整的权限控制**
   - 身份验证（登录检查）
   - 角色检查（管理员验证）
   - 输入验证（配置格式）

2. ✅ **清晰的配置分级**
   - 系统级别配置（`user_id = NULL`）
   - 用户级别配置（`user_id = 具体值`）

3. ✅ **灵活的配置继承**
   - 用户配置可覆盖系统配置
   - 优先级：用户 > 系统 > 默认

4. ✅ **完善的错误处理**
   - 401: 未授权
   - 403: 权限不足
   - 400: 格式错误
   - 500: 服务器错误

5. ✅ **操作审计**
   - 记录管理员操作日志
   - 包含用户信息和配置内容

### 安全保障

- ✅ 只有管理员可以修改系统配置
- ✅ 普通用户无法修改全局并发限制
- ✅ 所有操作都有日志记录
- ✅ 配置格式严格验证

---

**实施状态**: ✅ 已完成
**测试状态**: ⏳ 待测试
**文档状态**: ✅ 已完成

**实施人员**: Claude Code
**审核人员**: 待审核
**批准人员**: 待批准

---

**最后更新**: 2025-11-30
**版本**: 1.0.0
