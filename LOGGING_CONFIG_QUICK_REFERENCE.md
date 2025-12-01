# 项目日志配置路径和内容快速查看指南

## 所有相关配置文件路径

### Nginx 相关
- **配置文件**: `/Users/jason/Documents/Kiro/autobb/nginx.conf`
  - error_log: `/dev/stderr` ✅
  - access_log: `/dev/stdout` ✅

### Supervisord 相关
- **单容器配置** (✅ 推荐): `/Users/jason/Documents/Kiro/autobb/supervisord.conf`
  - 输出: `/dev/stdout` 和 `/dev/stderr` ✅
  
- **多容器配置** (❌ 有问题): `/Users/jason/Documents/Kiro/autobb/supervisord.docker.conf`
  - 输出: `/app/logs/` ❌ 应该改为stdout/stderr

### Docker 相关
- **单容器Dockerfile**: `/Users/jason/Documents/Kiro/autobb/Dockerfile.single`
  - 使用: `supervisord.conf` ✅

- **多容器Dockerfile** (❌ 有问题): `/Users/jason/Documents/Kiro/autobb/Dockerfile`
  - 使用: `supervisord.docker.conf` ❌
  - 应该改为: `supervisord.conf`

- **生产Dockerfile** (❌ 有问题): `/Users/jason/Documents/Kiro/autobb/Dockerfile.prod`
  - 使用: `supervisord.docker.conf` ❌
  - 应该改为: `supervisord.conf`

- **Docker Compose 单容器**: `/Users/jason/Documents/Kiro/autobb/docker-compose.single.yml`
  - 缺少日志配置 ❌

- **Docker Compose 多容器**: `/Users/jason/Documents/Kiro/autobb/docker-compose.prod.yml`
  - 缺少日志配置 ❌

### Next.js/Node.js 应用相关
- **Scheduler**: `/Users/jason/Documents/Kiro/autobb/src/scheduler.ts`
  - 日志方式: console.log/console.error ✅
  - 缺少: 结构化日志库 ⚠️

- **Next.js 配置**: `/Users/jason/Documents/Kiro/autobb/next.config.js`
  - 缺少: 日志相关配置 (正常，使用默认console)

## 日志配置快速检查

### 命令行检查

```bash
# 检查nginx日志配置
grep -E "error_log|access_log" /Users/jason/Documents/Kiro/autobb/nginx.conf

# 检查supervisord.conf (正确配置)
grep -E "logfile|stdout|stderr" /Users/jason/Documents/Kiro/autobb/supervisord.conf

# 检查supervisord.docker.conf (错误配置)
grep -E "logfile|stdout|stderr" /Users/jason/Documents/Kiro/autobb/supervisord.docker.conf

# 检查Dockerfile使用的supervisord配置
grep "supervisord\." /Users/jason/Documents/Kiro/autobb/Dockerfile

# 检查Docker Compose日志配置
grep -i "logging" /Users/jason/Documents/Kiro/autobb/docker-compose*.yml
```

## 关键数据对比表

| 配置文件 | 类型 | error_log | stdout | stderr | 文件日志 | 状态 |
|---------|------|-----------|--------|--------|---------|------|
| nginx.conf | Nginx | /dev/stderr | - | - | 无 | ✅ |
| supervisord.conf | Supervisord | info | /dev/stdout | /dev/stderr | 无 | ✅ |
| supervisord.docker.conf | Supervisord | info | /app/logs/web-*.log | /app/logs/*-error.log | 有 | ❌ |
| Dockerfile.single | Docker | - | 使用supervisord.conf | - | - | ✅ |
| Dockerfile | Docker | - | 使用supervisord.docker.conf | - | - | ❌ |
| Dockerfile.prod | Docker | - | 使用supervisord.docker.conf | - | - | ❌ |
| docker-compose.single.yml | Compose | - | - | - | 无配置 | ❌ |
| docker-compose.prod.yml | Compose | - | - | - | 无配置 | ❌ |
| scheduler.ts | App | - | console.log | console.error | 无 | ⚠️ |

## 问题症状和根本原因

### 现象1: `docker logs <container>` 无法显示日志

**根本原因**: Dockerfile/Dockerfile.prod 使用了 supervisord.docker.conf  
**日志位置**: 被写入容器内 `/app/logs/` 目录  
**解决方案**: 修改Dockerfile，使用 supervisord.conf

### 现象2: 容器重启后日志丢失

**根本原因**: 日志存储在容器临时文件系统，重启后消失  
**文件位置**: `/app/logs/web-*.log`、`/app/logs/scheduler-*.log`  
**解决方案**: 改用stdout/stderr，或挂载持久化日志卷

### 现象3: 日志文件持续增长占用磁盘

**根本原因**: supervisord.docker.conf 中日志大小有限制(50MB/10MB)但无滚动清理  
**影响**: Docker层存储空间会逐渐填满  
**解决方案**: 改用stdout/stderr，或添加Docker日志驱动

### 现象4: 无法通过 docker logs 读取应用日志

**根本原因**: 所有日志都写入文件，不输出到stdout/stderr  
**影响**: Docker日志驱动无法捕获  
**解决方案**: 所有进程都应输出到 /dev/stdout 和 /dev/stderr

## 文件修改检查清单

- [ ] 修改 `Dockerfile`: 第93行 `supervisord.docker.conf` → `supervisord.conf`
- [ ] 修改 `Dockerfile.prod`: 同上
- [ ] 添加 `docker-compose.single.yml`: logging 驱动配置
- [ ] 添加 `docker-compose.prod.yml`: logging 驱动配置
- [ ] 验证 supervisord.conf 内容（不需要修改）
- [ ] 保留 supervisord.docker.conf 供参考或重命名为 supervisord.docker.conf.bak

## 推荐的Docker日志驱动配置

```yaml
services:
  app:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"      # 单个日志文件最大10MB
        max-file: "3"        # 最多保留3个日志文件
        labels: "service=autoads"
```

或使用其他日志驱动:
- `awslogs`: AWS CloudWatch
- `gcplogs`: Google Cloud Logging
- `splunk`: Splunk日志平台
- `syslog`: 系统日志

## 相关文档

- [Docker 日志驱动官方文档](https://docs.docker.com/config/containers/logging/configure/)
- [Supervisord 日志配置](http://supervisord.org/logging.html)
- [Nginx 日志模块](https://nginx.org/en/docs/http/ngx_http_log_module.html)
- [Node.js 最佳实践 - 日志](https://nodejs.org/en/docs/guides/nodejs-logging-best-practices/)

