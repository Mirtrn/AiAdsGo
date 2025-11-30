# 广告创意完整生命周期流程分析

## 项目概览
这是一个Next.js/TypeScript应用，实现了Google Ads的自动化广告投放系统。核心功能是生成AI广告创意并自动发布到Google Ads。

---

## 第一阶段：创意生成流程

### 1.1 触发点
**URL**: `POST /api/offers/:id/generate-creatives`
**触发条件**: 
- 用户点击创意管理页面的"生成新创意"按钮
- Offer的scrape_status必须为'completed'（完成产品信息抓取）

**主要文件**:
- `/src/app/(app)/creatives/page.tsx` - 前端UI（L248-273: handleGenerateCreatives）
- `/src/app/api/offers/[id]/generate-creatives/route.ts` - 后端API

### 1.2 生成过程（自动优化循环）

```
创意生成流程（带自动优化）:
┌─────────────────────────────────────┐
│ 第1次生成尝试 (skipCache=false)     │
│ ├─ 调用generateAdCreative()         │
│ ├─ 使用EXCELLENT标准Prompt          │
│ └─ 检查关键词并去重                 │
└────────────────┬────────────────────┘
                 │
         ┌───────▼────────┐
         │ 评估Ad Strength │
         │ (evaluateCreativeAdStrength)
         └───────┬────────┘
                 │
     ┌──────────┴──────────┐
     │ 是否EXCELLENT? ─────►YES─┐
     └──────────┬──────────┘    │
                │               │
               NO       (保存最佳结果)
                │               │
     ┌──────────▼──────────┐    │
     │ 重试次数 < maxRetries? │    │
     └──────────┬──────────┘    │
                │               │
               YES              │
                │               │
     ┌──────────▼──────────┐    │
     │ 第N+1次尝试          │    │
     │(skipCache=true)      │    │
     │excludeKeywords=已用  │    │
     └──────────┬──────────┘    │
                │               │
              重复循环 ◄──────────┘
```

**关键参数**:
- `maxRetries`: 最多重试3次（默认）
- `targetRating`: 目标评级'EXCELLENT'
- `MINIMUM_SCORE`: 70分（GOOD评级），低于此分不允许继续

**输出数据结构** (AdCreative):
```typescript
{
  id: number,
  offer_id: number,
  headlines: string[],           // 最多15个，各≤30字符
  descriptions: string[],        // 最多4个，各≤90字符
  keywords: string[],            // 关键词列表
  keywordsWithVolume: [{         // 带搜索量的关键词
    keyword: string,
    searchVolume: number,
    competition: string,
    competitionIndex: number
  }],
  negativeKeywords?: string[],   // 否定关键词（新增）
  callouts?: string[],           // 标注
  sitelinks?: Array<{            // 站点链接
    text: string,
    url: string,
    description?: string
  }>,
  final_url: string,
  
  // 评分信息
  score: number,                 // 0-100
  score_breakdown: {
    relevance: number,           // 0-30
    quality: number,             // 0-25
    engagement: number,          // 0-25
    diversity: number,           // 0-10
    clarity: number              // 0-10
  },
  
  // 状态字段
  is_approved: number,           // 0=未批准, 1=已批准 ⭐ 关键字段
  approved_at?: string,
  creation_status: string,       // draft/pending/synced/failed
  creation_error?: string,
  
  // Google Ads同步状态
  ad_group_id?: number,          // 关联的Ad Group ID
  ad_id?: string,                // Google Ads中的Ad ID
  last_sync_at?: string,
  
  created_at: string,
  version: number,
  ai_model: string               // 使用的AI模型
}
```

### 1.3 Launch Score评估
**目的**: 在生成阶段就预评投放准备度（5个维度，总分100）

**5个维度**:
1. **关键词质量** (30分) - 关键词相关性、搜索量、竞争度
2. **市场契合度** (25分) - 产品与市场是否匹配
3. **着陆页质量** (20分) - 着陆页体验、转化潜力
4. **预算合理性** (15分) - 预算分配是否合理
5. **内容创意质量** (10分) - 文案质量、吸引力

**返回结果**:
```json
{
  "totalScore": 85,
  "status": "excellent|good|warning",
  "message": "提示信息",
  "analysis": {
    "keywordsQuality": { score: 28, issues: [], suggestions: [] },
    "marketFit": { score: 23 },
    "landingPageQuality": { score: 19 },
    "budgetRationality": { score: 13 },
    "contentCreativeQuality": { score: 2 }
  },
  "recommendations": ["建议1", "建议2"]
}
```

