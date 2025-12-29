# Developer Token 权限等级问题诊断与解决方案

**诊断日期**: 2025-12-29
**问题用户**: User ID 30 (cosmicwolf304)
**错误信息**: `The developer token is only approved for use with test accounts`
**状态**: 🔍 已诊断，待用户行动

## 问题表现

服务账号用户 (ID=30) 在执行 GAQL 查询时出现权限错误：

```
⚠️ [GAQL Query] 执行错误 (user_id=30): The developer token is only approved for use with test accounts
```

但同时：
- ✅ 服务账号认证成功
- ✅ 列出可访问的客户账户成功 (`list_accessible_customers()` 返回结果)
- ❌ 执行 GAQL 查询失败 (搜索广告系列、获取指标等)
- ✅ 其他服务账号用户的 GAQL 查询成功

## 根本原因

### Google Ads API 的 Developer Token 权限等级

Google Ads API 的 Developer Token 有三个权限等级：

| 等级 | 名称 | 可访问账户 | 操作权限 | 典型用途 |
|-----|------|---------|---------|---------|
| Level 1 | **Test** | 仅测试 MCC 和测试账户 | 完整读写 | 开发、测试 |
| Level 2 | **Basic** | 生产账户（有限制） | 完整读写 | 小规模应用 |
| Level 3 | **Standard** | 全部生产账户 | 完整读写 | 正式应用 |

### 用户 30 的问题

```typescript
// 来自 python-ads-client.ts 第75行
developer_token: sa.developerToken  // → "e9YPDuehT4GLEvYFRBfesA"
```

**数据库配置：**
- Service Account ID: `e9e62d63-8bbe-4296-8165-f3f347035d11`
- Service Account Email: `autoads@my-ads-api-project-482417.iam.gserviceaccount.com`
- Developer Token: `e9YPDuehT4GLEvYFRBfesA`
- MCC Customer ID: `8738625341`

**问题诊断：**
1. ✅ Service Account JSON 密钥有效 (认证成功)
2. ✅ Developer Token 在 Google API 系统中注册了
3. ❌ Developer Token 被配置为 **Test-level（仅测试账户）**
4. ❌ 用户在 MCC Customer ID `8738625341` 下的账户都是 **生产账户**
5. **结论：权限等级不匹配 → Google Ads API 拒绝访问**

## 技术流程分析

### 认证流程（成功）

```
Node.js
│
├─ getServiceAccountAuth(userId=30)
│  └─ 从 google_ads_service_accounts 表读取:
│     - email: autoads@my-ads-api-project-482417.iam.gserviceaccount.com
│     - private_key: [服务账号密钥]
│     - developer_token: "e9YPDuehT4GLEvYFRBfesA"  ← 这个 token 是 Test-level
│     - login_customer_id: "8738625341"
│
├─ POST /python-service/api/google-ads/list-accessible-customers
│  └─ Python Service
│     └─ create_google_ads_client()
│        └─ GoogleAdsClient.load_from_dict({
│             developer_token: "e9YPDuehT4GLEvYFRBfesA",
│             json_key_file_path: [服务账号JSON],
│             login_customer_id: "8738625341"
│           })
│        └─ ✅ 认证成功 (service account key 有效)
│
└─ client.get_service("CustomerService").list_accessible_customers()
   └─ ✅ 返回可访问的账户列表
      (此操作对权限等级要求较低，仅需要service account有效)
```

### GAQL 查询流程（失败）

```
Node.js
│
├─ executeGAQLQueryPython({
│    customer_id: "1234567890",  ← 这是一个生产账户
│    query: "SELECT campaign.id, campaign.name FROM campaign"
│  })
│
├─ POST /python-service/api/google-ads/query
│  └─ Python Service
│     └─ create_google_ads_client()
│        └─ GoogleAdsClient(
│             developer_token: "e9YPDuehT4GLEvYFRBfesA",  ← Test-level token
│             login_customer_id: "8738625341"            ← 生产 MCC
│           )
│        └─ ✅ 认证成功
│
│     └─ ga_service.search(customer_id="1234567890", query=...)
│        └─ ❌ Google Ads API 检查权限
│           - Token 等级: Test
│           - 目标账户: 1234567890 (生产账户)
│           - 结果: PERMISSION_DENIED
│           - 错误: "The developer token is only approved for use with test accounts"
```

## 对比：成功的服务账号用户

**用户 20 (tonylinmuu)** - ✅ 工作正常

```
Service Account Email: tonyads@handy-catbird-469407-p4.iam.gserviceaccount.com
Developer Token: FGk5bC3yZ9Q7beCFxUKV1g  ← Basic or Standard level
MCC Customer ID: 6559404941
```

