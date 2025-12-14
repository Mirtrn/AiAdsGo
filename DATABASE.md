# 数据库配置指南

本项目支持双数据库架构：本地开发使用 SQLite，生产环境使用 PostgreSQL。

## 数据库适配器架构

项目使用统一的数据库适配器接口 (`src/lib/db.ts`)，自动检测环境变量并选择合适的数据库：

- **本地开发**: SQLite（默认路径：`./data/autoads.db`）
- **生产环境**: PostgreSQL（通过 `DATABASE_URL` 连接）

## 环境配置

### 本地开发（SQLite）

无需特殊配置，系统会自动使用 SQLite 数据库。

可选：自定义数据库路径
```bash
export DATABASE_PATH=/path/to/your/database.db
```

### 生产环境（PostgreSQL）

设置 `DATABASE_URL` 环境变量：

```bash
export DATABASE_URL=postgresql://user:password@host:port/database
```

示例（使用实际的数据库连接信息）：
```bash
export DATABASE_URL=postgresql://username:password@your-db-host.example.com:5432/autoads
```

## 使用方法

在代码中使用统一的数据库接口：

```typescript
import { getDatabase } from './lib/db'

// 获取数据库实例（自动选择 SQLite 或 PostgreSQL）
const db = getDatabase()

// 执行查询（统一的异步接口）
const rows = await db.query('SELECT * FROM users WHERE id = ?', [userId])
const user = await db.queryOne('SELECT * FROM users WHERE id = ?', [userId])
await db.exec('INSERT INTO users (name, email) VALUES (?, ?)', ['John', 'john@example.com'])

// 执行事务
await db.transaction(async () => {
  await db.exec('INSERT INTO ...')
  await db.exec('UPDATE ...')
})
```

## 数据库适配器特性

### SQLite 适配器
- ✅ 自动创建 `data/` 目录
- ✅ 启用外键约束
- ✅ WAL 模式（Write-Ahead Logging）
- ✅ 64MB 缓存优化
- ✅ 支持同步和异步操作

### PostgreSQL 适配器
- ✅ 自动转换 SQL 占位符（`?` → `$1, $2...`）
- ✅ 连接池管理（最大 10 个连接）
- ✅ 自动清理不支持的连接参数
- ✅ 完整的事务支持
- ✅ 类型自动转换

## SQL 兼容性处理

数据库适配器自动处理 SQLite 和 PostgreSQL 之间的差异：

### 1. 占位符
- **SQLite**: `?`
- **PostgreSQL**: `$1, $2, $3...`
- **适配器**: 自动转换，代码中统一使用 `?`

### 2. BOOLEAN 类型
```typescript
// SQLite 使用整数 (0/1)
const isSuccessCondition = db.type === 'sqlite'
  ? "CASE WHEN is_success = 1 THEN 1 ELSE 0 END"
  : "CASE WHEN is_success = true THEN 1 ELSE 0 END"
```

### 3. 日期函数
```typescript
// SQLite: date('now', '-7 days')
// PostgreSQL: CURRENT_DATE - INTERVAL '7 days'
const dateCondition = db.type === 'postgres'
  ? `date >= CURRENT_DATE - INTERVAL '${days} days'`
  : `date >= date('now', '-${days} days')`
```

### 4. 类型转换
PostgreSQL 返回字符串类型的数字，需要显式转换：
```typescript
const totalRequests = Number(summary?.total_requests) || 0
```

## 测试数据库连接

使用测试脚本验证数据库配置：

```bash
# 测试 SQLite（本地开发）
npx tsx test-db-adapter.ts

# 测试 PostgreSQL（生产环境）
DATABASE_URL='postgresql://...' npx tsx test-db-adapter.ts
```

测试内容：
1. ✅ API 调用追踪写入
2. ✅ 每日使用统计查询
3. ✅ 趋势数据查询
4. ✅ 配额限制检查

## 数据库迁移

### 自动迁移（推荐）

**生产环境启动时自动初始化和迁移**：

```bash
# 生产环境启动（自动执行数据库配置）
npm start
```

启动时会自动：
1. 检测数据库是否已初始化
2. 如果未初始化 → 执行完整初始化（创建表、索引、管理员账号）
3. 如果已初始化 → 执行增量迁移（只执行新迁移）
4. 启动服务