**质量阈值**:
- 80分+ (EXCELLENT): 建议立即发布
- 60-79分 (GOOD): 可发布，有优化空间
- <60分 (WARNING): 建议优化后再发布（非阻断）

---

## 第二阶段：创意审批流程

### 2.1 批准操作

**URL**: 
- `POST /api/creatives/:id/approve` - 批准创意
- `DELETE /api/creatives/:id/approve` - 取消批准

**主要文件**:
- `/src/app/(app)/creatives/page.tsx` - 前端UI
  - L275-292: handleApprove()方法
  - L387-401: getApprovalBadge()显示批准状态
  - L164-170: 按批准状态过滤创意
  
- `/src/app/api/creatives/[id]/approve/route.ts` - 后端API

**是_approved字段的用途** ⭐⭐⭐:

```typescript
// 1. 数据库更新
is_approved = 1  // 已批准
is_approved = 0  // 未批准

// 2. UI显示逻辑（creatives/page.tsx）
const getApprovalBadge = (isApproved: number) => {
  if (isApproved === 1) {
    return <Badge>✅ 已批准</Badge>
  }
  return <Badge>未批准</Badge>
}

// 3. 过滤逻辑（creatives/page.tsx L164-170）
if (approvalFilter === 'approved') {
  result = result.filter((c) => c.is_approved === 1)
} else {
  result = result.filter((c) => c.is_approved !== 1)
}

// 4. 统计摘要（creatives/page.tsx L238-245）
setSummary({
  total: data.length,
  approved: data.filter(c => c.is_approved === 1).length,  // 统计已批准数量
  synced: data.filter(c => c.creation_status === 'synced').length,
  pending: data.filter(c => c.creation_status === 'pending').length,
})
```

### 2.2 is_approved字段的实际作用

**重要发现**: 
`is_approved`字段在当前业务逻辑中**仅用于UI层面的标记和过滤**，不作为同步到Google Ads的前置条件。

**具体体现**:

1. **不影响同步操作** ❌
   - `POST /api/creatives/:id/sync`中没有检查is_approved状态
   - 创意可以在未批准状态下同步到Google Ads
   
2. **仅用于用户标记** ✅
   - 帮助用户标记优质创意
   - 便于创意管理和过滤
   - 计算已批准创意数量统计

3. **下游业务中的使用**:
   - **Campaign发布流程** (campaigns/publish/route.ts)
     - 不检查is_approved状态
     - 直接根据创意ID选择发布
   
   - **Ad Group关联** (creatives/[id]/assign-adgroup/route.ts)
     - 不检查is_approved状态
     - 允许未批准创意关联Ad Group

---

## 第三阶段：创意同步到Google Ads

### 3.1 前置条件

**URL**: `POST /api/creatives/:id/sync`

**同步前的必要条件** (来自route.ts):

```typescript
// 1. Creative必须存在 ✓
const creative = findAdCreativeById(...)
if (!creative) { return 404 }

// 2. Creative不能已同步过 ✓
if (creative.ad_id) { 
  return 400 "Creative已同步，不能重复同步"
}

// 3. Creative必须关联到Ad Group ✓
if (!creative.ad_group_id) {
  return 400 "请先将Creative关联到Ad Group"
}

// 4. Ad Group必须在Google Ads上存在 ✓
const adGroup = findAdGroupById(creative.ad_group_id)
if (!adGroup.adGroupId) {
  return 400 "Ad Group未同步到Google Ads"
}

// 5. Campaign必须存在 ✓
const campaign = findCampaignById(adGroup.campaignId)
if (!campaign) { return 404 }

// 6. Google Ads账号必须授权 ✓
const googleAdsAccount = findGoogleAdsAccountById(campaign.googleAdsAccountId)
if (!googleAdsAccount.refreshToken) {
  return 400 "Google Ads账号未授权"
}

// 7. ❌ 不检查 is_approved 状态！！！
```

### 3.2 同步操作

**同步流程**:

