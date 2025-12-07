# AutoAds KISS架构优化方案（整合迁移文件确认版）

## 📋 重要确认：迁移文件整合说明

### ✅ 已确认的迁移文件（058-063）

#### SQLite迁移文件（migrations/目录）
```
058_create_offer_tasks_queue.sql
059_create_batch_tasks.sql
060_add_batch_id_to_offer_tasks.sql
061_add_ai_enhanced_fields.sql
062_update_ad_creative_prompt_v4.0.sql
063_add_offer_tasks_indexes.sql
```

#### PostgreSQL迁移文件（pg-migrations/目录）
```
058_create_offer_tasks_queue.pg.sql
059_create_batch_tasks.pg.sql
060_add_batch_id_to_offer_tasks.pg.sql
061_add_ai_enhanced_fields.pg.sql
062_update_ad_creative_prompt_v4.0.pg.sql
063_add_offer_tasks_indexes.pg.sql
```

---

## 🎯 最终数据库初始化文件内容确认

### SQLite版本（migrations/000_init_schema_v2.sql）

#### ✅ 必须包含的内容：

**1. 基础Schema（来自000_init_schema_consolidated.sqlite.sql）**
- 所有表定义（除了删除的3个表）
- 所有索引（除了新增的8个索引）
- 所有种子数据（prompt_versions等）

**2. 整合迁移文件058-063的内容：**

```sql
-- Migration 058: offer_tasks表（任务队列架构）
CREATE TABLE offer_tasks (
  id TEXT PRIMARY KEY DEFAULT (...),
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
  stage TEXT,
  progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  message TEXT,
  affiliate_link TEXT NOT NULL,
  target_country TEXT NOT NULL,
  skip_cache INTEGER DEFAULT 0,
  skip_warmup INTEGER DEFAULT 0,
  result TEXT,  -- JSON string
  error TEXT,   -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Migration 059: batch_tasks表（批量操作）
CREATE TABLE batch_tasks (
  id TEXT PRIMARY KEY DEFAULT (...),
  user_id INTEGER NOT NULL,
  task_type TEXT NOT NULL CHECK(task_type IN ('offer-creation', 'offer-scrape', 'offer-enhance')) DEFAULT 'offer-creation',
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'partial')) DEFAULT 'pending',
  total_count INTEGER DEFAULT 0 CHECK(total_count >= 0),
  completed_count INTEGER DEFAULT 0 CHECK(completed_count >= 0),
  failed_count INTEGER DEFAULT 0 CHECK(failed_count >= 0),
  source_file TEXT,
  metadata TEXT,  -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Migration 060: offer_tasks表添加batch_id字段
ALTER TABLE offer_tasks ADD COLUMN batch_id TEXT REFERENCES batch_tasks(id) ON DELETE SET NULL;

-- Migration 061: offers表添加AI增强字段
ALTER TABLE offers ADD COLUMN ai_reviews TEXT;
ALTER TABLE offers ADD COLUMN ai_competitive_edges TEXT;
ALTER TABLE offers ADD COLUMN ai_keywords TEXT;

-- Migration 062: 更新prompt_versions表的v4.0数据
-- （包含完整的prompt_versions种子数据，v4.0版本）

-- Migration 063: offer_tasks表性能索引
CREATE INDEX idx_offer_tasks_user_status ON offer_tasks(user_id, status, created_at DESC);
CREATE INDEX idx_offer_tasks_status_created ON offer_tasks(status, created_at);
CREATE INDEX idx_offer_tasks_user_created ON offer_tasks(user_id, created_at DESC);
CREATE INDEX idx_offer_tasks_updated ON offer_tasks(updated_at DESC);
CREATE INDEX idx_offer_tasks_batch_id ON offer_tasks(batch_id, status);
-- 新增4个索引（063中新增的）
CREATE INDEX idx_offer_tasks_updated_at ON offer_tasks(updated_at DESC);
CREATE INDEX idx_offer_tasks_status ON offer_tasks(status);
CREATE INDEX idx_offer_tasks_id_updated ON offer_tasks(id, updated_at DESC);
```

**3. 删除无用表和视图**
```sql
DROP TABLE IF EXISTS scraped_products_new;
DROP TABLE IF EXISTS creative_versions_backup;
DROP TABLE IF EXISTS prompt_usage_stats;

DROP VIEW IF EXISTS v_phase3_statistics;
DROP VIEW IF EXISTS v_top_hot_products;
```

