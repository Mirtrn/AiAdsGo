# 🚨 立即安全行动指南

**警告**: 检测到严重安全漏洞！请立即采取以下行动。

---

## ⚡ 5分钟紧急修复

### 1. 立即更改管理员密码（最高优先级）

```bash
# 如果你的生产环境正在运行，立即登录并更改密码：

# 方式一：通过Web界面
# 1. 登录 https://your-production-domain.com
# 2. 进入设置 → 修改密码
# 3. 使用强随机密码（至少32字符）

# 方式二：通过数据库直接更新
# PostgreSQL:
psql $DATABASE_URL -c "UPDATE users SET password_hash = crypt('NEW_SECURE_PASSWORD', gen_salt('bf')) WHERE username = 'autoads';"

# SQLite:
sqlite3 data/autoads.db "UPDATE users SET password_hash = '[bcrypt_hash_here]' WHERE username = 'autoads';"
```

### 2. 立即更新 .gitignore

```bash
# 防止未来泄露
cat >> .gitignore << 'EOF'

# 数据库文件和备份（紧急添加）
data/*.db
data/*.db.backup*
data/*.sqlite
data/*.sqlite.backup*
*.backup
*.dump
*.sql.gz

# 确保敏感文件不被提交
secrets/
*.pem
*.key
*.cert
EOF

git add .gitignore
git commit -m "security: 添加数据库文件到 .gitignore"
```

### 3. 从当前提交中删除数据库备份

```bash
# 从Git追踪中移除但保留本地文件
git rm --cached data/autoads.db.backup-20251122-163632
git rm --cached data/autoads.db.backup-fk-constraint-20251122-170239

git commit -m "security: 从版本控制中移除数据库备份文件"
git push origin main
```

---

## 📋 24小时内完成的任务

### [ ] 任务1: 清理Git历史中的敏感文件

**工具**: git-filter-repo（推荐）或 BFG Repo-Cleaner

```bash
# 安装 git-filter-repo
pip install git-filter-repo

# 备份仓库
cd /Users/jason/Documents/Kiro
cp -r autobb autobb-backup-$(date +%Y%m%d)

# 清理数据库备份文件
cd autobb
git filter-repo --path data/autoads.db.backup-20251122-163632 --invert-paths --force
git filter-repo --path data/autoads.db.backup-fk-constraint-20251122-170239 --invert-paths --force

# 强制推送（警告：重写历史）
git push --force --all origin
git push --force --tags origin
```

**注意事项**:
- ⚠️ 这将重写Git历史
- ⚠️ 所有协作者需要重新克隆仓库
- ⚠️ Pull requests可能需要重新创建

### [ ] 任务2: 审查并轮换API密钥

检查数据库备份中是否包含真实的API密钥：

```bash
# 下载已泄露的数据库备份（从GitHub）
# 检查settings表

sqlite3 data/autoads.db.backup-20251122-163632 << 'EOF'
SELECT category, key, value FROM settings
WHERE key LIKE '%api_key%'
   OR key LIKE '%token%'
   OR key LIKE '%secret%'
   OR key LIKE '%password%';
EOF
```

**如果发现真实密钥，立即轮换**:

1. **Google Ads API**:
   - 访问 https://console.cloud.google.com
   - 撤销现有 Refresh Token
   - 重新授权生成新 Token

2. **Gemini API**:
   - 访问 https://makersuite.google.com/app/apikey
   - 删除旧密钥
   - 生成新密钥

3. **Google OAuth Client Secret**:
   - 评估风险
   - 必要时重新生成

### [ ] 任务3: 修改代码使用环境变量

创建 `src/lib/db-init.ts` 的安全版本：

```typescript
// ❌ 删除硬编码密码
const DEFAULT_ADMIN = {
  username: 'autoads',
  password: '***REMOVED***',  // ← 删除这行
}

// ✅ 改为使用环境变量
const DEFAULT_ADMIN = {
  username: process.env.DEFAULT_ADMIN_USERNAME || 'autoads',
  password: process.env.DEFAULT_ADMIN_PASSWORD || generateSecurePassword(),
  email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@autoads.com',
  display_name: 'AutoAds Administrator',
  role: 'admin',
  package_type: 'lifetime',
  package_expires_at: '2099-12-31T23:59:59.000Z',
}

function generateSecurePassword(): string {
  const crypto = require('crypto')
  return crypto.randomBytes(32).toString('base64')
}
```