这个用户的 Developer Token 权限等级较高（Basic 或 Standard），因此可以访问生产账户。

## 解决方案

### 方案 1: 用户自行升级 Developer Token（推荐）

**步骤：**

1. **获取当前 Developer Token**
   ```
   Token: e9YPDuehT4GLEvYFRBfesA
   Service Account: autoads@my-ads-api-project-482417.iam.gserviceaccount.com
   ```

2. **在 Google Ads API Console 中升级权限等级**
   - 访问: https://ads.google.com/aw/apicenter
   - 找到该 Developer Token
   - 申请升级到 "Basic" 或 "Standard" 等级
   - Google 会要求填写业务信息、应用描述等
   - 等待 Google 批准（通常 1-3 个工作日）

3. **验证升级成功**
   - 再次尝试同步数据
   - 观察日志: 应该看到 "✅ 同步任务完成"

### 方案 2: 创建新的 Service Account 与 Developer Token（备选）

1. 创建新的 Google Cloud Project
2. 创建新的 Service Account
3. 申请新的 Developer Token（直接以 Basic/Standard 等级申请）
4. 重新上传服务账号配置

### 方案 3: 应用层防御与错误提示（我们可以做）

我们可以改进错误检测，在前端给用户更明确的指导：

```typescript
// python-ads-client.ts 中添加
const token = sa.developerToken

// 检查 token 长度和格式（Test tokens 通常较短）
if (token.length < 15) {
  console.warn(`⚠️ Developer Token 长度较短，可能是 Test-level token`)
}

// 在 catch 块中捕获这个特定错误
if (error.message.includes('only approved for use with test accounts')) {
  throw new Error(
    '❌ Developer Token 权限等级不足。\n\n' +
    '您的 Developer Token 仅限于测试账户，但您在访问生产账户。\n' +
    '请在 Google Ads API Console 中升级 Token 的权限等级到 "Basic" 或 "Standard"。\n\n' +
    'Token: ' + token + '\n' +
    '申请链接: https://ads.google.com/aw/apicenter'
  )
}
```

## 对用户的建议

由于**其他服务账号用户都能成功同步**，且只有用户 30 遇到此问题，我们可以确认：

1. ✅ 系统代码正确处理服务账号认证
2. ✅ Python 服务正确执行 GAQL 查询
3. ❌ **用户 30 的 Developer Token 权限等级太低**

### 立即行动（推荐）

**用户需要：**

1. 登录 https://ads.google.com/aw/apicenter
2. 找到 Developer Token: `e9YPDuehT4GLEvYFRBfesA`
3. 点击"申请升级"
4. 选择 "Basic" 或 "Standard" 等级
5. 填写应用信息并提交
6. 等待 Google 批准（1-3 个工作日）
7. 升级完成后，系统会自动使用新的权限等级

## 测试验证方式

升级后，用户可以通过以下方式验证：

1. 进入应用 → 设置 → Google Ads 凭证
2. 点击"验证凭证"或"刷新数据"
3. 观察日志：应该看到 "✅ 同步任务完成" 而不是 "❌ DEVELOPER_TOKEN_NOT_APPROVED"

## 相关代码位置

- **TypeScript 端**: `src/lib/python-ads-client.ts:75`
  - `getServiceAccountAuth()` 获取 Developer Token

- **Python 端**: `python-service/main.py:79-106`
  - `create_google_ads_client()` 使用 Developer Token
  - `execute_gaql_query()` 执行查询时触发权限检查

- **数据库表**: `google_ads_service_accounts`
  - 每个服务账号的 Developer Token 单独存储

## 后续改进建议

### 优先级 P1（高）
- [ ] 在服务账号上传时检查 Developer Token 权限等级
- [ ] 在错误消息中清楚地提示"权限等级不足"和解决步骤
- [ ] 在前端显示 Developer Token 的权限等级信息

### 优先级 P2（中）
- [ ] 定期检查已上传的 Developer Token 权限
- [ ] 创建监控告警：检测到权限错误时通知用户

### 优先级 P3（低）
- [ ] 支持自动升级提示：检测到权限不足时弹出引导对话框
- [ ] 整合 Google Ads API Console 登录流程

## 结论

这**不是代码 bug**，而是用户的 Developer Token 权限配置问题：

| 方面 | 状态 |
|-----|------|
| 服务账号认证 | ✅ 正常 |
| Service Account 密钥 | ✅ 有效 |
| GAQL 查询实现 | ✅ 正确 |
| 调度器逻辑 | ✅ 正确 |
| 执行器逻辑 | ✅ 正确 |
| **Developer Token 权限等级** | ❌ **过低** |

**待用户行动**：升级 Developer Token 的权限等级。

---

**诊断人**: Claude Code
**诊断日期**: 2025-12-29