**4. 新增性能索引**
```sql
-- offers表
CREATE INDEX idx_offers_user_status ON offers(user_id, status);
CREATE INDEX idx_offers_user_created ON offers(user_id, created_at DESC);

-- ad_creatives表
CREATE INDEX idx_ad_creatives_user_offer ON ad_creatives(user_id, offer_id);
CREATE INDEX idx_ad_creatives_selected ON ad_creatives(user_id, is_selected);

-- scraped_products表
CREATE INDEX idx_scraped_products_user_offer ON scraped_products(user_id, offer_id);
CREATE INDEX idx_scraped_products_hot ON scraped_products(user_id, is_hot);

-- campaigns表
CREATE INDEX idx_campaigns_user_status ON campaigns(user_id, status);

-- ad_performance表
CREATE INDEX idx_ad_performance_date ON ad_performance(user_id, date);
```

### PostgreSQL版本（pg-migrations/000_init_schema_v2.pg.sql）

#### ✅ 必须包含的内容：

**1. 基础Schema（来自000_init_schema_consolidated.pg.sql）**
- 所有表定义（除了删除的3个表）
- 所有索引（除了新增的8个索引）
- 所有种子数据（prompt_versions等）

**2. 整合迁移文件058-063的内容：**

```sql
-- Migration 058: offer_tasks表（PostgreSQL版本，使用UUID和JSONB）
CREATE TABLE offer_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
  stage VARCHAR(50),
  progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  message TEXT,
  affiliate_link TEXT NOT NULL,
  target_country VARCHAR(10) NOT NULL,
  skip_cache BOOLEAN DEFAULT FALSE,
  skip_warmup BOOLEAN DEFAULT FALSE,
  result JSONB,  -- PostgreSQL使用JSONB
  error JSONB,   -- PostgreSQL使用JSONB
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Migration 059: batch_tasks表（PostgreSQL版本）
CREATE TABLE batch_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,
  task_type VARCHAR(20) NOT NULL CHECK(task_type IN ('offer-creation', 'offer-scrape', 'offer-enhance')) DEFAULT 'offer-creation',
  status VARCHAR(20) NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'partial')) DEFAULT 'pending',
  total_count INTEGER DEFAULT 0 CHECK(total_count >= 0),
  completed_count INTEGER DEFAULT 0 CHECK(completed_count >= 0),
  failed_count INTEGER DEFAULT 0 CHECK(failed_count >= 0),
  source_file TEXT,
  metadata JSONB,  -- PostgreSQL使用JSONB
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Migration 060: offer_tasks表添加batch_id字段
ALTER TABLE offer_tasks ADD COLUMN batch_id UUID REFERENCES batch_tasks(id) ON DELETE SET NULL;

-- Migration 061: offers表添加AI增强字段
ALTER TABLE offers ADD COLUMN ai_reviews TEXT;
ALTER TABLE offers ADD COLUMN ai_competitive_edges TEXT;
ALTER TABLE offers ADD COLUMN ai_keywords TEXT;

-- Migration 062: 更新prompt_versions表的v4.0数据
-- （包含完整的prompt_versions种子数据，v4.0版本）

-- Migration 063: offer_tasks表性能索引（PostgreSQL版本）
CREATE INDEX idx_offer_tasks_user_status ON offer_tasks(user_id, status, created_at DESC);
CREATE INDEX idx_offer_tasks_status_created ON offer_tasks(status, created_at);
CREATE INDEX idx_offer_tasks_user_created ON offer_tasks(user_id, created_at DESC);
CREATE INDEX idx_offer_tasks_updated ON offer_tasks(updated_at DESC);
CREATE INDEX idx_offer_tasks_batch_id ON offer_tasks(batch_id, status);
-- 新增4个索引（063中新增的）
CREATE INDEX idx_offer_tasks_updated_at ON offer_tasks(updated_at DESC);
CREATE INDEX idx_offer_tasks_status ON offer_tasks(status);
CREATE INDEX idx_offer_tasks_id_updated ON offer_tasks(id, updated_at DESC);
```

**3. 删除无用表和视图**
```sql
DROP TABLE IF EXISTS scraped_products_new;
DROP TABLE IF EXISTS creative_versions_backup;
DROP TABLE IF EXISTS prompt_usage_stats;

DROP VIEW IF EXISTS v_phase3_statistics;
DROP VIEW IF EXISTS v_top_hot_products;
```

