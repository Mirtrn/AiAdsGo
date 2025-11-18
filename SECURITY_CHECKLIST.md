# 🔒 安全检查清单 - 防止敏感信息泄露

## ⚠️ 重要提醒

**在提交代码到GitHub之前，务必完成以下安全检查！**

---

## 1️⃣ 环境变量文件检查

### ❌ 绝对不能提交的文件：

```bash
.env
.env.local
.env.development
.env.test
.env.production
.env.*.local
```

### ✅ 检查.gitignore是否包含：

```bash
# 查看.gitignore内容
cat .gitignore | grep -E "\.env"

# 应该包含：
# .env
# .env.local
# .env.development.local
# .env.test.local
# .env.production.local
```

### 🔍 检查是否已误提交环境变量文件：

```bash
# 检查Git历史中是否有.env文件
git log --all --full-history -- "*.env*"

# 如果发现有.env文件被提交，需要从历史中删除：
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all
```

---

## 2️⃣ 敏感密钥检查

### ❌ 绝对不能提交的信息：

1. **Google Ads API密钥**:
   - `GOOGLE_ADS_DEVELOPER_TOKEN`
   - `GOOGLE_ADS_CLIENT_ID`
   - `GOOGLE_ADS_CLIENT_SECRET`
   - `GOOGLE_ADS_REFRESH_TOKEN`

2. **AI API密钥**:
   - `GEMINI_API_KEY`
   - `ANTHROPIC_API_KEY`

3. **OAuth密钥**:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `NEXTAUTH_SECRET`

4. **数据库凭证**:
   - 生产环境数据库连接字符串
   - 数据库密码

5. **JWT密钥**:
   - `JWT_SECRET`

### 🔍 扫描代码中的硬编码密钥：

```bash
# 扫描可能的API密钥
grep -r "AIza" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" .
grep -r "sk-ant-" --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" .
grep -r "GOOGLE_ADS_DEVELOPER_TOKEN\s*=\s*['\"]" --include="*.ts" --include="*.js" .

# 如果发现硬编码的密钥，立即删除！
```

---

## 3️⃣ 数据库文件检查

### ❌ 不能提交的数据库文件：

```bash
autoads.db
*.db
*.db-shm
*.db-wal
*.sqlite
*.sqlite3
```

### ✅ 确保.gitignore包含：

```bash
# 数据库文件
*.db
*.db-shm
*.db-wal
*.sqlite
*.sqlite3

# 数据库备份
*.db.bak
backups/
```

### 🔍 检查数据库文件是否被追踪：

```bash
# 查看是否有数据库文件被Git追踪
git ls-files | grep -E "\.(db|sqlite)"

# 如果有，从Git中移除（但保留本地文件）：
git rm --cached autoads.db
```

---

## 4️⃣ 日志和临时文件检查

### ❌ 不能提交的文件：

```bash
*.log
npm-debug.log*
yarn-debug.log*
.npm
.pnpm-debug.log*
```

### ✅ 确保.gitignore包含：

```bash
# 日志文件
*.log
npm-debug.log*
yarn-debug.log*

# 临时文件
.DS_Store
Thumbs.db
*.swp
*.swo
tmp/
temp/
```

---

## 5️⃣ Node_modules和构建产物检查

### ❌ 不能提交的目录：

```bash
node_modules/
.next/
out/
build/
dist/
coverage/
.vercel/
```

### ✅ 确保.gitignore包含：

```bash
# 依赖
node_modules/

# Next.js
.next/
out/

# 构建产物
build/
dist/
```

---

## 6️⃣ GitHub Secrets配置

### ✅ 应该配置在GitHub Secrets中的密钥：

前往：`Settings → Secrets and variables → Actions → New repository secret`

**必需的Secrets**:
```
GOOGLE_ADS_DEVELOPER_TOKEN
GOOGLE_ADS_CLIENT_ID
GOOGLE_ADS_CLIENT_SECRET
GEMINI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
NEXTAUTH_SECRET
JWT_SECRET
NEXT_PUBLIC_GOOGLE_OAUTH_REDIRECT_URI
NEXT_PUBLIC_APP_URL
```

**部署相关Secrets**:
```
SERVER_HOST
SERVER_USER
SSH_PRIVATE_KEY
SERVER_PORT
APP_URL
```

---

## 7️⃣ .env.example模板

### ✅ 提供.env.example示例文件（不含真实值）：

创建`.env.example`文件：

