# Google Ads API 访问级别自动检测 - 完整方案

## 问题分析

原始问题：Dashboard页面的"API配额使用"固定显示2,880次/天（Explorer权限），无法区分用户的实际权限级别。

进一步分析发现：
1. **权限会变化**：用户的Developer Token权限可能从Test升级到Explorer或Basic
2. **Test权限特殊**：Test权限只能访问测试账号，生产环境配额应为0
3. **手动配置不可靠**：要求用户手动选择权限级别容易出错且不能及时反映权限变化

## 最终解决方案：自动检测

### 1. 支持的权限级别

| 级别 | 每日配额 | 说明 |
|------|---------|------|
| **Test** | 0次 | 仅限测试账号，无法访问生产账号 |
| **Explorer** | 2,880次 | 默认权限，适合测试和小规模使用 |
| **Basic** | 15,000次 | 需申请审核，适合生产环境 |

### 2. 自动检测机制

#### 检测时机
系统在以下情况自动检测并更新API访问级别：

1. **验证凭证时**：用户在设置页面点击"验证凭证"
2. **API调用失败时**：任何Google Ads API调用失败时，从错误消息中检测
3. **记录API使用时**：每次记录API使用统计时检查错误消息

#### 检测方法

**方法1：错误模式匹配**（最可靠）
```typescript
// Test权限特征
"only approved for use with test accounts"
"developer token is only approved for test"

// Explorer权限特征
"apply for basic" || "apply for standard"
```

**方法2：API调用测试**
- 尝试调用 `listAccessibleCustomers()` API
- 成功 → 至少是Explorer权限
- 失败 → 从错误消息中检测

### 3. 数据库更改

#### 迁移文件
- `migrations/205_update_api_access_level_add_test.sql`
- `pg-migrations/205_update_api_access_level_add_test.pg.sql`

#### 字段更新
```sql
-- 支持三种权限级别
api_access_level TEXT DEFAULT 'explorer'
CHECK (api_access_level IN ('test', 'explorer', 'basic'))
```

### 4. 核心代码

#### 检测器模块
`src/lib/google-ads-access-level-detector.ts`
- `detectApiAccessLevel()` - 主动检测
- `detectLevelFromError()` - 从错误消息检测
- `autoDetectAndUpdateAccessLevel()` - 自动检测并更新
- `detectAndUpdateFromError()` - 从错误快速更新

#### 配额计算
`src/lib/google-ads-api-tracker.ts`
```typescript
const QUOTA_LIMITS = {
  test: 0,        // Test权限配额为0
  explorer: 2880,
  basic: 15000,
}
```

#### API追踪增强
在 `trackApiUsage()` 中自动检测：
```typescript
// 如果API调用失败且有错误消息，尝试检测访问级别
if (!record.isSuccess && record.errorMessage) {
  await detectAndUpdateFromError(userId, authType, errorMessage)
}
```

### 5. UI显示

#### 设置页面
- **移除**：手动选择按钮
- **新增**：三个只读卡片显示当前检测到的级别
- **特殊提示**：Test权限时显示红色警告，引导用户升级

#### Dashboard页面
- 无需修改，自动使用检测到的配额上限
- Test权限显示0次/天
- Explorer显示2,880次/天
- Basic显示15,000次/天

### 6. 工作流程

```
用户配置凭证
    ↓
点击"验证凭证"
    ↓
系统调用Google Ads API
    ↓
自动检测访问级别 ← 从API响应或错误消息
    ↓
更新数据库中的api_access_level
    ↓
Dashboard自动显示正确的配额上限
    ↓
后续API调用失败时
    ↓
再次检测并更新（权限可能已变化）
```

### 7. 优势

1. **自动化**：无需用户手动配置
2. **实时性**：权限变化时自动更新
3. **准确性**：基于实际API响应，不会出错
4. **容错性**：多个检测时机，确保及时更新
5. **用户友好**：Test权限时明确提示升级路径

## 文件清单

### 新增文件
- `src/lib/google-ads-access-level-detector.ts` - 访问级别检测器
- `migrations/205_update_api_access_level_add_test.sql` - 数据库迁移
- `pg-migrations/205_update_api_access_level_add_test.pg.sql` - PostgreSQL迁移
- `SETTINGS_PAGE_UPDATE_INSTRUCTIONS.md` - UI更新说明

### 修改文件
- `src/lib/google-ads-api-tracker.ts` - 添加test权限支持，API追踪时自动检测
- `src/app/api/google-ads/credentials/route.ts` - GET返回apiAccessLevel，PATCH支持test
- `src/app/api/google-ads/credentials/verify/route.ts` - 验证时自动检测
- `src/app/(app)/settings/page.tsx` - UI改为只读显示（需手动更新）

## 测试验证

### 场景1：Test权限用户
1. 配置Test权限的Developer Token
2. 验证凭证 → 系统检测到test级别
3. Dashboard显示配额上限：0次/天
4. 设置页面显示红色Test卡片，提示升级

### 场景2：权限升级
1. 用户在Google Ads API Center申请升级到Basic
2. 审核通过后，下次验证凭证或API调用
3. 系统自动检测到basic级别
4. Dashboard配额上限自动更新为15,000次/天

### 场景3：API调用失败
1. 用户使用Test权限访问生产账号
2. API返回"only approved for test accounts"错误
3. 系统自动从错误消息检测到test级别
4. 立即更新数据库，Dashboard显示正确配额

## 注意事项

1. **默认值**：新用户默认为explorer权限
2. **向后兼容**：已有用户的配额设置保持不变
3. **手动覆盖**：保留PATCH API，允许管理员手动设置（如需要）
4. **性能影响**：检测逻辑异步执行，不影响主流程
5. **错误处理**：检测失败不影响正常功能，使用默认值

## 部署步骤

1. ✅ 运行数据库迁移：`npm run db:migrate`
2. ⚠️ 手动更新设置页面UI（参考 SETTINGS_PAGE_UPDATE_INSTRUCTIONS.md）
3. ✅ 重启应用
4. ✅ 测试验证凭证功能
5. ✅ 检查Dashboard配额显示

## 后续优化建议

1. **主动检测**：定期（如每天）自动检测所有用户的访问级别
2. **通知机制**：权限升级时通知用户
3. **统计分析**：记录权限级别分布，帮助用户升级决策
4. **缓存优化**：缓存检测结果，减少API调用