**4. 新增性能索引（使用CONCURRENTLY）**
```sql
-- offers表
CREATE INDEX CONCURRENTLY idx_offers_user_status ON offers(user_id, status);
CREATE INDEX CONCURRENTLY idx_offers_user_created ON offers(user_id, created_at DESC);

-- ad_creatives表
CREATE INDEX CONCURRENTLY idx_ad_creatives_user_offer ON ad_creatives(user_id, offer_id);
CREATE INDEX CONCURRENTLY idx_ad_creatives_selected ON ad_creatives(user_id, is_selected);

-- scraped_products表
CREATE INDEX CONCURRENTLY idx_scraped_products_user_offer ON scraped_products(user_id, offer_id);
CREATE INDEX CONCURRENTLY idx_scraped_products_hot ON scraped_products(user_id, is_hot);

-- campaigns表
CREATE INDEX CONCURRENTLY idx_campaigns_user_status ON campaigns(user_id, status);

-- ad_performance表
CREATE INDEX CONCURRENTLY idx_ad_performance_date ON ad_performance(user_id, date);
```

---

## 📋 整合检查清单

### ✅ 必须确认包含的迁移内容

#### SQLite版本（migrations/000_init_schema_v2.sql）
- [x] 058: offer_tasks表（TEXT ID，JSON字符串）
- [x] 059: batch_tasks表（TEXT ID，JSON字符串）
- [x] 060: offer_tasks.batch_id字段
- [x] 061: offers.ai_reviews, ai_competitive_edges, ai_keywords字段
- [x] 062: prompt_versions v4.0数据
- [x] 063: offer_tasks的7个索引
- [x] 删除3个无用表
- [x] 删除2个无用视图
- [x] 新增8个性能索引

#### PostgreSQL版本（pg-migrations/000_init_schema_v2.pg.sql）
- [x] 058: offer_tasks表（UUID ID，JSONB）
- [x] 059: batch_tasks表（UUID ID，JSONB）
- [x] 060: offer_tasks.batch_id字段
- [x] 061: offers.ai_reviews, ai_competitive_edges, ai_keywords字段
- [x] 062: prompt_versions v4.0数据
- [x] 063: offer_tasks的7个索引
- [x] 删除3个无用表
- [x] 删除2个无用视图
- [x] 新增8个性能索引（使用CONCURRENTLY）

---

## 📅 生成数据库初始化文件的步骤

### Step 1: 创建SQLite版本（migrations/000_init_schema_v2.sql）
```bash
# 1. 以000_init_schema_consolidated.sqlite.sql为基础
# 2. 删除3个无用表的定义
# 3. 删除2个无用视图的定义
# 4. 添加offer_tasks表（来自058）
# 5. 添加batch_tasks表（来自059）
# 6. 添加offer_tasks.batch_id字段（来自060）
# 7. 添加offers表的3个AI字段（来自061）
# 8. 更新prompt_versions种子数据（来自062）
# 9. 添加所有索引（来自063 + 新增8个索引）
```

### Step 2: 创建PostgreSQL版本（pg-migrations/000_init_schema_v2.pg.sql）
```bash
# 1. 以000_init_schema_consolidated.pg.sql为基础
# 2. 删除3个无用表的定义
# 3. 删除2个无用视图的定义
# 4. 添加offer_tasks表（PostgreSQL版，来自058）
# 5. 添加batch_tasks表（PostgreSQL版，来自059）
# 6. 添加offer_tasks.batch_id字段（PostgreSQL版，来自060）
# 7. 添加offers表的3个AI字段（来自061）
# 8. 更新prompt_versions种子数据（来自062）
# 9. 添加所有索引（PostgreSQL版，来自063 + 新增8个索引，使用CONCURRENTLY）
```

---

## ✅ 最终确认

### 数据库初始化文件将包含：
1. ✅ **完整的基础Schema**（所有核心表和字段）
2. ✅ **所有迁移内容**（058-063的6个迁移）
3. ✅ **删除无用表和视图**（5个）
4. ✅ **新增性能索引**（15个索引）
5. ✅ **prompt_versions v4.0数据**

### 项目启动时：
- ✅ 开发环境：直接使用 `migrations/000_init_schema_v2.sql` 初始化SQLite
- ✅ 生产环境：直接使用 `pg-migrations/000_init_schema_v2.pg.sql` 初始化PostgreSQL
- ✅ 无需运行迁移文件（因为初始化文件已经包含所有内容）

---

## 总结

**重要确认：**
- ✅ SQLite和PostgreSQL的迁移文件内容都会被完整整合到最终的v2.0初始化文件中
- ✅ 所有58-063迁移的功能都会保留在最终数据库中
- ✅ 只是将"迁移过程"简化为"一步到位初始化"
- ✅ 项目未上线，可以直接使用最终状态，无需迁移过程

**最终生成的文件：**
1. `migrations/000_init_schema_v2.sql` - SQLite最终版本
2. `pg-migrations/000_init_schema_v2.pg.sql` - PostgreSQL最终版本