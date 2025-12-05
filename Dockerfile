# syntax=docker/dockerfile:1
# 单容器部署 - AutoAds with Nginx + Next.js + Scheduler
# 使用supervisord管理所有进程，对外只暴露80端口

# ============================================
# Stage 1: 依赖阶段
# ============================================
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production && \
    npm cache clean --force

# ============================================
# Stage 2: 构建阶段
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# 安装所有依赖（包括devDependencies）
COPY package.json package-lock.json ./
RUN npm ci

# 复制源代码
COPY . .

# Next.js环境变量
ENV NEXT_TELEMETRY_DISABLED=1

# 构建Next.js应用
RUN npm run build

# 构建调度器
RUN node build-scheduler.js

# ============================================
# Stage 3: 生产运行阶段（单容器）
# ============================================
FROM node:20-alpine AS runner

WORKDIR /app

# 安装Nginx和Supervisor
RUN apk add --no-cache \
    nginx \
    supervisor \
    tzdata && \
    rm -rf /var/cache/apk/*

# 设置时区为上海
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 设置生产环境
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 创建非root用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 复制Nginx配置
COPY --chown=root:root nginx.conf /etc/nginx/nginx.conf

# 复制Supervisord配置
COPY --chown=root:root supervisord.conf /etc/supervisord.conf

# 复制Next.js standalone输出
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 复制打包后的调度器
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist

# 复制数据库迁移文件（初始化需要）
COPY --from=builder --chown=nextjs:nodejs /app/migrations ./migrations
COPY --from=builder --chown=nextjs:nodejs /app/pg-migrations ./pg-migrations

# 复制启动脚本
COPY --from=builder --chown=root:root /app/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 复制生产依赖（调度器需要better-sqlite3等原生模块）
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# 创建必要的目录
RUN mkdir -p /var/log/nginx /var/lib/nginx/tmp /var/run && \
    chown -R nginx:nginx /var/log/nginx /var/lib/nginx /var/run && \
    chown -R nextjs:nodejs /app

# 暴露80端口（Nginx）
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD wget --no-verbose --tries=1 --spider http://localhost/api/health || exit 1

# 使用入口脚本启动（先初始化数据库，再启动supervisord）
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
