# Redis缓存Key环境隔离审计报告

**日期**: 2025-12-10
**严重程度**: 🔴 HIGH - 缓存数据未隔离，存在跨环境污染风险

## 1. 问题总结

虽然已经为**任务队列**实现了环境隔离（使用`REDIS_KEY_PREFIX`），但发现**业务缓存**（AI缓存、URL缓存、网页抓取缓存）仍未实现环境隔离。

### 当前状态

| 场景 | Key格式 | 环境隔离 | 风险 |
|------|---------|----------|------|
| 任务队列 | `autoads:development:queue:*` | ✅ 已隔离 | 🟢 无风险 |
| AI缓存 | `ai_cache:*` | ❌ 未隔离 | 🔴 高风险 |
| URL重定向缓存 | `redirect:*` | ❌ 未隔离 | 🔴 高风险 |
| 网页抓取缓存 | `scrape:*` | ❌ 未隔离 | 🔴 高风险 |

## 2. 受影响的文件和代码

### 2.1 AI缓存 (`src/lib/ai-cache.ts`)

**问题位置**: 第68-74行

```typescript
function generateCacheKey(
  operationType: string,
  contentHash: string,
  version: string = 'v1'
): string {
  return `ai_cache:${operationType}:${version}:${contentHash}`  // ❌ 无环境前缀
}
```

**影响范围**:
- `review_analysis` (评论分析缓存，7天TTL)
- `competitor_analysis` (竞品分析缓存，3天TTL)
- 所有AI操作的缓存

**风险**:
- 开发环境可能读取到生产环境的缓存数据
- 生产环境可能读取到开发环境的测试数据
- 缓存污染导致AI结果不准确

### 2.2 URL重定向缓存 (`src/lib/url-resolver-enhanced.ts`)

**问题位置**: 第368-376行

```typescript
const CACHE_KEY_PREFIX = 'redirect:'  // ❌ 无环境标识

function getCacheKey(affiliateLink: string, targetCountry: string): string {
  return `${CACHE_KEY_PREFIX}${targetCountry}:${affiliateLink}`  // ❌ 无环境前缀
}
```

**影响范围**:
- 联盟链接重定向缓存（7天TTL）
- 所有国家的URL解析结果

**风险**:
- 开发环境测试可能污染生产缓存
- 生产环境读取到开发环境的错误重定向
- 影响联盟链接的正确性

### 2.3 网页抓取缓存 (`src/lib/redis.ts`)

**问题位置**: 第43-52行

```typescript
function generateCacheKey(url: string, language: string, pageType?: 'product' | 'store'): string {
  const normalizedUrl = url
    .replace(/\/$/, '')
    .replace(/[?&](ref|tag|utm_[^&]+)=[^&]*/g, '')

  const typePrefix = pageType ? `${pageType}:` : ''
  return `scrape:${typePrefix}${language}:${Buffer.from(normalizedUrl).toString('base64')}`  // ❌ 无环境前缀
}
```

**影响范围**:
- 产品页面抓取缓存（7天TTL）
- 店铺页面抓取缓存（7天TTL）
- SEO数据缓存

**风险**:
- 开发环境测试数据污染生产缓存
- 生产环境可能读取到开发环境的不完整数据
- 影响广告创意生成的准确性

## 3. 风险评估

### 高风险场景

1. **数据污染**
   - 开发环境测试时生成的低质量AI结果被缓存
   - 生产环境用户可能读取到这些测试缓存
   - 导致广告创意质量下降

2. **调试困难**
   - 无法区分缓存来自哪个环境
   - 生产问题排查时可能受开发缓存干扰
   - 缓存失效策略难以针对特定环境

3. **资源浪费**
   - 开发测试产生的大量缓存占用Redis空间
   - 影响生产环境缓存命中率
   - 缓存清理困难

### 中风险场景

1. **配置不一致**
   - 开发环境使用测试API key
   - 生产环境使用正式API key
   - 缓存混用导致API调用结果不一致

2. **性能影响**
   - 缓存命中率下降（因为混合了多环境数据）
   - Redis内存占用增加
   - 缓存清理操作可能误删其他环境数据

## 4. 解决方案

### 4.1 统一环境前缀策略

使用与任务队列相同的环境隔离策略：

```typescript
import { REDIS_KEY_PREFIX } from './config'

// REDIS_KEY_PREFIX 格式: autoads:development:queue:
// 提取环境部分: autoads:development:
const ENV_PREFIX = REDIS_KEY_PREFIX.replace(':queue:', ':')
```

### 4.2 修复AI缓存 (`src/lib/ai-cache.ts`)

```typescript
import { REDIS_KEY_PREFIX } from './config'

const ENV_PREFIX = REDIS_KEY_PREFIX.replace(':queue:', ':')

function generateCacheKey(
  operationType: string,
  contentHash: string,
  version: string = 'v1'
): string {
  // ✅ 添加环境前缀
  return `${ENV_PREFIX}ai_cache:${operationType}:${version}:${contentHash}`
}
```