```bash
# ===== Google Ads API =====
GOOGLE_ADS_DEVELOPER_TOKEN=your_developer_token_here
GOOGLE_ADS_CLIENT_ID=your_client_id_here
GOOGLE_ADS_CLIENT_SECRET=your_client_secret_here

# ===== Gemini API =====
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash-exp

# ===== Claude API =====
ANTHROPIC_API_KEY=sk-ant-your_api_key_here
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# ===== OAuth =====
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here

# ===== JWT =====
JWT_SECRET=your_random_secret_here

# ===== Next Auth =====
NEXTAUTH_SECRET=your_nextauth_secret_here
NEXTAUTH_URL=http://localhost:3000

# ===== Frontend =====
NEXT_PUBLIC_GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/oauth/callback
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ===== Node环境 =====
NODE_ENV=development
```

---

## 8️⃣ 提交前最终检查

### 🔍 执行以下命令进行最终检查：

```bash
# 1. 查看即将提交的所有文件
git status

# 2. 查看文件内容变更
git diff

# 3. 检查是否有敏感文件
git ls-files | grep -E "\.(env|db|log)"

# 4. 扫描敏感关键词
git diff --cached | grep -E "(api_key|secret|password|token)" -i

# 5. 确认.gitignore生效
git check-ignore .env
git check-ignore autoads.db
git check-ignore node_modules

# 输出应该显示这些文件被忽略
```

### ✅ 安全提交流程：

```bash
# 1. 添加文件（排除敏感文件）
git add .

# 2. 再次检查状态
git status

# 3. 确认没有敏感文件后提交
git commit -m "feat: your commit message"

# 4. 推送前最后确认
git log -1 --stat

# 5. 推送到远程
git push origin main
```

---

## 9️⃣ 如果已经提交了敏感信息

### ⚠️ 紧急处理步骤：

1. **立即撤销密钥**:
   - 前往Google Cloud Console撤销API密钥
   - 前往Anthropic Console撤销Claude API密钥
   - 重新生成新的密钥

2. **从Git历史中删除敏感文件**:

```bash
# 使用BFG Repo-Cleaner（推荐）
# 1. 安装BFG
brew install bfg  # macOS
# 或从 https://rtyley.github.io/bfg-repo-cleaner/ 下载

# 2. 清理敏感文件
bfg --delete-files .env
bfg --replace-text passwords.txt  # 包含敏感文本的列表

# 3. 清理Git历史
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 4. 强制推送（警告：会覆盖远程历史）
git push --force
```

3. **通知团队成员**:
   - 告知所有团队成员密钥已泄露
   - 要求所有人重新拉取代码

4. **监控异常活动**:
   - 检查API使用日志
   - 查看是否有异常调用

---

## 🔟 最佳实践

### ✅ 长期安全措施：

1. **使用环境变量管理工具**:
   - dotenv (开发环境)
   - GitHub Secrets (CI/CD)
   - AWS Secrets Manager / Google Secret Manager (生产环境)

2. **启用密钥轮换**:
   - 定期更换API密钥（建议每90天）
   - 使用临时Token而非永久密钥

3. **最小权限原则**:
   - API密钥只授予必要的权限
   - 使用只读密钥进行查询操作

4. **代码审查**:
   - Pull Request前进行安全审查
   - 使用自动化工具扫描敏感信息

5. **使用Git Hooks**:

创建`.git/hooks/pre-commit`文件：

```bash
#!/bin/bash

# 检查是否包含敏感关键词
if git diff --cached | grep -E "(api_key|secret|password|AIza|sk-ant-)" -i; then
    echo "⚠️  警告：检测到可能的敏感信息！"
    echo "请检查提交内容，确保没有泄露密钥。"
    exit 1
fi

# 检查是否尝试提交.env文件
if git diff --cached --name-only | grep -E "\.env"; then
    echo "❌ 错误：不能提交.env文件！"
    exit 1
fi

echo "✅ 安全检查通过"
exit 0
```

赋予执行权限：
```bash
chmod +x .git/hooks/pre-commit
```

---

## 📋 提交前检查清单

在每次`git push`前，确认以下所有项：

- [ ] ✅ .env文件已在.gitignore中
- [ ] ✅ 数据库文件已在.gitignore中
- [ ] ✅ node_modules已在.gitignore中
- [ ] ✅ 日志文件已在.gitignore中
- [ ] ✅ 代码中没有硬编码的API密钥
- [ ] ✅ 没有提交真实的数据库文件
- [ ] ✅ GitHub Secrets已正确配置
- [ ] ✅ .env.example已更新但不含真实值
- [ ] ✅ 执行了`git status`和`git diff`检查
- [ ] ✅ 团队成员知晓安全规范

---

## 🆘 紧急联系

如果发现敏感信息泄露：

1. **立即撤销密钥**
2. **联系项目负责人**
3. **执行历史清理**
4. **更新所有密钥**
5. **通知所有团队成员**

---

**安全无小事，谨慎每一次提交！** 🔒

**最后更新**: 2025-11-18
**维护者**: AutoAds 团队