更新 `.env.production.example`:

```bash
# 添加到 .env.production.example
DEFAULT_ADMIN_USERNAME=autoads
DEFAULT_ADMIN_PASSWORD=请设置强随机密码（至少32字符）
DEFAULT_ADMIN_EMAIL=admin@yourdomain.com
```

### [ ] 任务4: 清理文档中的敏感信息

```bash
# 查找所有包含密码的文档
FILES=$(git grep -l "K\$j6z\!9Tq@P2w#aR" -- "*.md")

# 逐个文件替换
for file in $FILES; do
  sed -i.bak 's/K\$j6z\!9Tq@P2w#aR/[已隐藏-请查阅 .env.production]/g' "$file"
  rm "${file}.bak"
done

# 提交更改
git add .
git commit -m "security: 从文档中移除硬编码密码"
git push origin main
```

---

## 🔐 设置密码管理器（推荐）

### 选项1: 1Password（推荐）

```bash
# 安装 1Password CLI
brew install --cask 1password-cli

# 创建 vault
op vault create "AutoAds Production Secrets"

# 存储密码
op item create \
  --vault "AutoAds Production Secrets" \
  --category login \
  --title "AutoAds Admin Account" \
  username=autoads \
  password=[your-new-secure-password]

# 存储 API 密钥
op item create \
  --vault "AutoAds Production Secrets" \
  --category "API Credential" \
  --title "Google Ads API" \
  api_key=[your-api-key]
```

### 选项2: Bitwarden（开源）

```bash
# 安装 Bitwarden CLI
npm install -g @bitwarden/cli

# 登录
bw login

# 创建项目
bw create item '{
  "organizationId": null,
  "folderId": null,
  "type": 1,
  "name": "AutoAds Admin",
  "notes": "Production admin account",
  "login": {
    "username": "autoads",
    "password": "[your-new-secure-password]"
  }
}'
```

---

## 📊 验证清单

完成以下检查以确认安全修复：

### 立即验证（5分钟内）

- [ ] 管理员密码已更改
- [ ] .gitignore 已更新
- [ ] 数据库备份已从当前提交移除
- [ ] 更改已推送到GitHub

### 短期验证（24小时内）

- [ ] Git历史已清理（数据库文件）
- [ ] API密钥已审查
- [ ] 需要轮换的密钥已更换
- [ ] 代码中的硬编码密码已移除
- [ ] 文档中的敏感信息已清理
- [ ] 新密码已存储到密码管理器

### 长期验证（1周内）

- [ ] Git pre-commit hook已安装
- [ ] GitHub Secret Scanning已启用
- [ ] 团队已接受安全培训
- [ ] 密钥轮换计划已制定

---

## 🆘 如果需要帮助

### 紧急情况
如果你怀疑账号已被入侵：

1. **立即禁用账号**:
   ```sql
   UPDATE users SET is_active = FALSE WHERE username = 'autoads';
   ```

2. **检查访问日志**:
   ```bash
   # 检查近期登录
   tail -1000 /var/log/nginx/access.log | grep "POST /api/auth/login"
   ```

3. **联系安全团队**

### 常见问题

**Q: 强制推送会影响什么？**
A: 会重写Git历史。所有协作者需要重新克隆仓库，未合并的分支可能需要重建。

**Q: 如何生成强密码？**
A: 使用以下命令：
```bash
openssl rand -base64 32
```

**Q: 数据库备份已被下载怎么办？**
A: 假设最坏情况，轮换所有可能泄露的凭证。

---

## 📞 获取支持

- **详细安全审计报告**: `claudedocs/SECURITY_AUDIT_REPORT.md`
- **安全问题**: 创建私密GitHub issue
- **紧急情况**: 联系系统管理员

---

**最后更新**: 2025-11-23
**下次审计**: 2025-11-24（修复验证）
