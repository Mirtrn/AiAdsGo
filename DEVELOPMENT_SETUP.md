# 开发环境搭建指南

本文档详细描述如何在一台新机器上从零开始搭建 AutoAds 开发环境。

---

## 目录

- [前置要求](#前置要求)
- [快速开始](#快速开始)
- [详细步骤](#详细步骤)
- [环境变量配置](#环境变量配置)
- [数据库初始化](#数据库初始化)
- [验证安装](#验证安装)
- [常见问题](#常见问题)

---

## 前置要求

### 必需软件

| 软件 | 最低版本 | 检查命令 |
|------|----------|----------|
| Node.js | 18.0.0 | `node --version` |
| npm | 9.0.0 | `npm --version` |
| Git | 2.0.0 | `git --version` |
| SQLite3 | 3.0.0 | `sqlite3 --version` |

### 安装 Node.js（如未安装）

**macOS（使用 Homebrew）**：
```bash
brew install node
```

**Ubuntu/Debian**：
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Windows**：
从 https://nodejs.org/ 下载 LTS 版本安装。

### 安装 SQLite3（如未安装）

**macOS**：
```bash
brew install sqlite3
```

**Ubuntu/Debian**：
```bash
sudo apt-get install sqlite3
```

**Windows**：
从 https://sqlite.org/download.html 下载并添加到 PATH。

---

## 快速开始

如果你熟悉 Node.js 开发，可以使用以下命令快速启动：

```bash
# 1. 克隆项目
git clone <repository-url> autobb
cd autobb

# 2. 安装依赖
npm install

# 3. 安装 Playwright 浏览器（用于商品抓取）
npx playwright install chromium --with-deps

# 4. 初始化数据库（设置管理员密码）
DEFAULT_ADMIN_PASSWORD="your-strong-password" npm run db:init

# 5. 配置环境变量
cp .env.examplmoxe .env.local
# 编辑 .env.local，至少设置以下两项：
# - JWT_SECRET（64字符十六进制）
#   生成方法: openssl rand -hex 32
# - ENCRYPTION_KEY（64字符十六进制）
#   生成方法: openssl rand -hex 32

# 6. 启动开发服务器
npm run dev
```

访问 http://localhost:3000，使用 `autoads` / `<你设置的密码>` 登录。

---

## 详细步骤

### 步骤 1：克隆项目

```bash
git clone <repository-url> autobb
cd autobb
```

### 步骤 2：安装依赖

```bash
# 安装 npm 依赖
npm install

# 安装 Playwright 浏览器（用于商品抓取功能）
npx playwright install chromium --with-deps
```

这将安装所有必需的 npm 包，包括：
- Next.js 14+（前端框架）
- better-sqlite3（SQLite 数据库驱动）
- bcrypt（密码加密）
- Playwright（浏览器自动化，用于商品抓取）
- 其他依赖...

**关于Playwright浏览器安装**：
- `npm install` 只安装 Playwright npm 包，不会自动下载浏览器
- 需要手动执行 `npx playwright install chromium --with-deps` 下载 Chromium 浏览器（约 500MB）
- 只需执行一次，后续 `npm install` 不会重复下载

> **注意**：
> - 首次安装可能需要 2-5 分钟，取决于网络速度
> - `better-sqlite3` 是原生模块，需要编译。如果遇到编译错误，请确保已安装：
>   - macOS: `xcode-select --install`
>   - Ubuntu: `sudo apt-get install build-essential python3`
>   - Windows: 安装 Visual Studio Build Tools
> - Playwright 浏览器下载需要稳定网络连接，如遇下载失败可重试

### 步骤 3：初始化数据库

```bash
# 设置管理员密码并初始化数据库
DEFAULT_ADMIN_PASSWORD="your-strong-password" npm run db:init
```

这将：
1. 创建 `data/` 目录
2. 创建 SQLite 数据库文件 `data/autoads.db`
3. 执行初始化脚本，创建 40 张表 + 3 个视图
4. 创建管理员账号 `autoads`（密码为您设置的值）

> **重要**：
> - 请记住您设置的 `DEFAULT_ADMIN_PASSWORD`，这将是管理员账号的登录密码
> - 管理员密码可以通过命令行参数传递（如上），也可以在 `.env.local` 中配置（见步骤4）

### 步骤 4：配置环境变量（启动服务器前必需）

```bash
cp .env.example .env.local
```

编辑 `.env.local` 文件，配置必需的环境变量（详见[环境变量配置](#环境变量配置)章节）。

**最小配置**（必需）：
```bash
JWT_SECRET=<64字符十六进制>      # 生成: openssl rand -hex 32
ENCRYPTION_KEY=<64字符十六进制>  # 生成: openssl rand -hex 32
DEFAULT_ADMIN_PASSWORD=<你的密码> # 如果步骤3已通过命令行设置则可省略
```

### 步骤 5：启动开发服务器

```bash
npm run dev
```

服务器启动时会自动：
1. 检查/创建管理员账号 `autoads`
2. 启动 Next.js 开发服务器
3. 监听 http://localhost:3000

---

## 环境变量配置

### 最小化配置（必需）

在 `.env.local` 中至少配置以下变量：

```bash
# ==========================================
# 必需配置
# ==========================================

# JWT 签名密钥（64字符十六进制）
# 生成方法：openssl rand -hex 32
JWT_SECRET=your_random_64_char_hex_secret_here_please_change_in_production

# AES-256 加密密钥（64字符十六进制）
# 生成方法：openssl rand -hex 32
ENCRYPTION_KEY=your_32_byte_hex_encryption_key_here_64_chars

# 管理员密码（用于创建 autoads 管理员账号）
DEFAULT_ADMIN_PASSWORD=your-strong-password-here
```

### 生成密钥的方法

**方法 1：使用 OpenSSL**
```bash
# 生成 JWT_SECRET
openssl rand -hex 32

# 生成 ENCRYPTION_KEY
openssl rand -hex 32
```

**方法 2：使用 Node.js**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**方法 3：在线生成**
访问 https://generate-random.org/api-key-generator 生成 64 字符的十六进制字符串。

### 完整配置（可选）

如需使用完整功能，可配置以下变量：

```bash
# ==========================================
# 应用配置
# ==========================================
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development

# ==========================================
# Google Ads API（如需使用广告功能）
# ==========================================
GOOGLE_ADS_CLIENT_ID=your_client_id
GOOGLE_ADS_CLIENT_SECRET=your_client_secret
GOOGLE_ADS_DEVELOPER_TOKEN=your_developer_token
GOOGLE_ADS_LOGIN_CUSTOMER_ID=your_mcc_account_id

# ==========================================
# AI API（如需使用 AI 创意生成）
# ==========================================
GEMINI_API_KEY=your_gemini_api_key

# ==========================================
# 代理配置（如需使用代理访问 API）
# ==========================================
PROXY_ENABLED=false
PROXY_HOST=
PROXY_PORT=
```

---

## 数据库初始化

### 初始化命令

```bash
# 首次初始化
npm run db:init

# 重置数据库（删除所有数据重新初始化）
npm run db:reset

# 验证数据库结构
npm run validate-schema
```

### 初始化后的数据库内容

| 类型 | 数量 | 说明 |
|------|------|------|
| 表 | 40 | 用户、Offer、广告、性能追踪等 |
| 视图 | 3 | API 使用汇总、产品统计、热门产品 |
| 索引 | 89+ | 性能优化索引 |
| Prompt | 12 | AI 创意生成模板（v3.1 版本） |

### 手动初始化（如 npm 脚本失败）

```bash
mkdir -p data
sqlite3 data/autoads.db < migrations/000_init_schema_consolidated.sqlite.sql
```

---

## 验证安装

### 1. 检查数据库

```bash
# 检查表和视图数量（应为 43）
sqlite3 data/autoads.db ".tables" | wc -w

# 检查 prompt 数量（应为 12）
sqlite3 data/autoads.db "SELECT COUNT(*) FROM prompt_versions;"

# 检查视图是否存在
sqlite3 data/autoads.db ".tables" | grep -E "daily_api|v_phase3|v_top_hot"
```

### 2. 检查管理员账号

启动服务器后，管理员账号会自动创建：

```bash
sqlite3 data/autoads.db "SELECT username, email, role FROM users WHERE username='autoads';"
```

预期输出：
```
autoads|admin@autoads.com|admin
```

### 3. 测试登录

1. 访问 http://localhost:3000
2. 使用以下凭证登录：
   - 用户名：`autoads`
   - 密码：`<你在 DEFAULT_ADMIN_PASSWORD 中设置的密码>`

### 4. 运行类型检查

```bash
npm run type-check
```

应无错误输出。

---

## 常见问题

### Q1: `npm install` 时 better-sqlite3 编译失败

**原因**：缺少 C++ 编译工具。

**解决方案**：

macOS：
```bash
xcode-select --install
```

Ubuntu：
```bash
sudo apt-get install build-essential python3
```

Windows：
```bash
npm install --global windows-build-tools
```

### Q2: `npm run db:init` 报错 "sqlite3: command not found"

**原因**：SQLite3 未安装或未添加到 PATH。

**解决方案**：
```bash
# macOS
brew install sqlite3

# Ubuntu
sudo apt-get install sqlite3
```

### Q3: 启动时报错 "必须设置环境变量 DEFAULT_ADMIN_PASSWORD"

**原因**：未配置管理员密码。

**解决方案**：
在 `.env.local` 中添加：
```bash
DEFAULT_ADMIN_PASSWORD=your-strong-password-here
```

### Q4: 登录时提示 "用户名或密码错误"

**可能原因**：
1. 密码输入错误
2. 管理员账号未创建

**解决方案**：
```bash
# 重新创建管理员账号
DEFAULT_ADMIN_PASSWORD=your-password npx tsx scripts/ensure-admin-account.ts
```

### Q5: 页面显示 "JWT_SECRET is not defined"

**原因**：JWT 密钥未配置。

**解决方案**：
在 `.env.local` 中添加：
```bash
JWT_SECRET=your_random_64_char_hex_secret_here
```

### Q6: 数据库文件损坏或需要重置

**解决方案**：
```bash
# 删除并重新初始化
npm run db:reset
```

### Q7: Offer创建时提示 "Playwright浏览器未安装"

**原因**：未执行 `npx playwright install chromium --with-deps`。

**解决方案**：
```bash
# 安装 Chromium 浏览器及其依赖
npx playwright install chromium --with-deps

# 如果只需要浏览器（不含系统依赖）
npx playwright install chromium
```

**验证安装**：
```bash
# 检查Playwright浏览器是否已安装
npx playwright --version
node -e "require('playwright').chromium.executablePath()" 2>/dev/null && echo "✅ Chromium已安装" || echo "❌ Chromium未安装"
```

### Q8: 为什么不再自动安装Playwright浏览器？

**原因**：
- 避免 Docker 构建时的 postinstall 冲突
- 减少 `npm install` 时的网络下载时间
- 让开发者显式控制浏览器安装时机

**影响**：
- ✅ Docker 构建：Dockerfile 中手动安装，不受影响
- ⚠️ 本地开发：需要手动执行一次 `npx playwright install chromium --with-deps`
- ⚠️ CI/CD：需要在 workflow 中添加 Playwright 安装步骤

---

## 开发命令参考

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 构建生产版本 |
| `npm run start` | 启动生产服务器 |
| `npm run type-check` | TypeScript 类型检查 |
| `npm run lint` | ESLint 代码检查 |
| `npm run db:init` | 初始化数据库 |
| `npm run db:reset` | 重置数据库 |
| `npm run validate-schema` | 验证数据库结构 |

---

## 项目结构概览

```
autobb/
├── src/
│   ├── app/                 # Next.js App Router 页面
│   ├── components/          # React 组件
│   ├── lib/                 # 核心业务逻辑
│   └── types/               # TypeScript 类型定义
├── migrations/              # SQLite 数据库迁移脚本
├── pg-migrations/           # PostgreSQL 数据库迁移脚本
├── scripts/                 # 工具脚本
├── data/                    # SQLite 数据库文件（gitignored）
├── .env.example             # 环境变量示例
├── .env.local               # 本地环境变量（gitignored）
└── package.json             # 项目配置
```

---

## 获取帮助

如遇到问题：
1. 查看本文档的"常见问题"部分
2. 检查 `.env.local` 配置是否正确
3. 查看终端错误日志
4. 提交 Issue 到项目仓库
