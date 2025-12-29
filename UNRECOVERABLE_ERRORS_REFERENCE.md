# 不可恢复错误参考列表

用于日志分类和问题诊断

## 不可恢复的错误关键字 (直接失败，不重试)

### 配置相关 🔧
- `未配置`
- `未配置完整`
- `缺少`
- `缺失`
- 示例: "用户(ID=24)未配置完整的 Google Ads 凭证"
- 示例: "缺少 refresh_token"

### 权限/认证 🔐
- `权限`
- `认证`
- `授权`
- `unauthorized`
- `forbidden`
- `credential`
- 示例: "权限不足"
- 示例: "认证失败"

### 资源问题 ❌
- `不存在`
- `找不到`
- `not found`
- 示例: "资源不存在"
- 示例: "找不到用户"

### 无效参数 ⚠️
- `无效的`
- `invalid`
- `required`
- `missing`
- `config`
- 示例: "无效的参数"
- 示例: "必需参数缺失"

---

## 可恢复的错误关键字 (会执行重试)

### 网络问题 🌐
- `超时`
- `timeout`
- `ECONNREFUSED`
- `ENOTFOUND`
- 示例: "Connection timeout"
- 示例: "网络连接超时"

### 临时故障 ⏳
- `暂时`
- `temporarily`
- `unavailable`
- 示例: "Service temporarily unavailable"
- 示例: "临时服务故障"

### 数据库连接 🗄️
- `connection failed` (但需不含 config/credential 字样)
- 示例: "Database connection failed"

### 限流 📊
- `429`
- `Too many requests`
- 示例: "429 Too Many Requests"

---

## 如何添加新的错误模式

编辑 `src/lib/queue/unified-queue-manager.ts` 中的 `isRecoverableError()` 方法：

```typescript
private isRecoverableError(error: any): boolean {
  const errorMessage = error?.message || String(error)
  const nonRecoverablePatterns = [
    // 现有模式...
    '你的新模式',  // 描述
  ]
  // ...
}
```

然后在测试文件中添加对应的测试用例。

---

## 日志示例

### ✅ 正确处理（配置缺失）
```
❌ 任务失败: xxx-xxx-xxx: 用户(ID=24)未配置完整的 Google Ads 凭证。
⚠️ 不可恢复的错误，不再重试: xxx-xxx-xxx
```

### ✅ 正确处理（网络问题）
```
❌ 任务失败: yyy-yyy-yyy: Connection timeout
🔄 任务重试 (1/3): yyy-yyy-yyy
```

### ❌ 错误处理（配置缺失却重试）
```
❌ 任务失败: zzz-zzz-zzz: 用户(ID=24)未配置完整的 Google Ads 凭证。
🔄 任务重试 (1/3): zzz-zzz-zzz  ← 浪费时间和资源！
```
