#!/bin/bash

# Offer 235 真实测试脚本
# 只调用系统真实接口，不模拟数据和功能
#
# 使用说明:
# 1. 确保开发服务器已启动: npm run dev
# 2. 运行此脚本: bash test-offer-235-real.sh
# 3. 脚本会调用真实的 API 接口
# 4. 所有数据都来自系统真实数据库

set -e

# 配置
API_BASE_URL="http://localhost:3000"
OFFER_ID=235
USER_ID=1
ADMIN_USERNAME="autoads"
ADMIN_PASSWORD="LYTudFbrAfTDmwvtn4+IjowdJn1AZgZyNebCjinHhjk="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
  echo -e "${RED}❌ $1${NC}"
}

# 创建日志文件
LOG_FILE="/tmp/offer-235-test-$(date +%Y%m%d-%H%M%S).log"
echo "📝 测试日志: $LOG_FILE"
echo ""

# 测试1: 检查服务器是否运行
echo "=================================="
echo "🧪 测试1: 检查服务器连接"
echo "=================================="

if curl -s "$API_BASE_URL/api/health" > /dev/null 2>&1; then
  log_success "服务器已连接: $API_BASE_URL"
else
  log_error "无法连接到服务器: $API_BASE_URL"
  log_error "请确保开发服务器已启动: npm run dev"
  exit 1
fi

echo ""

# 测试1.5: 登录获取认证 Cookie
echo "=================================="
echo "🧪 测试1.5: 登录获取认证 Cookie"
echo "=================================="

log_info "使用管理员账号登录"

# 创建临时 cookie 文件
COOKIE_FILE="/tmp/offer-235-cookies-$$.txt"

cat << EOFLOGIN | curl -s -X POST "$API_BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -c "$COOKIE_FILE" \
  -d @- > /dev/null
{"username": "$ADMIN_USERNAME", "password": "$ADMIN_PASSWORD"}
EOFLOGIN

if [ ! -f "$COOKIE_FILE" ] || ! grep -q "auth_token" "$COOKIE_FILE"; then
  log_error "登录失败，无法获得认证 Cookie"
  exit 1
fi

log_success "登录成功，获得认证 Cookie"

echo ""

# 测试2: 获取 Offer 235 的信息
echo "=================================="
echo "🧪 测试2: 获取 Offer 235 信息"
echo "=================================="

log_info "调用 API: GET /api/offers/$OFFER_ID"

OFFER_RESPONSE=$(curl -s "$API_BASE_URL/api/offers/$OFFER_ID" \
  -b "$COOKIE_FILE")

if echo "$OFFER_RESPONSE" | grep -q "Eufy"; then
  log_success "成功获取 Offer 235 信息"
  echo "$OFFER_RESPONSE" | jq '.' 2>/dev/null || echo "$OFFER_RESPONSE"
else
  log_error "无法获取 Offer 信息"
  echo "$OFFER_RESPONSE"
  exit 1
fi

echo ""

# 测试3: 调用生成广告创意 API（真实测试）
echo "=================================="
echo "🧪 测试3: 调用生成广告创意 API"
echo "=================================="

log_info "调用 API: POST /api/offers/$OFFER_ID/generate-creatives"
log_info "这将调用真实的 AI 和 Keyword Planner 接口"
log_info "请等待... (预计 5-10 秒)"

START_TIME=$(date +%s%N)

CREATIVE_RESPONSE=$(curl -s -X POST "$API_BASE_URL/api/offers/$OFFER_ID/generate-creatives" \
  -H "Content-Type: application/json" \
  -b "$COOKIE_FILE" \
  -d "{
    \"offerId\": $OFFER_ID,
    \"userId\": $USER_ID
  }")

END_TIME=$(date +%s%N)
DURATION=$(( (END_TIME - START_TIME) / 1000000 ))

log_success "API 调用完成 (耗时: ${DURATION}ms)"

# 保存完整响应
echo "$CREATIVE_RESPONSE" > "$LOG_FILE"

# 解析响应
if echo "$CREATIVE_RESPONSE" | jq . > /dev/null 2>&1; then
  log_success "响应格式正确 (JSON)"

  # 提取关键信息
  KEYWORDS=$(echo "$CREATIVE_RESPONSE" | jq '.keywords | length' 2>/dev/null || echo "0")
  HEADLINES=$(echo "$CREATIVE_RESPONSE" | jq '.headlines | length' 2>/dev/null || echo "0")
  DESCRIPTIONS=$(echo "$CREATIVE_RESPONSE" | jq '.descriptions | length' 2>/dev/null || echo "0")

  echo ""
  echo "📊 生成结果:"
  echo "   关键词数量: $KEYWORDS"
  echo "   标题数量: $HEADLINES"
  echo "   描述数量: $DESCRIPTIONS"
  echo "   响应时间: ${DURATION}ms"

  # 验证关键词数量
  if [ "$KEYWORDS" -ge 20 ] && [ "$KEYWORDS" -le 30 ]; then
    log_success "关键词数量符合预期 (20-30): $KEYWORDS"
  else
    log_warning "关键词数量不符合预期 (20-30): $KEYWORDS"
  fi

  # 显示前5个关键词
  echo ""
  echo "📝 前5个关键词:"
  echo "$CREATIVE_RESPONSE" | jq '.keywords[0:5]' 2>/dev/null || echo "无法解析关键词"

