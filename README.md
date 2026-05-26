# AutoAds - AI-Powered Google Ads Automation Platform

智能化的 Google Ads 广告投放和优化平台，通过 AI 技术自动生成高质量广告创意、深度采集产品数据、优化投放策略，并提供完整的广告生命周期管理。

---

## 📋 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [数据库初始化](#数据库初始化)
- [开发指南](#开发指南)
- [项目结构](#项目结构)
- [环境变量](#环境变量)
- [部署](#部署)

---

## ✨ 功能特性

### 核心功能
- 🤖 **AI 创意生成** - 自动生成 15 条标题和 4 条描述，支持多语言、多 AI 模型
- 🎯 **Launch Score 评分** - 5 维度投放评分系统（关键词、市场契合、着陆页、预算、内容）
- 📊 **性能追踪** - 实时监控广告系列、广告组、关键词性能
- 🔍 **智能优化** - 基于 AI 的优化建议和自动化任务
- 🛡️ **风险预警** - 预算、CPC、CTR 异常自动告警
- 📈 **数据分析** - 完整的性能报表和趋势分析
- 🏭 **策略中心** - AI 驱动的策略推荐和执行追踪

### 数据采集（Stealth Scraper）
- 🕷️ **Playwright 隐身采集** - 反指纹浏览器，支持代理池自动轮换
- 🛒 **Amazon Store 深度采集** - 分类页、产品列表、评论、热度评分
- 🏷️ **单品详情采集** - 标题、价格、图片、A+内容、规格参数、竞品
- ⭐ **评论 AI 分析** - 购买理由、痛点、用户画像、竞品提及提取
- 🔗 **推广链接解析** - Playwright 真实跟随重定向（PartnerBoost / YeahPromos 等）
- 🏪 **独立站采集** - Shopify、通用电商站数据提取
- 🔄 **代理重试机制** - 3 次代理重试 + a-no-js 重试，提升采集成功率

### Google Ads 集成
- 🔗 **API 集成** - 完整的 Google Ads API 集成（OAuth + Service Account 双模式）
- 📤 **批量上传** - 批量创建广告系列、广告组、关键词
- 🔄 **自动同步** - 定时同步性能数据、Search Term 报告
- 💰 **预算管理** - 智能预算分配和 CPC 调整
- 🏷️ **URL Swap** - Final URL 和 Final URL Suffix 批量替换

### 联盟营销（Affiliate）
- 🤝 **多平台同步** - PartnerBoost、YeahPromos 等联盟平台产品同步
- 📦 **产品库管理** - 自动识别 ASIN、价格、佣金、有效期
- 📊 **小时级统计** - 同步运行指标追踪

### OpenClaw 智能代理
- 🤖 **Feishu Bot** - 飞书机器人指令驱动的自动化执行平台
- 📋 **技能系统** - 可扩展的预构建技能库（天气、广告操作等）
- 🔒 **安全防护** - 网关守护 + 租户隔离

### 多 AI 模型支持
- 🧠 **多模型接入** - Gemini、OpenAI、LiteLLM（兼容 OpenAI 协议的任意第三方模型）
- 🔀 **模型热切换** - 运行时切换 AI 模型，无需重启
- 💾 **Token 追踪** - 用量统计和成本监控

---

## 🛠️ 技术栈

### 前端
- **框架**: Next.js 14+ (App Router)
- **语言**: TypeScript
- **UI**: React, Tailwind CSS, shadcn/ui
- **状态管理**: React Context + useState

### 后端
- **运行时**: Node.js 20+
- **数据库（开发）**: SQLite 3.x（better-sqlite3）
- **数据库（生产）**: PostgreSQL 16+（pg）
- **ORM**: 原生 SQL
- **API**: Next.js API Routes
- **队列**: Redis（BullMQ / 自研队列）

### AI 集成
- **多模型支持**: Google Gemini、OpenAI、LiteLLM（兼容 OpenAI API 协议）
- **Prompt 管理**: 数据库驱动的版本化 Prompt 系统
- **用途**: 创意生成、评论分析、关键词扩展、优化建议

### 数据采集
- **引擎**: Playwright（隐身模式 + 反指纹）
- **代理**: 多代理池 + 国家维度路由（kookeey、miyaip 等）
- **解析**: Cheerio（HTML 解析）
- **重试**: 指数退避 + 代理轮换

### 基础设施
- **容器**: Docker + docker-compose
- **Web 服务器**: Nginx（80 端口）
- **缓存**: Redis
- **日志**: 结构化日志 + 审计日志
- **Python 辅助服务**: FastAPI（Google Ads API Python 客户端）

---

## 🚀 快速开始

### 先决条件

```bash
# 需要 Node.js 20+ 和 npm
node --version  # 应 >= 20.0.0
npm --version
```

### 安装和运行

```bash
# 1. 克隆项目
git clone <repository-url>
cd autoads

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入必要的配置

# 4. 初始化数据库（详见下一节）
npm run db:init

# 5. 启动开发服务器
npm run dev
```

访问 http://localhost:3000

---

## 💾 数据库初始化

AutoAds 使用**双数据库架构**：
- **本地开发**: SQLite（轻量级，零配置）
- **生产环境**: PostgreSQL 16+（高性能，可扩展）

### 本地开发（SQLite）

```bash
# 方式1：使用 npm script（推荐）
npm run db:init

# 方式2：手动初始化
mkdir -p data
sqlite3 data/autoads.db < migrations/000_init_schema_consolidated.sqlite.sql
npm run db:migrate
```

#### 验证初始化

```bash
npm run validate-schema

# 或手动检查
sqlite3 data/autoads.db ".tables"
sqlite3 data/autoads.db "SELECT COUNT(*) FROM prompt_versions;"
```

### 生产环境（PostgreSQL）

```bash
# 创建数据库
createdb autoads

# 初始化 Schema
psql autoads < pg-migrations/000_init_schema_consolidated.pg.sql

# 运行增量迁移
DATABASE_URL="postgresql://username:password@host:5432/autoads" npm run db:migrate
```

在 `.env.production` 中设置：
```bash
DATABASE_URL="postgresql://username:password@host:5432/autoads"
```

---

## 👨‍💻 开发指南

### 开发工作流

```bash
# 启动开发服务器（热重载）
npm run dev

# 类型检查
npm run type-check

# 构建生产版本
npm run build

# 运行生产版本（需先构建）
npm start

# 数据库验证
npm run validate-schema
```

### 代码规范

```bash
# 运行 ESLint
npm run lint

# 自动修复
npm run lint:fix
```

---

## 📁 项目结构

```
autoads/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (app)/                    # 主应用路由组（需登录）
│   │   │   ├── dashboard/            # 仪表板
│   │   │   ├── offers/               # Offer 管理（创建/采集/分析）
│   │   │   ├── campaigns/            # 广告系列管理
│   │   │   ├── creatives/            # 广告创意管理
│   │   │   ├── creatives-dashboard/  # 创意总览
│   │   │   ├── analytics/            # 数据分析
│   │   │   ├── launch-score/         # Launch Score 评分
│   │   │   ├── optimization/         # 优化任务
│   │   │   ├── strategy-center/      # 策略中心
│   │   │   ├── risk-alerts/          # 风险预警
│   │   │   ├── url-swap/             # URL Swap 任务
│   │   │   ├── sync/                 # 数据同步
│   │   │   ├── products/             # 联盟产品库
│   │   │   ├── google-ads-accounts/  # Google Ads 账户
│   │   │   ├── click-farm/           # 点击农场管理
│   │   │   ├── openclaw/             # OpenClaw 智能代理
│   │   │   ├── admin/                # 管理员后台
│   │   │   └── settings/             # 系统设置
│   │   └── api/                      # API Routes
│   ├── components/                   # React 通用组件
│   ├── hooks/                        # React 自定义 Hooks
│   └── lib/                          # 核心业务逻辑
│       ├── stealth-scraper/          # Playwright 隐身采集引擎
│       │   ├── core.ts               # 核心采集（单品、懒加载处理）
│       │   ├── amazon-product.ts     # Amazon 单品采集
│       │   ├── amazon-store.ts       # Amazon 店铺深度采集
│       │   ├── browser-stealth.ts    # 隐身浏览器配置
│       │   ├── proxy-utils.ts        # 代理重试工具
│       │   └── types.ts              # 类型定义
│       ├── offer-scraping-core.ts    # 采集总调度（推广链接解析）
│       ├── scraper.ts                # HTTP 采集（Cheerio 解析）
│       ├── review-analyzer.ts        # 评论 AI 分析
│       ├── ad-creative-generator.ts  # AI 创意生成
│       ├── launch-scores.ts          # Launch Score 评分
│       ├── google-ads-api.ts         # Google Ads API 封装
│       ├── google-ads-oauth.ts       # OAuth + Service Account 认证
│       ├── ai-runtime-config.ts      # 多模型 AI 运行时配置
│       ├── litellm.ts                # LiteLLM 集成
│       ├── gemini.ts                 # Gemini 集成
│       ├── keyword-planner.ts        # 关键词规划
│       ├── affiliate-sync-config.ts  # 联盟同步配置
│       ├── affiliate-products.ts     # 联盟产品管理
│       └── proxy/                    # 代理池管理
│           ├── fetch-proxy-ip.ts
│           └── providers/            # 代理供应商（kookeey, miyaip）
├── migrations/                       # SQLite 数据库迁移
├── pg-migrations/                    # PostgreSQL 数据库迁移
├── scripts/                          # 工具脚本
│   ├── do_deploy.sh                  # 一键部署脚本（SSH → 服务器）
│   └── test-*.mjs                    # 采集测试脚本
├── python-service/                   # Python Google Ads 辅助服务（FastAPI）
├── openclaw/                         # OpenClaw 源码
├── openclaw-prebuilt/                # OpenClaw 预构建产物
├── docker-compose.single.yml         # 生产环境 Docker Compose
├── Dockerfile                        # Docker 镜像构建
└── nginx.conf                        # Nginx 配置（80 端口）
```

---

## ⚙️ 环境变量

创建 `.env.local` 文件（开发环境）：

```bash
# 数据库
DATABASE_URL="file:./data/autoads.db"

# JWT 认证
JWT_SECRET="your-jwt-secret"

# Google Ads API
GOOGLE_ADS_DEVELOPER_TOKEN="your-developer-token"
GOOGLE_ADS_CLIENT_ID="your-client-id"
GOOGLE_ADS_CLIENT_SECRET="your-client-secret"
GOOGLE_ADS_REFRESH_TOKEN="your-refresh-token"

# AI 模型（至少配置一个）
GOOGLE_AI_API_KEY="your-gemini-api-key"
# OPENAI_API_KEY="your-openai-api-key"

# Cloudflare Turnstile（人机验证）
NEXT_PUBLIC_TURNSTILE_SITE_KEY="your-site-key"
TURNSTILE_SECRET_KEY="your-secret-key"

# Redis
REDIS_URL="redis://localhost:6379"

# 应用配置
NODE_ENV="development"
PORT=3000
```

生产环境额外配置（`.env`）：

```bash
DATABASE_URL="postgresql://user:password@host:5432/autoads"
NODE_ENV="production"
PORT=80
HOSTNAME=0.0.0.0
TZ=Asia/Shanghai
NEXT_TELEMETRY_DISABLED=1
```

---

## 🚢 部署

### Docker 部署（生产环境）

> ⚠️ **【严重警告】** 生产服务器上**必须**使用 `docker-compose` 启动容器，**绝对禁止**直接使用 `docker run`！
>
> **原因**：`docker-compose.single.yml` 映射的是 `80:80` 端口，Cloudflare 通过 80 端口连接源站。
> 若手动执行 `docker run -p 3000:3000`，80 端口无监听，Cloudflare 立即报 **521 Web server is down**，网站完全无法访问。

#### ✅ 正确做法：使用部署脚本（推荐）

```bash
# 在本地执行，自动 SSH 到服务器并完成全流程部署
bash do_deploy.sh
```

脚本会自动完成：
1. `docker build -t autoads:single .`
2. 停止旧容器
3. `docker-compose -f docker-compose.single.yml up -d`
4. 修复 PostgreSQL 网络连通（防止容器网络隔离）
5. 健康检查 + Python 辅助服务检查
6. 清理旧镜像缓存

#### ✅ 手动部署

```bash
cd /home/ubuntu/autoads
git pull origin main

# 构建镜像
sudo docker build -t autoads:single .

# 停止旧容器
sudo docker stop autoads && sudo docker rm autoads

# 启动（必须用 docker-compose，端口 80:80）
sudo docker compose -f docker-compose.single.yml up -d

# 修复 PostgreSQL 网络（如果 postgres 由其他 compose project 管理）
sudo docker network connect <postgres_network> autoads
```

#### 验证部署

```bash
# 检查容器状态
sudo docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
# 期望输出：autoads   Up N minutes (healthy)   0.0.0.0:80->80/tcp

# 检查 HTTP 响应
curl -o /dev/null -w '%{http_code}' http://localhost:80/
# 期望输出：200
```

#### ❌ 错误做法（绝对禁止，会导致 Cloudflare 521）

```bash
# ❌ 只绑定 3000 端口，80 端口无监听，网站崩溃！
docker run -p 3000:3000 autoads:single
```

### 本地开发

```bash
npm run dev
# 访问 http://localhost:3000
```

---

## 🧪 测试

```bash
# 测试 Amazon 产品采集
node scripts/test-scraper.mjs

# 测试推广链接解析
node scripts/test-partnerboost-url.mjs

# Schema 验证
npm run validate-schema
```

---

## 📖 文档

- [数据库初始化指南](./migrations/DATABASE_INITIALIZATION_GUIDE.md)
- [Docker 部署指南](./docs/deployment/DOCKER_DEPLOY_GUIDE.md)

---

## 📄 许可证

[MIT License](./LICENSE)

---

**版本**: 3.0.0  
**最后更新**: 2026-05-27
