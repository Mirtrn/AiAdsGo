# Google Ads API 配额显示修复

## 问题描述

在 `/dashboard` 页面的"API配额使用"卡片中，"Google Ads API调用次数上限"固定显示为 2,880（Explorer Access），没有根据用户的实际 API 权限级别（Basic 或 Explorer）进行区分显示。

根据 Google Ads API 文档：
- **Explorer Access**: 2,880 次操作/天（默认权限）
- **Basic Access**: 15,000 次操作/天（需要申请审核）

## 修复方案

### 1. 数据库更改

添加了 `api_access_level` 字段到以下表：
- `google_ads_credentials` (OAuth 认证)
- `google_ads_service_accounts` (服务账号认证)

字段类型：`TEXT`，可选值：`'basic'` 或 `'explorer'`，默认值：`'explorer'`

迁移文件：
- `migrations/204_add_api_access_level.sql`
- `pg-migrations/204_add_api_access_level.pg.sql`

### 2. 后端逻辑更新

#### `src/lib/google-ads-api-tracker.ts`
- 更新 `resolveDailyQuotaLimit()` 函数，优先从用户的凭证配置中读取 `api_access_level`
- 根据访问级别返回对应的配额上限：
  - `basic` → 15,000
  - `explorer` → 2,880

#### `src/app/api/google-ads/credentials/route.ts`
- **GET**: 返回用户的 `apiAccessLevel` 信息
- **PATCH**: 新增方法，允许用户更新 API 访问级别

### 3. 前端 UI 更新

#### `src/app/(app)/settings/page.tsx`
在 Google Ads 配置区域添加了"API 访问级别"选择器：
- 显示两个选项卡：Explorer Access (2,880次/天) 和 Basic Access (15,000次/天)
- 用户可以点击切换访问级别
- 提供了查看访问级别的指引链接（Google Ads API Center）

## 使用说明

### 用户操作流程

1. 访问 **设置页面** (`/settings`)
2. 在 **Google Ads 配置** 区域，找到"API 访问级别"部分
3. 根据您在 [Google Ads API Center](https://ads.google.com/aw/apicenter) 中看到的实际权限级别，选择对应的选项：
   - 如果显示 "Explorer Access" → 选择 Explorer Access
   - 如果显示 "Basic Access" 或更高 → 选择 Basic Access
4. 点击后系统会自动保存并更新配额显示

### Dashboard 显示

配置完成后，在 `/dashboard` 页面的"API配额使用"卡片中：
- 配额上限会根据您选择的访问级别动态显示
- Explorer: 显示 2,880
- Basic: 显示 15,000

## 技术细节

### 配额计算优先级

`resolveDailyQuotaLimit()` 函数按以下优先级确定配额：

1. 环境变量 `GOOGLE_ADS_DAILY_QUOTA_LIMIT`（如果设置）
2. OAuth 凭证的 `api_access_level` 字段
3. 服务账号的 `api_access_level` 字段
4. `system_settings` 表中的配置
5. 默认值：2,880（Explorer）

### API 端点

- `GET /api/google-ads/credentials` - 获取凭证状态（包含 `apiAccessLevel`）
- `PATCH /api/google-ads/credentials` - 更新 API 访问级别
  ```json
  {
    "apiAccessLevel": "basic" | "explorer"
  }
  ```

## 测试验证

1. 确认数据库迁移成功执行
2. 在设置页面切换 API 访问级别
3. 访问 Dashboard 页面，确认配额上限显示正确
4. 检查 API 调用统计是否正常工作

## 相关文件

- `migrations/204_add_api_access_level.sql`
- `pg-migrations/204_add_api_access_level.pg.sql`
- `src/lib/google-ads-api-tracker.ts`
- `src/app/api/google-ads/credentials/route.ts`
- `src/app/(app)/settings/page.tsx`
- `src/components/dashboard/ApiQuotaChart.tsx`（无需修改，自动使用新的配额值）

## 注意事项

- 默认情况下，所有用户的访问级别为 `explorer`
- 用户需要手动在设置页面选择正确的访问级别
- 访问级别的选择不会影响实际的 API 权限，仅用于正确显示配额上限
- 如果用户的 Developer Token 权限发生变化，需要在设置页面重新选择对应的访问级别