**修复后格式**: `autoads:development:ai_cache:review_analysis:v1:abc123`

### 4.3 修复URL缓存 (`src/lib/url-resolver-enhanced.ts`)

```typescript
import { REDIS_KEY_PREFIX } from './config'

const ENV_PREFIX = REDIS_KEY_PREFIX.replace(':queue:', ':')

function getCacheKey(affiliateLink: string, targetCountry: string): string {
  // ✅ 添加环境前缀
  return `${ENV_PREFIX}redirect:${targetCountry}:${affiliateLink}`
}
```

**修复后格式**: `autoads:development:redirect:US:https://...`

### 4.4 修复网页抓取缓存 (`src/lib/redis.ts`)

```typescript
import { REDIS_KEY_PREFIX } from './config'

const ENV_PREFIX = REDIS_KEY_PREFIX.replace(':queue:', ':')

function generateCacheKey(url: string, language: string, pageType?: 'product' | 'store'): string {
  const normalizedUrl = url
    .replace(/\/$/, '')
    .replace(/[?&](ref|tag|utm_[^&]+)=[^&]*/g, '')

  const typePrefix = pageType ? `${pageType}:` : ''
  // ✅ 添加环境前缀
  return `${ENV_PREFIX}scrape:${typePrefix}${language}:${Buffer.from(normalizedUrl).toString('base64')}`
}
```

**修复后格式**: `autoads:development:scrape:product:en:aHR0cHM6Ly8uLi4=`

### 4.5 更新验证脚本

修改 `scripts/verify-redis-isolation.ts` 以检查所有缓存类型：

```typescript
const patterns = [
  `${keyPrefix}*`,                    // 队列
  `${ENV_PREFIX}ai_cache:*`,          // AI缓存
  `${ENV_PREFIX}redirect:*`,          // URL缓存
  `${ENV_PREFIX}scrape:*`,            // 网页缓存
]
```

## 5. 实施步骤

### 步骤1: 修复代码（优先级：P0）

1. ✅ 修改 `src/lib/ai-cache.ts` 添加环境前缀
2. ✅ 修改 `src/lib/url-resolver-enhanced.ts` 添加环境前缀
3. ✅ 修改 `src/lib/redis.ts` 添加环境前缀
4. ✅ 更新验证脚本检查所有缓存类型

### 步骤2: 清理现有缓存（建议）

**开发环境**:
```bash
# 备份再清理
redis-cli --scan --pattern "ai_cache:*" | xargs redis-cli del
redis-cli --scan --pattern "redirect:*" | xargs redis-cli del
redis-cli --scan --pattern "scrape:*" | xargs redis-cli del
```

**生产环境**:
```bash
# ⚠️ 谨慎操作！建议先备份
# 清理后会导致缓存重建，可能短期内AI API调用增加
```

### 步骤3: 验证隔离效果

```bash
# 启动开发服务器
npm run dev

# 运行验证脚本
npx tsx scripts/verify-redis-isolation.ts
```

预期输出应该显示所有keys都有正确的环境前缀。

### 步骤4: 监控和优化

1. 监控缓存命中率变化
2. 检查Redis内存使用情况
3. 验证不同环境的缓存完全隔离

## 6. 预期收益

### 安全性

- ✅ 完全隔离开发/生产缓存数据
- ✅ 消除缓存污染风险
- ✅ 防止测试数据影响生产环境

### 可维护性

- ✅ 清晰的缓存来源标识
- ✅ 独立的缓存清理能力
- ✅ 简化问题排查流程

### 性能

- ✅ 提高缓存命中率（无跨环境干扰）
- ✅ 减少无效缓存占用
- ✅ 优化Redis内存使用

## 7. 向后兼容性

### 迁移影响

**注意**: 修复后，所有旧的缓存key将失效，需要重建缓存。

**影响**:
- 短期内AI API调用会增加（缓存未命中）
- 首次访问URL重定向会较慢（需要重新解析）
- 网页抓取会重新执行（无历史缓存）

**缓解方案**:
1. 选择低峰期部署
2. 考虑预热关键缓存
3. 监控API调用量，必要时提高速率限制

## 8. 总结

### 当前问题

| 问题 | 严重程度 | 状态 |
|------|----------|------|
| 任务队列未隔离 | 🔴 HIGH | ✅ 已修复 |
| 业务缓存未隔离 | 🔴 HIGH | ⏳ 待修复 |

### 下一步行动

1. **立即执行** (P0):
   - 修复3个缓存文件添加环境前缀
   - 更新验证脚本
   - 测试验证隔离效果

2. **建议操作** (P1):
   - 清理开发环境旧缓存
   - 监控缓存命中率
   - 文档化缓存策略

3. **长期优化** (P2):
   - 考虑使用独立Redis实例
   - 实施缓存预热策略
   - 添加缓存监控告警

---

**审计人**: Claude Code
**报告生成时间**: 2025-12-10 18:30 UTC+8
