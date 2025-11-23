# 🚀 生产环境配置快速参考

## ⚡ 最简配置（8个环境变量）

将以下配置复制到生产服务器的 `.env` 文件：

```bash
# ==========================================
# 必需配置（6项）
# ==========================================

# 1. 应用域名
NEXT_PUBLIC_APP_URL=https://your-domain.com

# 2. 运行环境
NODE_ENV=production

# 3. JWT 认证密钥（64位十六进制）
# 生成: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=生成的64位十六进制字符串

# 4. PostgreSQL 数据库
DATABASE_URL=postgresql://postgres:password@host:5432/autoads

# 5. 数据加密密钥（⚠️ 必须与开发环境完全一致）
ENCRYPTION_KEY=从开发环境复制的32字节十六进制密钥

# 6. Google OAuth 认证
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_client_secret
GOOGLE_REDIRECT_URI=https://your-domain.com/api/auth/google/callback

# ==========================================
# 推荐配置（2项）
# ==========================================

# 7. Redis 缓存（性能优化）
REDIS_URL=redis://default:password@host:6379

# 8. Gemini API（AI 功能备用）
GEMINI_API_KEY=your_gemini_api_key
```

## 📝 配置步骤（5分钟）

### 1️⃣ 生成密钥

```bash
# 生成 JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2️⃣ 获取 ENCRYPTION_KEY（从开发环境）

```bash
# 在开发环境执行
cat .env | grep ENCRYPTION_KEY

# 复制输出值到生产环境（必须完全一致）
```

### 3️⃣ 创建 .env 文件

```bash
# 在生产服务器执行
cd /path/to/autobb
nano .env

# 粘贴上面的配置模板，替换所有占位符
```

### 4️⃣ 验证配置

```bash
# 检查必需变量
node -e "
const required = ['NEXT_PUBLIC_APP_URL', 'DATABASE_URL', 'ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID'];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error('❌ Missing:', missing.join(', '));
  process.exit(1);
}
console.log('✅ Configuration OK');
"

# 测试数据库连接
psql $DATABASE_URL -c "SELECT 1"
```

### 5️⃣ 启动应用

```bash
# 构建
npm run build

# 启动
npm start

# 或使用 PM2
pm2 start npm --name autoads -- start
```

## ⚠️ 关键注意事项

### 🔴 ENCRYPTION_KEY（最重要）

```
❌ 错误做法：
- 重新生成新密钥
- 修改密钥内容
- 使用不同密钥

✅ 正确做法：
- 从开发环境完整复制
- 保持64个字符长度
- 验证：echo -n "$ENCRYPTION_KEY" | wc -c  # 必须输出 64
```

**原因**：管理员配置（AI 凭证、Google Ads API 等）使用此密钥加密，密钥不一致会导致配置无法解密。

### 🔴 DATABASE_URL 格式

```bash
# ✅ 正确格式
postgresql://用户名:密码@主机:端口/数据库名?参数
postgresql://postgres:SecurePass123@db.example.com:5432/autoads?directConnection=true

# ❌ 错误格式
postgres://...      # 协议错误
postgresql://localhost/autoads  # 缺少用户名和密码
```

### 🔴 Google OAuth 回调地址

```bash
# 必须与 Google Cloud Console 中配置的完全一致

# ✅ 正确
GOOGLE_REDIRECT_URI=https://autoads.example.com/api/auth/google/callback

# ❌ 错误
GOOGLE_REDIRECT_URI=https://autoads.example.com/auth/callback  # 路径错误
GOOGLE_REDIRECT_URI=http://autoads.example.com/...  # 协议错误（生产必须用 https）
```

## 🔍 快速验证

### 启动后检查（3个命令）

```bash
# 1. 检查数据库（应显示33个表）
psql $DATABASE_URL -c "\dt" | wc -l

# 2. 检查管理员账号（应显示1行）
psql $DATABASE_URL -c "SELECT username FROM users WHERE role='admin';"

# 3. 测试应用访问（应返回200）
curl -I https://your-domain.com/login
```

### 登录测试

```
URL: https://your-domain.com/login
用户名: autoads
密码: ***REMOVED***

✅ 登录成功 → 配置正确
❌ 登录失败 → 检查数据库初始化日志
```

## 🆘 快速故障排查

### 应用无法启动

```bash
# 检查日志
tail -100 logs/app.log

# 常见错误：
# "connection refused" → 检查 DATABASE_URL
# "Invalid encryption key" → 检查 ENCRYPTION_KEY（必须与开发环境一致）
# "OAuth error" → 检查 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET
```

### 数据库连接失败

```bash
# 测试连接
psql $DATABASE_URL -c "SELECT version();"

# 检查防火墙
telnet db_host db_port

# 检查密码（特殊字符需要 URL 编码）
# 例如：password@123 → password%40123
```

### 管理员配置未导入

```bash
# 检查导出文件是否存在
ls -lh secrets/admin-config-export.json

# 如果不存在，从开发环境传输：
scp user@dev-server:/path/to/autobb/secrets/admin-config-export.json ./secrets/

# 重启应用触发导入
pm2 restart autoads
```

## 📋 配置检查清单

部署前确认：

- [ ] `.env` 文件已创建
- [ ] 所有必需变量已设置（6项）
- [ ] `ENCRYPTION_KEY` 与开发环境一致（64字符）
- [ ] `DATABASE_URL` 连接测试成功
- [ ] Google OAuth 回调地址已在 Console 中配置
- [ ] `secrets/admin-config-export.json` 已传输
- [ ] `.env` 文件权限设置为 600

部署后确认：

- [ ] 应用启动成功（无错误日志）
- [ ] 数据库初始化完成（33个表）
- [ ] 管理员账号可以登录
- [ ] 设置页面显示配置已加载
- [ ] 核心功能可以正常使用

## 📚 完整文档

- **详细配置指南**：[PRODUCTION_ENV_GUIDE.md](./claudedocs/PRODUCTION_ENV_GUIDE.md)
- **迁移完整流程**：[POSTGRESQL_MIGRATION_GUIDE.md](./claudedocs/POSTGRESQL_MIGRATION_GUIDE.md)
- **配置模板**：[.env.production.template](./.env.production.template)

## 🎯 记住这3点

1. **ENCRYPTION_KEY 必须与开发环境一致** - 否则配置无法解密
2. **DATABASE_URL 使用 PostgreSQL** - 不要使用 DATABASE_PATH
3. **GOOGLE_REDIRECT_URI 必须用 HTTPS** - 生产环境安全要求

---

**需要帮助？** 查看 [故障排查文档](./claudedocs/TROUBLESHOOTING.md) 或联系技术支持。
