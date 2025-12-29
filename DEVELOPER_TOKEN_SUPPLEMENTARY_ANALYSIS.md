# Developer Token 权限问题 - 追加分析与新发现

**分析日期**: 2025-12-29
**原始问题**: User 30 报告 DEVELOPER_TOKEN_NOT_APPROVED 错误
**新发现**: 数据库日志显示用户 30 已成功执行 72 次 GAQL 查询

---

## 关键发现

### 数据库中的实际情况

从 `google_ads_api_usage` 表查询，**用户 30 实际上 100% 成功率**:

```sql
user_id | operation_type | endpoint              | success | fail | success_rate
--------|----------------|-----------------------|---------|------|-------------
   30   | search         | /api/google-ads/query |    72   |  0   |  100.00%
   30   | search         | getAccountInfo        |    36   |  0   |  100.00%
```

**总共 108 次 API 调用，全部成功 ✅**

### 查询的客户 ID

```
用户 30 的 MCC Customer ID: 8738625341
API 调用的 Customer ID: 8738625341
```

**都是在 MCC ID 本身上执行查询 ✅**

### 最后一次成功调用

```
时间: 2025-12-29 03:52:01 UTC
操作: GAQL 查询 (search)
端点: /api/google-ads/query
结果: ✅ 成功
错误信息: （无）
```

---

## 问题分析

### 假设 1: 权限等级确实有限制

如果用户 30 的 Developer Token 是 **Test-level**（仅限测试账户），那么：

```
预期行为:
- 在 MCC 8738625341 上查询 ❌ 应该失败
- 在生产账户上查询 ❌ 应该失败
- 在官方测试账户上查询 ✅ 应该成功

实际行为:
- 在 MCC 8738625341 上查询 ✅ 全部成功（72 次）
- 错误: "only approved for use with test accounts"
```

### 假设 2: MCC 8738625341 可能被配置为测试账户

```
根据 Google Ads API 的权限模型：
- 如果 MCC 8738625341 是官方的测试 MCC
- 那么 Test-level token 可以访问
- 用户 30 的 72 次成功查询 ✅ 解释通了

但是：
- 用户报告错误: "only approved for use with test accounts"
- 这意味着他们在查询一个非测试账户
```

### 最可能的情况 🎯

用户 30 报告的错误**来自一个不同的客户 ID**，而不是 8738625341：

```
已成功查询的客户:
  └─ 8738625341 (MCC 本身) ✅

可能报告错误的客户:
  └─ 其他客户 ID (生产账户?) ❌
```

---

## 对比: 所有服务账号用户的成功率

```sql
user_id | username        | success_count | fail_count | success_rate | token_length
--------|-----------------|---------------|------------|--------------|-------------
  30    | cosmicwolf304   |     108       |      0     |   100.00%    |     22 chars
  33    | king00227       |      45       |      0     |   100.00%    |     22 chars
  22    | sharpantelope733|      66       |      5     |    92.96%    |     22 chars
  25    | mightywolf505   |     269       |     40     |    87.06%    |     22 chars
  11    | michelle0318    |     249       |     77     |    76.38%    |     22 chars
  20    | tonylinmuu      |     153       |     84     |    64.56%    |     22 chars
  23    | weiqi19920212   |     410       |    269     |    60.38%    |     22 chars
  24    | leiqian1990     |      91       |     72     |    55.83%    |     22 chars
```

### 关键观察 🔍

1. **所有 Developer Token 长度都是 22 字符**
   - 用户 30: `e9YPDuehT4GLEvYFRBfesA` (22 chars)
   - 用户 20: `FGk5bC3yZ9Q7beCFxUKV1g` (22 chars)
   - 所有其他: 都是 22 chars

   **结论**: 长度 22 字符并不一定意味着是 Test-level 🚨
   （需要修改之前的启发式检查）

2. **用户 30 和 33 都是 100% 成功率**
   - 用户 30: 108/108 成功
   - 用户 33: 45/45 成功
   - 都是最高的成功率

3. **所有用户都在成功使用 Google Ads API**
   - 没有用户显示 0% 成功率
   - 即使成功率最低的用户 24 也有 55.83% 成功率

---

## 错误的真正来源

基于数据，用户 30 报告的错误可能来自：

### 可能性 1: 多个 Customer ID

用户可能在尝试查询多个广告账户，而不仅仅是 MCC ID：

```
用户已成功查询:
  ✅ Customer ID: 8738625341 (MCC 本身)

用户可能尝试查询但失败:
  ❌ Customer ID: 1234567890 (子账户？)
  ❌ Customer ID: 9876543210 (子账户？)
  ...
```

这种情况下，Google Ads API 会区分：
- 在 Test MCC 内的操作 → Test-level token ✅
- 在 Test MCC 外的操作 → Test-level token ❌

### 可能性 2: API 调用的类型差异

不同的 API 操作可能有不同的权限要求：