```
POST /api/creatives/:id/sync
│
├─ 验证所有前置条件（除了is_approved）
│
├─ 更新creation_status = 'pending'
│
├─ 调用createGoogleAdsResponsiveSearchAd():
│  ├─ 验证Headlines数量：最少3个，最多15个
│  ├─ 验证Descriptions数量：最少2个，最多4个
│  ├─ 构建Final URLs列表
│  ├─ 调用Google Ads API创建Responsive Search Ad
│  └─ 获取Google Ads返回的ad_id和resourceName
│
├─ 如果成功:
│  ├─ 更新creation_status = 'synced'
│  ├─ 保存ad_id（Google Ads生成的ID）
│  ├─ 保存last_sync_at时间戳
│  ├─ 清空creation_error
│  └─ 返回200 + creative对象
│
└─ 如果失败:
   ├─ 更新creation_status = 'failed'
   ├─ 保存creation_error（错误信息）
   └─ 返回500 + 错误信息
```

**关键字段更新**:

| 字段 | 更新值 | 用途 |
|------|-------|------|
| `creation_status` | 'pending' → 'synced' 或 'failed' | 同步状态追踪 |
| `ad_id` | Google Ads生成的ID | Google Ads关联 |
| `last_sync_at` | 当前时间戳 | 最后同步时间 |
| `creation_error` | null 或 错误信息 | 错误追踪 |
| `is_approved` | ❌ **不变** | 不影响同步 |

### 3.3 UI中的同步按钮状态

```typescript
// creatives/page.tsx L734-744
{creative.ad_group_id && !creative.ad_id && creative.creation_status !== 'pending' && (
  <Button
    onClick={() => handleSyncToGoogleAds(creative)}
    disabled={syncingId === creative.id}
    className="text-indigo-600 hover:text-indigo-800"
  >
    <RefreshCw className={`w-4 h-4 ${syncingId === creative.id ? 'animate-spin' : ''}`} />
  </Button>
)}
```

**显示条件** (三个都必须满足):
1. ✓ 已关联Ad Group (`ad_group_id != null`)
2. ✓ 未同步过 (`ad_id == null`)
3. ✓ 非同步中状态 (`creation_status != 'pending'`)

**注意**: 不检查`is_approved`状态 ⚠️

---

## 第四阶段：广告发布到Google Ads

### 4.1 发布API

**URL**: `POST /api/campaigns/publish`

**请求体示例**:
```json
{
  "offer_id": 123,
  "ad_creative_id": 456,           // 单创意模式
  "google_ads_account_id": 789,
  "campaign_config": {
    "campaignName": "Campaign名称",
    "budgetAmount": 1000,
    "budgetType": "DAILY",
    "targetCountry": "US",
    "targetLanguage": "en",
    "biddingStrategy": "MAXIMIZE_CONVERSIONS",
    "finalUrlSuffix": "?utm_source=autobb",
    "adGroupName": "Ad Group名称",
    "maxCpcBid": 2.5,
    "keywords": ["keyword1", "keyword2"],
    "negativeKeywords": ["negative1"]
  },
  "pause_old_campaigns": true,
  "enable_smart_optimization": false,
  "variant_count": 3,
  "force_publish": false
}
```

### 4.2 发布前的验证步骤

```typescript
// campaigns/publish/route.ts L103-184

// 验证链路（无is_approved检查）:
1. ✓ Offer存在且属于用户
2. ✓ Offer已完成抓取 (scrape_status === 'completed')
3. ✓ Creative存在且属于用户
   └─ 单创意模式: 指定的ad_creative_id存在
   └─ 智能优化模式: 存在≥variant_count个创意
4. ✓ Creative有Final URL
5. ✓ Google Ads账号存在且活跃
6. ✓ 账号有有效的OAuth令牌

// ❌ 没有检查: is_approved 状态！
```

### 4.3 发布后的操作链

**流程概览**:

```
发布请求 (POST /api/campaigns/publish)
│
├─ 验证所有条件（不包括is_approved）
│
├─ 暂停旧广告系列（如果设置pause_old_campaigns=true）
│  └─ 调用updateGoogleAdsCampaignStatus()
│
├─ 计算Launch Score
│  └─ 投放准备度评估（非阻断性警告）
│
├─ 创建Google Ads Campaign
│  ├─ 调用createGoogleAdsCampaign()
│  └─ 获取campaign_id
│
├─ 创建Ad Group
│  ├─ 调用createGoogleAdsAdGroup()
│  └─ 获取ad_group_id
│
├─ 创建Keywords
│  ├─ 正向关键词 (match_type='BROAD')
│  └─ 否定关键词 (is_negative=true)
│
├─ 创建Responsive Search Ad
│  └─ 调用createGoogleAdsResponsiveSearchAd()
│
├─ 创建Extensions (可选)
│  ├─ Callout Extensions
│  └─ Sitelink Extensions
│
├─ 保存本地Campaign记录到数据库
│  ├─ campaigns表
│  ├─ ad_groups表
│  ├─ keywords表
│  └─ 关联关系追踪
│
└─ 返回发布结果

结果示例:
{
  "success": true,
  "campaign": {
    "id": 789,
    "google_campaign_id": "123456789",
    "name": "Campaign名称",
    "status": "ENABLED"
  },
  "adGroup": {
    "id": 790,
    "google_ad_group_id": "987654321",
    "name": "Ad Group名称"
  },
  "ad": {
    "id": "456789123",
    "status": "ENABLED"
  },
  "launchScore": {
    "score": 85,
    "status": "excellent",
    "message": "🎉 Launch Score优秀（85分），建议立即发布"
  }
}
```

### 4.4 本地数据库更新

**创建的记录**:

| 表 | 操作 | 关键字段 |
|-----|------|---------|
| `campaigns` | INSERT | offer_id, google_ads_account_id, google_campaign_id, creation_status='synced' |
| `ad_groups` | INSERT | campaign_id, google_ad_group_id, creation_status='synced' |
| `keywords` | INSERT | ad_group_id, keyword_id, keyword_text, is_negative |
| `ad_creatives` | UPDATE | 更新ad_group_id关联 (如未设置) |

---

## 第五阶段：UI操作流程

### 5.1 创意管理页面 (creatives/page.tsx)

**页面状态管理**:

```typescript
const [creatives, setCreatives] = useState<Creative[]>([])      // 所有创意
const [filteredCreatives, setFilteredCreatives] = useState<Creative[]>([]) // 过滤后

// 过滤条件
const [searchQuery, setSearchQuery] = useState('')              // 搜索
const [statusFilter, setStatusFilter] = useState('all')         // creation_status过滤
const [approvalFilter, setApprovalFilter] = useState('all')     // is_approved过滤
```

**可执行的操作**:

| 操作 | 触发按钮 | 条件 | 字段更新 |
|------|---------|------|---------|
| **生成创意** | "生成新创意" | offerId存在 + scrape_status=='completed' | 创建新创意记录，is_approved=0 |
| **查看详情** | 眼睛图标 | 任意创意 | 打开详情对话框 |
| **批准创意** | ✓/✗ | 任意创意 | is_approved=1, approved_at=now |
| **取消批准** | ✓/✗ | is_approved==1 | is_approved=0, approved_at=null |
| **关联Ad Group** | 链接图标 | !ad_group_id && adGroups.length>0 | 更新ad_group_id |
| **同步到Google Ads** | 刷新图标 | ad_group_id && !ad_id && creation_status!='pending' | creation_status='synced', ad_id=xxx |
| **Launch Score** | 魔法棒 | offerId存在 | 跳转到/launch-score页面 |
| **删除创意** | 垃圾桶图标 | ad_id==null | DELETE创意记录 |

### 5.2 创意信息显示

**表格列**:

```
ID | 版本 | 标题预览 | 质量评分 | 批准状态 | 同步状态 | 创建时间 | 操作
───┼──────┼─────────┼──────────┼─────────┼──────────┼──────────┼──────
#1 | v1   | 标题... | 85/100   | ✅已批准 | 已同步   | 2025-11  | 操作按钮
```

**Badge颜色**:

| 字段 | 值 | Badge |
|------|-----|-------|
| `is_approved` | 1 | 🟢 绿色"已批准" |
| `is_approved` | 0 | ⚪ 灰色"未批准" |
| `creation_status` | 'draft' | ⚪ 灰色"草稿" |
| `creation_status` | 'pending' | 🔵 蓝色"同步中" |
| `creation_status` | 'synced' | 🟢 绿色"已同步" |
| `creation_status` | 'failed' | 🔴 红色"同步失败" |

---

## 完整数据流汇总表

### 创意状态字段演变

