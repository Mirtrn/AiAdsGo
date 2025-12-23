# 代理URL扩展支持 - 实施完成

## 概述

成功扩展了代理系统，支持两种不同的代理格式：
- **IPRocket**: 需要API调用获取代理IP
- **Oxylabs**: 直接从URL解析代理信息

## 支持的代理格式

### 1. IPRocket格式
```typescript
const url = 'https://api.iprocket.io/api?username=X&password=Y&cc=UK|CA|ROW&ips=1&proxyType=http&responseType=txt'
const proxy = await fetchProxyIp(url)
```

### 2. Oxylabs格式（新增）
```typescript
const url = 'https://username:password@pr.oxylabs.io:7777'
const proxy = await fetchProxyIp(url)
```

## 架构设计

### Provider模式
```
src/lib/proxy/providers/
├── base-provider.ts          # 基础Provider接口
├── provider-registry.ts      # Provider注册表（自动路由）
├── iprocket-provider.ts      # IPRocket实现
└── oxylabs-provider.ts       # Oxylabs实现（新增）
```

### 核心组件

#### 1. ProxyProvider接口
```typescript
interface ProxyProvider {
  name: string
  canHandle(url: string): boolean
  validate(url: string): ValidationResult
  extractCredentials(url: string): Promise<ProxyCredentials>
}
```

#### 2. ProviderRegistry（注册表）
- 自动检测URL格式
- 选择合适的Provider
- 支持动态注册新Provider

#### 3. 具体的Provider实现

**IPRocketProvider**
- 处理API调用格式
- 使用Playwright绕过CloudFlare
- 解析响应文本获取代理IP

**OxylabsProvider**（新增）
- 直接解析URL格式
- 无需API调用
- 提取国家代码（如cc-fr）

## 使用方法

### 基本用法
```typescript
import { fetchProxyIp } from '@/lib/proxy/fetch-proxy-ip'

// 自动检测并处理不同格式
const proxy1 = await fetchProxyIp('https://api.iprocket.io/api?...')
const proxy2 = await fetchProxyIp('https://user:pass@pr.oxylabs.io:7777')
```

### 高级配置
```typescript
// 自定义重试次数和健康检查
const proxy = await fetchProxyIp(url, {
  maxRetries: 3,
  skipHealthCheck: false
})
```

## 扩展新代理商

要添加新的代理格式，只需：

1. 创建Provider类
```typescript
export class NewProvider implements ProxyProvider {
  name = 'NewProvider'

  canHandle(url: string): boolean {
    return url.includes('new-provider.com')
  }

  validate(url: string): ValidationResult {
    // 验证逻辑
  }

  async extractCredentials(url: string): Promise<ProxyCredentials> {
    // 提取逻辑
  }
}
```

2. 注册Provider
```typescript
import { ProxyProviderRegistry } from '@/lib/proxy/providers/provider-registry'
import { NewProvider } from './new-provider'

ProxyProviderRegistry.register(new NewProvider())
```

## 测试验证

运行测试：
```bash
npx tsx tests/test-proxy-providers.ts
```

测试结果：
- ✅ Oxylabs Provider: 通过
- ✅ IPRocket Provider: 通过
- ✅ 不支持URL检测: 通过

## 兼容性

- ✅ 向后兼容：现有IPRocket URL无需修改
- ✅ 统一接口：外部调用保持不变
- ✅ 自动路由：无需手动选择Provider
- ✅ 易于扩展：新代理商只需3-5行代码

## 文件变更

### 新增文件
- `src/lib/proxy/providers/base-provider.ts`
- `src/lib/proxy/providers/provider-registry.ts`
- `src/lib/proxy/providers/iprocket-provider.ts`
- `src/lib/proxy/providers/oxylabs-provider.ts`
- `tests/test-proxy-providers.ts`

### 修改文件
- `src/lib/proxy/fetch-proxy-ip.ts` - 使用ProviderRegistry
- `src/lib/proxy/types.ts` - 添加fullAddress字段
- `src/lib/proxy/warm-pool.ts` - 更新导入
- `src/lib/scraper.ts` - 更新导入
- `src/lib/url-resolver-http.ts` - 更新导入
- `src/lib/stealth-scraper/types.ts` - 更新导入

## 性能优化

1. **Oxylabs Provider**: 直接解析URL，无需网络请求，速度极快
2. **IPRocket Provider**: 保持原有的Playwright方案，稳定性高
3. **统一健康检查**: 两种格式使用相同的健康检查机制
4. **自动Provider选择**: Registry缓存策略，最小化性能损失

## 总结

✅ 成功实现多Provider架构
✅ 支持IPRocket和Oxylabs两种格式
✅ 向后兼容现有代码
✅ 易于扩展新代理商
✅ 完整的测试覆盖

实施完成！🎉