```
list_accessible_customers():
  ├─ 权限要求: 最低
  └─ ✅ Test token 可以执行

execute_gaql_query("campaign"):
  ├─ 权限要求: 取决于查询的客户
  ├─ 在 MCC ID 上 → ✅ 可能成功
  └─ 在生产子账户上 → ❌ 失败

create_campaign_budget():
  ├─ 权限要求: 较高
  └─ 可能在子账户上 ❌ 失败
```

### 可能性 3: 最近的权限变更

Google 可能在 2025-12-29 进行了权限审查，导致新错误出现：

```
时间线:
  2025-12-24 ~ 2025-12-28: 用户 30 成功执行 72 次查询
  2025-12-29 03:00 ~ 03:52: 继续成功执行查询（数据库显示）
  2025-12-29 (具体时间?): 用户报告新的错误

可能原因:
  - Google Ads API 权限审查
  - 账户状态变更
  - 访问日期限制
```

---

## 建议的调查步骤

### 第 1 步: 向用户收集更多信息 (优先级 P0)

问题清单：

1. **确切的错误时间**
   - 什么时间收到的错误？
   - 是否是近期才出现？

2. **错误涉及的 Customer ID**
   - 是否在 MCC ID (8738625341) 上发生？
   - 还是在其他客户 ID 上？

3. **正在尝试的操作**
   - 是列表操作？
   - 是 GAQL 查询？
   - 是创建/修改操作？

4. **错误的完整堆栈**
   - 从应用日志导出完整的错误信息
   - 包括 Python 服务的日志

### 第 2 步: 检查 Python 服务日志 (优先级 P1)

检查 Python 服务是否捕获了此错误：

```bash
# 查看 Python 服务最近的日志
grep -i "user_id=30" /path/to/python-service/logs/
grep -i "developer_token\|only approved\|test account" /path/to/logs/

# 或者访问应用的日志查询页面
```

### 第 3 步: 验证 MCC 的账户类型 (优先级 P1)

确认 MCC 8738625341 是否被 Google 标记为：
- 测试账户 (Test)
- 生产账户 (Production)

方法：
1. 在 Google Ads API Console 中查看账户设置
2. 检查账户标签和权限配置

### 第 4 步: 收集 Customer ID 列表 (优先级 P1)

```sql
-- 查询用户 30 在系统中配置的所有 customer IDs
SELECT * FROM campaigns WHERE user_id = 30 AND customer_id IS NOT NULL;
SELECT * FROM offers WHERE user_id = 30 LIMIT 10;
```

---

## 关键问题要点

| 问题 | 证据 | 结论 |
|-----|------|------|
| 用户 30 的 Token 是否真的是 Test-level? | ❓ Token 长度 22 字符不是指标 | 需要向 Google API Console 确认 |
| 用户是否真的无法同步数据? | ✅ API 日志显示 100% 成功 | 可能是部分客户 ID 失败 |
| 所有服务账号用户都能成功使用吗? | ✅ 所有 8 个用户都有成功记录 | 是的，包括用户 30 本人 |
| 权限错误是否立即发生? | ❓ 用户 30 最后一次成功调用在 03:52 | 需要确认具体错误时间 |

---

## 修改之前启发式验证的问题

我之前在代码中添加的启发式检查有问题：

```typescript
if (token.length < 15) {
  warnings.push('⚠️ Developer Token 长度较短（< 15 字符），可能是 Test-level token。')
}
```

**问题**: 所有生产环境的 Developer Token 都是 22 字符，包括：
- Test-level tokens: 22 chars
- Basic/Standard tokens: 22 chars

**修复建议**:
- ❌ 不能根据长度判断权限等级
- ✅ 应该根据 Google API 返回的实际权限响应判断
- ✅ 或者让用户在上传时明确声明权限等级

---

## 更新的诊断结论

基于数据库实际情况的修正：

### 原来的诊断（可能不完全准确）
```
问题: Developer Token 权限等级太低 (Test-level)
原因: 用户上传了 Test-level token
解决方案: 升级 token 到 Basic/Standard 级别
```

### 更新的诊断（更准确）
```
问题可能不是权限等级，而是：
  1. 用户在访问与 MCC 不同的客户 ID
  2. 该客户 ID 不被允许用 Test-level token 访问
  3. 或者最近 Google 改变了权限配置

根据:
  • 用户 30 已成功执行 72 次 GAQL 查询
  • 所有查询都在 MCC 8738625341 上
  • 最后一次查询时间: 2025-12-29 03:52:01 UTC

建议:
  1. ✅ 应用层防御仍然有价值（改进错误消息）
  2. ⚠️ 但不要盲目建议用户升级 token
  3. 🔍 先收集更多信息了解真实错误来源
```

---

## 待续调查

需要向用户（或其他相关人员）收集：

1. [ ] 完整的错误日志和时间戳
2. [ ] 涉及的 Customer ID
3. [ ] 用户最近做了什么操作（什么改变了？）
4. [ ] Python 服务的详细日志

---

**分析人**: Claude Code
**分析日期**: 2025-12-29 (补充)
**状态**: 🔍 需要进一步调查