```
创建阶段
│
└─► is_approved: 0 ❌
    creation_status: 'draft'
    ad_group_id: null
    ad_id: null
    
批准阶段 (可选)
│
└─► is_approved: 1 ✅  ◄─ 仅用于标记，不影响后续操作
    creation_status: 'draft' (不变)
    
关联Ad Group阶段
│
└─► ad_group_id: 123
    is_approved: 1 或 0 (不变)
    
同步到Google Ads阶段
│
├─ 开始同步:
│  └─► creation_status: 'pending'
│
├─ 同步成功:
│  └─► creation_status: 'synced' ✅
│      ad_id: 'xxx' (Google生成)
│      last_sync_at: now
│
└─ 同步失败:
   └─► creation_status: 'failed' ❌
       creation_error: '错误信息'
       ad_id: null
```

---

## is_approved字段的关键发现

### ⭐⭐⭐ 重要结论

`is_approved`字段在当前架构中：

1. **仅作为UI标记**
   - 帮助用户标记优质创意
   - 方便创意列表过滤显示
   - 计算统计数据（已批准数量）

2. **不作为业务流程的阻断条件**
   - ✓ 未批准创意可以关联Ad Group
   - ✓ 未批准创意可以同步到Google Ads
   - ✓ 未批准创意可以发布Campaign
   - ❌ 没有任何地方检查is_approved就中止流程

3. **数据库级别的用途**
   - 存储在`ad_creatives`表中
   - 关联字段：`approved_by`, `approved_at`
   - 可用于审计和创意选择决策

4. **可能的未来用途**（当前未实现）
   - 工作流审批（已批准才发布）
   - 质量控制阈值
   - 用户权限控制
   - 报告和分析

### 建议的改进方向

**选项1：强制审批流程**
```typescript
// 在同步API中添加检查
if (!creative.is_approved) {
  return 400 "创意必须先批准才能同步"
}
```

**选项2：保持当前设计**
- 将is_approved改名为is_user_approved（更清晰）
- 文档中明确说明这是"用户标记"而非"业务流程检查"

**选项3：引入质量检查**
```typescript
// 同步时自动校验是否达到最低质量标准
if (creative.score < MINIMUM_QUALITY_SCORE) {
  return 422 "创意质量未达标，无法同步"
}
```

---

## API端点完整映射

### 创意相关API

| 方法 | 端点 | 功能 | is_approved检查 |
|------|------|------|-----------------|
| POST | `/api/offers/:id/generate-creatives` | 生成创意 | ✗ 创建时=0 |
| GET | `/api/creatives?offerId=:id` | 列表查询 | ✗ 仅过滤 |
| GET | `/api/offers/:id/creatives` | Offer的创意 | ✗ 仅过滤 |
| GET | `/api/creatives/:id` | 单个创意详情 | ✗ |
| POST | `/api/creatives/:id/approve` | 批准 | ✗ 更新 is_approved→1 |
| DELETE | `/api/creatives/:id/approve` | 取消批准 | ✗ 更新 is_approved→0 |
| POST | `/api/creatives/:id/assign-adgroup` | 关联Ad Group | ✗ |
| POST | `/api/creatives/:id/sync` | 同步Google Ads | ✗ 不检查 |
| DELETE | `/api/creatives/:id` | 删除 | ✗ |
| POST | `/api/campaigns/publish` | 发布Campaign | ✗ 不检查 |

---

## 核心文件清单

| 文件路径 | 用途 | 关键函数 |
|----------|------|---------|
| `src/lib/ad-creative.ts` | 创意数据模型和操作 | approveAdCreative, unapproveAdCreative, findAdCreativeById |
| `src/lib/ad-creative-generator.ts` | AI创意生成 | generateAdCreative |
| `src/lib/scoring.ts` | Launch Score计算 | calculateLaunchScore |
| `src/app/(app)/creatives/page.tsx` | 创意管理UI | handleApprove, handleSyncToGoogleAds |
| `src/app/api/creatives/route.ts` | 创意列表API | |
| `src/app/api/creatives/[id]/approve/route.ts` | 批准API | approveAdCreative, unapproveAdCreative |
| `src/app/api/creatives/[id]/sync/route.ts` | 同步API | createGoogleAdsResponsiveSearchAd |
| `src/app/api/creatives/[id]/assign-adgroup/route.ts` | 关联API | updateAdCreative |
| `src/app/api/offers/[id]/generate-creatives/route.ts` | 生成API | generateAdCreative, evaluateCreativeAdStrength |
| `src/app/api/campaigns/publish/route.ts` | 发布API | createGoogleAdsCampaign, createGoogleAdsAdGroup |

---

**更新时间**: 2025-11-30
**分析范围**: 完整的广告创意生命周期（生成→批准→同步→发布）