**适用场景**：
- ✅ 生产环境首次部署
- ✅ 生产环境更新部署
- ✅ 无需手动执行数据库操作
- ✅ 零停机更新

**环境变量**：
```bash
# PostgreSQL（生产环境）
DATABASE_URL='postgresql://user:password@host:port/database'

# 可选：自定义管理员密码
DEFAULT_ADMIN_PASSWORD='your-secure-password'
```

**跳过自动迁移**（如需手动控制）：
```bash
npm run start:no-migrate
```

### 迁移文件位置
- **SQLite**: `migrations/` (文件名格式: `001_xxx.sql`)
- **PostgreSQL**: `pg-migrations/` (文件名格式: `001_xxx.pg.sql`)

### 手动迁移（可选）

如果需要手动控制初始化和迁移过程：

#### 数据库初始化

首次部署时手动初始化数据库结构：

```bash
# SQLite 初始化（本地开发）
npm run db:init

# PostgreSQL 初始化（生产环境）
DATABASE_URL='postgresql://...' npm run db:init
```

初始化会：
1. 创建所有表结构
2. 创建索引和视图
3. 创建默认管理员账号（用户名: autoads）
4. 输出管理员登录密码

#### 增量迁移

手动执行增量迁移：

```bash
# SQLite 迁移
npm run db:migrate

# PostgreSQL 迁移
DATABASE_URL='postgresql://...' npm run db:migrate
```

**注意**：生产环境启动时，`instrumentation.ts` 会自动调用 `db-init.ts` 执行迁移，支持：
- 自动检测新迁移文件
- 检测迁移文件内容变更（MD5哈希）并重新执行
- 幂等操作（使用 `ON CONFLICT` 处理重复）

迁移脚本会：
1. 自动检测数据库类型（SQLite 或 PostgreSQL）
2. 读取对应目录的迁移文件
3. 跳过已执行的迁移
4. 按顺序执行新迁移
5. 记录迁移历史到 `migration_history` 表

### 创建新迁移

1. 确定下一个迁移编号（查看现有最大编号 + 1）
2. 创建 SQLite 迁移文件：`migrations/XXX_description.sql`
3. 创建 PostgreSQL 迁移文件：`pg-migrations/XXX_description.pg.sql`
4. 注意 SQLite 和 PostgreSQL 的语法差异：
   - **布尔值**：SQLite 使用 `0/1`，PostgreSQL 使用 `TRUE/FALSE`
   - **自增**：SQLite 使用 `AUTOINCREMENT`，PostgreSQL 使用 `SERIAL`
   - **日期**：SQLite 使用 `datetime('now')`，PostgreSQL 使用 `CURRENT_TIMESTAMP`
   - **修改列**：SQLite 需要重建表，PostgreSQL 可以 `ALTER COLUMN`

## 常见问题

### Q: 如何切换到 PostgreSQL？
A: 设置 `DATABASE_URL` 环境变量即可，系统会自动检测并使用 PostgreSQL。

### Q: 本地开发可以使用 PostgreSQL 吗？
A: 可以，设置 `DATABASE_URL` 指向本地 PostgreSQL 实例即可。

### Q: 数据库连接池配置？
A: PostgreSQL 使用 10 个连接池，可在 `src/lib/db.ts` 中调整。

### Q: 如何查看当前使用的数据库？
A: 调用 `getDatabase().type` 返回 `'sqlite'` 或 `'postgres'`。

## 架构优势

1. **开发友好**: 本地无需安装 PostgreSQL
2. **生产就绪**: 直接部署到生产环境的 PostgreSQL
3. **统一接口**: 代码无需修改即可在两种数据库间切换
4. **类型安全**: TypeScript 接口确保类型正确性
5. **性能优化**: 针对两种数据库的特定优化

## 相关文件

- `src/lib/db.ts` - 数据库适配器核心实现
- `src/lib/google-ads-api-tracker.ts` - 使用数据库适配器的示例
- `test-db-adapter.ts` - 数据库适配器测试脚本
- `migrations/` - SQLite 数据库迁移文件
- `pg-migrations/` - PostgreSQL 数据库迁移文件
