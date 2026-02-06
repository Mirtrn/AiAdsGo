# 统一队列系统 - 生产环境部署清单

## ✅ 环境变量配置

### 必须配置的环境变量

```env
# Redis配置（已在.env中配置）
REDIS_URL=redis://default:<REDACTED_REDIS_PASSWORD>@<REDACTED_HOST>:32284

# 8C16G 推荐配置（单容器 + supervisord）
QUEUE_GLOBAL_CONCURRENCY=64         # 核心任务全局并发上限
QUEUE_PER_USER_CONCURRENCY=16       # 单用户核心任务并发上限
QUEUE_CLICK_FARM_CONCURRENCY=120    # click-farm 类型并发上限
QUEUE_URL_SWAP_CONCURRENCY=8        # url-swap 类型并发上限
CLICK_FARM_MAX_INFLIGHT=120         # click-farm 实际 HTTP 并发
CLICK_FARM_HEAP_PRESSURE_PCT=88     # heap 超过 88% 时延后调度
QUEUE_MAX_SIZE=20000                # 队列最大长度
QUEUE_TASK_TIMEOUT=900000           # 任务超时时间(ms)
QUEUE_MAX_RETRIES=3                 # 最大重试次数
QUEUE_RETRY_DELAY=5000              # 重试延迟(ms)

# 代理IP池（可选）
PROXY_POOL=host1:port1:user1:pass1,host2:port2:user2:pass2
```

---

## 🚀 部署步骤

### 1. 启动时初始化队列

在应用启动时调用：

```typescript
import { initializeQueue } from '@/lib/queue/init-queue'

// 在应用入口点调用
await initializeQueue()
```

### 2. 验证Redis连接

运行测试脚本：

```bash
npm run test:queue-redis
```

或直接运行：

```bash
npx tsx scripts/test-queue-redis.ts
```

### 3. 检查队列状态

访问管理界面：

```
https://your-domain.com/admin/queue
```

验证：
- ✅ 显示Redis连接状态
- ✅ 显示代理IP池统计
- ✅ 显示任务类型分布
- ✅ 实时监控功能正常

---

## 📊 监控指标

### 关键指标

1. **队列状态**
   - 运行中任务数
   - 队列中任务数
   - 已完成任务数
   - 失败任务数

2. **Redis状态**
   - 连接状态: ✅/❌
   - 存储类型: Redis/内存
   - 持久化: ✅

3. **代理IP池**
   - 代理总数
   - 可用代理数
   - 失败代理数

4. **性能指标**
   - 全局并发利用率
   - 单用户并发利用率
   - 任务平均执行时间

---

## 🔧 队列使用指南

### 添加新任务

```typescript
import { getQueueManager } from '@/lib/queue'

const queue = getQueueManager()

// 1. 注册任务执行器
queue.registerExecutor('scrape', async (task) => {
  // 执行任务逻辑
  return result
})

// 2. 添加任务
await queue.enqueue('scrape', {
  url: 'https://example.com'
}, userId, {
  priority: 'high',
  requireProxy: true // 如果需要代理
})
```

### 任务类型

1. **scrape** - 网页抓取
2. **ai-analysis** - AI分析（Enhanced优化）
3. **sync** - 数据同步
4. **backup** - 数据库备份
5. **email** - 邮件发送
6. **export** - 报表导出

### 优先级

- **high** - 高优先级
- **normal** - 普通优先级（默认）
- **low** - 低优先级

---

## 🚨 故障排除

### Redis连接失败

现象: 控制台显示"Redis连接失败，使用内存队列"

解决:
1. 检查REDIS_URL是否正确
2. 检查网络连通性
3. 检查Redis服务状态
4. 确认凭证正确

### 队列任务堆积

现象: 队列中任务数持续增长

解决:
1. 检查任务执行器是否注册
2. 增加全局并发限制
3. 检查任务是否有死循环
4. 检查代理IP是否可用

### 代理IP全部失效

现象: 代理IP池全部显示为"禁用"

解决:
1. 检查PROXY_POOL配置
2. 更换代理IP
3. 检查网络连通性
4. 手动重置代理状态（重启服务）

---

## 📈 性能优化建议

### 并发配置建议

| CPU核心数 | 全局并发 | 单用户并发 | click-farm并发 |
|-----------|----------|------------|----------------|
| 4核       | 24       | 6          | 40             |
| 8核       | 64       | 16         | 120            |
| 16核+     | 96       | 24         | 180            |

### 代理IP池建议

- 最少配置3个代理IP
- 定期更换代理IP
- 监控代理成功率
- 及时移除失效代理

---

## 🔐 安全注意事项

1. **Redis安全**
   - 使用强密码
   - 启用TLS/SSL
   - 限制访问IP
   - 定期更新凭证

2. **代理IP安全**
   - 不要在代码中硬编码
   - 使用环境变量
   - 定期轮换凭证
   - 监控异常使用

3. **任务数据安全**
   - 敏感数据加密存储
   - 任务数据定期清理
   - 限制任务数据大小
   - 审计任务执行日志

---

## ✅ 部署检查清单

- [ ] 环境变量配置正确
- [ ] Redis连接测试通过
- [ ] 队列初始化成功
- [ ] 管理界面可访问
- [ ] 测试任务执行成功
- [ ] 代理IP池配置正确（如需要）
- [ ] 监控指标显示正常
- [ ] 日志输出正常
- [ ] 性能指标符合预期

---

## 📞 支持

如遇到问题，请检查：
1. 应用日志: `logs/app.log`
2. Redis日志: `logs/redis.log`
3. 队列统计: `/admin/queue`
4. 运行测试: `npm run test:queue-redis`

---

**最后更新**: 2025-12-05
**版本**: v1.0.0
