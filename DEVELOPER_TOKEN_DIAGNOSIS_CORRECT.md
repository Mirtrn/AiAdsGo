# Developer Token 认证失败 - 真实诊断

**日期**: 2025-12-30
**错误**: "The developer token is not valid"
**认证模式**: 服务账号 (Service Account)

## 问题分析

错误日志显示：
```
ERROR: The developer token is not valid.
errors { error_code { authentication_error: DEVELOPER_TOKEN_INVALID } }
```

**重要说明**: 这不是权限等级问题（Test-level vs Basic/Standard），而是 Developer Token 本身无法通过 Google 验证。

## Developer Token 在服务账号模式下的要求

### 1. Developer Token 必须来自正确的 Google Ads Manager 账户

- Developer Token 在 Google Ads API Center 中创建
- 必须与您的 MCC Customer ID (`7210771219`) 关联
- **检查方法**:
  1. 登录 https://ads.google.com
  2. 切换到 MCC 账户 `7210771219`
  3. 访问 Tools & Settings → API Center
  4. 确认 Developer Token 存在且状态为 "Active"

### 2. Developer Token 字符串必须完全正确

常见问题：
- ❌ 复制时包含了多余的空格或换行符
- ❌ 只复制了部分字符串
- ❌ Token 包含了不可见字符
- ❌ 数据库存储时被截断

### 3. Google Ads API 必须在正确的 GCP 项目中启用

您的服务账号：`bb-1230@loyal-column-482810-u6.iam.gserviceaccount.com`
GCP 项目：`loyal-column-482810-u6`

**检查清单**:
- [ ] GCP Console → APIs & Services → Enabled APIs
- [ ] 确认 "Google Ads API" 已启用
- [ ] 确认项目 ID 与服务账号一致

### 4. Developer Token 和服务账号必须正确关联

在 Google Ads Manager 账户中：
- [ ] 进入 "访问权限和安全"
- [ ] 确认服务账号邮箱 `bb-1230@loyal-column-482810-u6.iam.gserviceaccount.com` 已添加
- [ ] 权限级别：至少 "标准访问"

## 诊断步骤

### 步骤 1: 重启服务并查看调试日志

我已经添加了详细的调试日志，重启服务后再次尝试：

```bash
# 重启 Python 服务
cd /Users/jason/Documents/Kiro/autobb
docker-compose restart python-ads-service

# 查看日志
docker logs -f python-ads-service
```

重新触发错误，查看日志中的：
- `🔑 Developer Token from DB: xxx... (length: XX)` - 确认 token 长度
- `📧 Service Account Email: xxx` - 确认邮箱
- `🏢 Login Customer ID: xxx` - 确认 MCC ID

**预期 Developer Token 长度**: 22-30 字符（如果长度异常，可能是存储问题）

### 步骤 2: 验证数据库中的 Developer Token

直接查询数据库（生产环境）：

```bash
# 连接到数据库
# 检查 developer_token 的实际值
```

**检查项**:
1. Token 长度是否正常 (22-30 字符)
2. Token 是否包含不可见字符 (ASCII 以外的字符)
3. Token 前后是否有空格

### 步骤 3: 在 Google Ads API Center 重新生成 Token

如果怀疑 Token 有问题，最快的方法是重新生成：

1. 访问 https://ads.google.com/aw/apicenter
2. 切换到 MCC 账户 `7210771219`
3. 如果有旧的 Developer Token：
   - 记录旧 Token（备份）
   - 点击 "撤销"
4. 生成新的 Developer Token
5. **非常小心地复制**（避免多余空格）
6. 更新数据库

### 步骤 4: 测试新的 Developer Token

使用 Python 脚本直接测试（不通过应用）：

```python
from google.ads.googleads.client import GoogleAdsClient
import json
import tempfile

# 服务账号配置
service_account_info = {
    "type": "service_account",
    "client_email": "bb-1230@loyal-column-482810-u6.iam.gserviceaccount.com",
    "private_key": "[从数据库获取]",
    "token_uri": "https://oauth2.googleapis.com/token",
}

# 写入临时文件
with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
    json.dump(service_account_info, f)
    json_key_file_path = f.name

# 创建客户端
client = GoogleAdsClient.load_from_dict({
    "developer_token": "[您的 Developer Token]",  # 替换为实际值
    "use_proto_plus": True,
    "login_customer_id": "7210771219",
    "json_key_file_path": json_key_file_path,
})

# 测试 API 调用
customer_service = client.get_service("CustomerService")
accessible_customers = customer_service.list_accessible_customers()
print("✅ Success! Accessible customers:", accessible_customers.resource_names)
```