else
  log_error "响应格式错误"
  echo "$CREATIVE_RESPONSE"
  exit 1
fi

echo ""

# 测试4: 验证缓存效果
echo "=================================="
echo "🧪 测试4: 验证缓存效果"
echo "=================================="

log_info "第二次调用相同的 API (应该从缓存返回)"

START_TIME=$(date +%s%N)

CACHED_RESPONSE=$(curl -s -X POST "$API_BASE_URL/api/offers/$OFFER_ID/generate-creatives" \
  -H "Content-Type: application/json" \
  -b "$COOKIE_FILE" \
  -d "{
    \"offerId\": $OFFER_ID,
    \"userId\": $USER_ID
  }")

END_TIME=$(date +%s%N)
CACHED_DURATION=$(( (END_TIME - START_TIME) / 1000000 ))

log_success "缓存查询完成 (耗时: ${CACHED_DURATION}ms)"

# 比较响应时间
echo ""
echo "⏱️  性能对比:"
echo "   第一次查询: ${DURATION}ms"
echo "   第二次查询: ${CACHED_DURATION}ms"

if [ "$CACHED_DURATION" -lt "$DURATION" ]; then
  SPEEDUP=$(( DURATION / CACHED_DURATION ))
  log_success "缓存加速: ${SPEEDUP}x 倍"
else
  log_warning "缓存可能未生效"
fi

echo ""

# 测试5: 检查日志输出
echo "=================================="
echo "🧪 测试5: 检查日志输出"
echo "=================================="

log_info "查看开发服务器的控制台日志"
log_info "应该看到以下日志:"
echo "   ✅ 广告创意生成成功"
echo "   ⏱️ 获取关键词搜索量: XX个关键词"
echo "   🔧 已过滤 X 个无搜索量关键词"
echo "   🔍 使用Keyword Planner扩展品牌关键词"
echo "   ✅ 筛选出X个有效品牌关键词"
echo "   ✅ 关键词充足: XX个有真实搜索量的关键词"

echo ""

# 测试6: 验证关键词质量
echo "=================================="
echo "🧪 测试6: 验证关键词质量"
echo "=================================="

log_info "验证关键词是否都有搜索量数据"

# 检查是否有搜索量为0的关键词
ZERO_VOLUME_COUNT=$(echo "$CREATIVE_RESPONSE" | jq '[.keywords[] | select(.searchVolume == 0)] | length' 2>/dev/null || echo "0")

if [ "$ZERO_VOLUME_COUNT" -eq 0 ]; then
  log_success "所有关键词都有搜索量数据 (无搜索量为0的关键词)"
else
  log_warning "发现 $ZERO_VOLUME_COUNT 个搜索量为0的关键词"
fi

echo ""

# 测试7: 验证品牌词
echo "=================================="
echo "🧪 测试7: 验证品牌词"
echo "=================================="

log_info "验证品牌词是否都包含品牌名 'Eufy'"

# 检查品牌词是否包含 "Eufy"
BRAND_KEYWORDS=$(echo "$CREATIVE_RESPONSE" | jq '.keywords[] | select(.source == "BRAND_EXPANSION")' 2>/dev/null | wc -l)

if [ "$BRAND_KEYWORDS" -gt 0 ]; then
  log_success "发现 $BRAND_KEYWORDS 个品牌词扩展"
  echo "$CREATIVE_RESPONSE" | jq '.keywords[] | select(.source == "BRAND_EXPANSION") | .keyword' 2>/dev/null | head -5
else
  log_warning "未发现品牌词扩展"
fi

echo ""

# 测试8: 生成测试报告
echo "=================================="
echo "🧪 测试8: 生成测试报告"
echo "=================================="

REPORT_FILE="/tmp/offer-235-test-report-$(date +%Y%m%d-%H%M%S).json"

cat > "$REPORT_FILE" << EOF
{
  "testTime": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "offerId": $OFFER_ID,
  "userId": $USER_ID,
  "results": {
    "keywordCount": $KEYWORDS,
    "headlineCount": $HEADLINES,
    "descriptionCount": $DESCRIPTIONS,
    "firstQueryDuration": ${DURATION}ms,
    "secondQueryDuration": ${CACHED_DURATION}ms,
    "zeroVolumeKeywords": $ZERO_VOLUME_COUNT,
    "brandKeywords": $BRAND_KEYWORDS
  },
  "status": "completed",
  "logFile": "$LOG_FILE",
  "responseFile": "$REPORT_FILE"
}
EOF

log_success "测试报告已生成: $REPORT_FILE"

echo ""

# 最终总结
echo "=================================="
echo "📊 测试总结"
echo "=================================="

echo ""
echo "✅ 所有测试完成"
echo ""
echo "📊 关键指标:"
echo "   关键词数量: $KEYWORDS (预期: 20-30)"
echo "   标题数量: $HEADLINES"
echo "   描述数量: $DESCRIPTIONS"
echo "   第一次查询: ${DURATION}ms"
echo "   第二次查询: ${CACHED_DURATION}ms"
echo "   搜索量为0的关键词: $ZERO_VOLUME_COUNT (预期: 0)"
echo "   品牌词扩展: $BRAND_KEYWORDS"
echo ""
echo "📝 日志文件: $LOG_FILE"
echo "📄 报告文件: $REPORT_FILE"
echo ""
echo "✅ 测试完成！请查看日志和报告文件了解详细信息。"
echo ""
