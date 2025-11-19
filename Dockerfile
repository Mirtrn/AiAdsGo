# syntax=docker/dockerfile:1
FROM node:20-alpine AS base

# ============================================
# Stage 1: 依赖阶段 (Dependencies)
# ============================================
FROM base AS deps

# 安装必要的系统依赖 + supervisor
RUN apk add --no-cache \
    libc6-compat \
    python3 \
    make \
    g++ \
    supervisor

WORKDIR /app

# 只复制依赖清单文件（利用 Docker 层缓存）
COPY package.json package-lock.json ./

# 只安装生产依赖（使用缓存挂载加速）
RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production && \
    npm cache clean --force

# ============================================
# Stage 2: 构建阶段 (Builder)
# ============================================
FROM base AS builder

WORKDIR /app

# 复制生产依赖
COPY --from=deps /app/node_modules ./node_modules

# 复制依赖清单并安装全部依赖（包括 devDependencies）
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# 复制源代码
COPY . .

# Next.js 环境变量（构建时）
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# 执行构建
RUN npm run build

# ============================================
# Stage 3: 生产运行阶段 (Runner)
# ============================================
FROM base AS runner

WORKDIR /app

# 设置生产环境
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV RUN_SYNC_ON_START=false

# 安装运行时依赖：supervisor + tsx
RUN apk add --no-cache supervisor && \
    npm install -g tsx@latest

# 创建非 root 用户（安全最佳实践）
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 创建必要的目录
RUN mkdir -p /app/logs /app/tmp /app/data/backups && \
    chown -R nextjs:nodejs /app/logs /app/tmp /app/data

# 复制生产依赖（scheduler需要用到某些npm包）
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# 复制数据库（如果使用 SQLite）
COPY --chown=nextjs:nodejs autoads.db ./autoads.db 2>/dev/null || :
COPY --chown=nextjs:nodejs data/ ./data/ 2>/dev/null || :

# 复制scripts和scheduler
COPY --chown=nextjs:nodejs scripts/ ./scripts/
COPY --chown=nextjs:nodejs src/scheduler.ts ./src/scheduler.ts
COPY --chown=nextjs:nodejs src/lib/ ./src/lib/

# 复制 Next.js standalone 输出
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 复制supervisord配置
COPY --chown=nextjs:nodejs supervisord.docker.conf ./supervisord.conf

# 确保文件权限正确
RUN chown -R nextjs:nodejs /app && \
    chmod -R 755 /app && \
    chmod 664 /app/autoads.db 2>/dev/null || : && \
    chmod 664 /app/data/database.db 2>/dev/null || :

# 使用非 root 用户运行
USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 使用supervisord启动所有服务
CMD ["/usr/bin/supervisord", "-c", "/app/supervisord.conf", "-n"]