**如果测试成功** → Developer Token 本身有效，问题在应用代码
**如果测试失败** → Developer Token 确实无效，需要重新生成

## 可能的根本原因（按概率排序）

### 1. Developer Token 被截断或包含多余字符 ⭐⭐⭐⭐⭐

**症状**: Token 长度不是 22-30 字符

**解决方案**:
- 在 Google Ads API Center 重新复制 Token
- 使用 `trim()` 去除首尾空格
- 直接在数据库中检查 Token 值

### 2. Developer Token 来自错误的 Google Ads 账户 ⭐⭐⭐⭐

**症状**: Token 有效，但与 MCC 账户不匹配

**解决方案**:
- 确认在正确的 MCC 账户 (`7210771219`) 中创建 Token
- 不要使用子账户的 Token

### 3. Developer Token 已被撤销或过期 ⭐⭐⭐

**症状**: Token 之前有效，现在无效

**解决方案**:
- 访问 Google Ads API Center 检查 Token 状态
- 如果状态为 "Revoked"，重新生成

### 4. Google Ads API 未在 GCP 项目中启用 ⭐⭐

**症状**: 所有 API 调用失败，服务账号认证也失败

**解决方案**:
- 访问 GCP Console
- 启用 "Google Ads API"

### 5. 数据库编码问题 ⭐

**症状**: Token 在界面显示正常，但实际存储有问题

**解决方案**:
- 检查数据库字段类型（应为 VARCHAR 或 TEXT）
- 检查数据库字符集（应为 UTF-8）

## 快速修复方案

### 方案 A: 重新生成并配置 Developer Token（推荐）

1. 登录 https://ads.google.com/aw/apicenter
2. 确认当前账户是 MCC `7210771219`
3. 生成新的 Developer Token
4. 仔细复制（建议使用文本编辑器验证）
5. 直接更新数据库（生产环境）
6. 重启服务并测试

### 方案 B: 验证现有配置

1. 查看调试日志确认 Token 长度
2. 如果长度正常，检查 Google Ads API Center 中 Token 状态
3. 如果状态为 Active，检查服务账号权限配置
4. 如果权限正常，使用独立 Python 脚本测试

## 调试日志使用指南

重启服务后，当用户再次尝试访问时，您会看到：

**Node.js 日志**:
```
[User #XX] 🔑 Developer Token from DB: abc1234567... (length: 22)
[User #XX] 📧 Service Account Email: bb-1230@loyal-column-482810-u6.iam.gserviceaccount.com
[User #XX] 🏢 MCC Customer ID: 7210771219
```

**Python 日志**:
```
INFO: 🔑 Developer Token: abc1234567... (length: 22)
INFO: 📧 Service Account Email: bb-1230@loyal-column-482810-u6.iam.gserviceaccount.com
INFO: 🏢 Login Customer ID: 7210771219
```

**比对检查**:
- [ ] 两个日志中的 Token 前缀一致
- [ ] 两个日志中的 Token 长度一致
- [ ] Token 长度在 22-30 字符范围内
- [ ] Service Account Email 一致
- [ ] MCC Customer ID 一致

如果发现不一致 → 数据传递有问题
如果都一致但仍报错 → Developer Token 本身无效

## 下一步行动

1. **立即操作**: 重启服务，查看调试日志中的 Token 长度和前缀
2. **如果 Token 长度异常**: 重新生成并配置 Developer Token
3. **如果 Token 长度正常**: 在 Google Ads API Center 检查 Token 状态
4. **如果 Token 状态为 Active**: 使用独立脚本测试，排除应用代码问题

## 相关文档

- [Google Ads API - Developer Token](https://developers.google.com/google-ads/api/docs/first-call/dev-token)
- [Service Account Authentication](https://developers.google.com/google-ads/api/docs/oauth/service-accounts)
- [Common Authentication Errors](https://developers.google.com/google-ads/api/docs/common-errors#authentication_errors)
