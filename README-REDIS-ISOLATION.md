# ==========================================
# Redis环境隔离配置说明 (2025-12-10新增)
# ==========================================
#
# 问题背景：
# 开发环境和生产环境共享同一个Redis实例时，存在任务串扰风险
#
# 解决方案：
# 使用环境特定的Redis Key Prefix来隔离不同环境的数据
#
# 配置方法：
# 在 .env 文件中添加以下配置：

# 开发环境 (.env)
REDIS_KEY_PREFIX=autoads:development:queue:

# 生产环境 (.env.production)
REDIS_KEY_PREFIX=autoads:production:queue:

# 预发环境 (.env.staging)
REDIS_KEY_PREFIX=autoads:staging:queue:

# 验证隔离效果：
# npx tsx scripts/verify-redis-isolation.ts
