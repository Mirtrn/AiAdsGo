#!/bin/bash

# Prompt版本更新自动化脚本（从数据库导出）
# 用法: ./scripts/update-prompt.sh <prompt_id> <new_version>
# 示例: ./scripts/update-prompt.sh ad_creative_generation v3.0

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 检查参数
if [ "$#" -ne 2 ]; then
    print_error "参数错误"
    echo ""
    echo "用法: $0 <prompt_id> <new_version>"
    echo ""
    echo "参数说明:"
    echo "  prompt_id    - Prompt唯一标识（如: ad_creative_generation）"
    echo "  new_version  - 新版本号（如: v3.0）"
    echo ""
    echo "示例:"
    echo "  $0 ad_creative_generation v3.0"
    echo ""
    echo "工作流程:"
    echo "  1. 从开发环境数据库读取当前活跃的Prompt内容"
    echo "  2. 生成迁移文件（包含完整Prompt内容）"
    echo "  3. Git提交迁移文件"
    echo "  4. 生产环境部署后自动执行迁移"
    exit 1
fi

PROMPT_ID=$1
NEW_VERSION=$2

# 获取脚本所在目录的父目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DB_PATH="${PROJECT_ROOT}/data/autoads.db"
MIGRATIONS_DIR="${PROJECT_ROOT}/migrations"

print_info "开始Prompt迁移文件生成流程..."
echo ""

# 检查数据库是否存在
if [ ! -f "$DB_PATH" ]; then
    print_error "数据库文件不存在: $DB_PATH"
    exit 1
fi

# 检查SQLite是否安装
if ! command -v sqlite3 &> /dev/null; then
    print_error "sqlite3 未安装，请先安装: brew install sqlite3"
    exit 1
fi

print_success "环境检查通过"
echo ""

# 1. 从数据库读取当前活跃的Prompt完整信息
print_info "步骤1: 从数据库读取当前Prompt信息"
CURRENT_INFO=$(sqlite3 "$DB_PATH" "
SELECT
    prompt_id,
    version,
    category,
    name,
    file_path,
    function_name,
    prompt_content,
    description
FROM prompt_versions
WHERE prompt_id = '$PROMPT_ID' AND is_active = 1;
")

if [ -z "$CURRENT_INFO" ]; then
    print_error "Prompt ID '$PROMPT_ID' 不存在或未激活"
    echo ""
    echo "可用的Prompt ID列表:"
    sqlite3 "$DB_PATH" "SELECT prompt_id, version, name FROM prompt_versions WHERE is_active = 1;"
    exit 1
fi

# 解析当前信息
CURRENT_VERSION=$(echo "$CURRENT_INFO" | cut -d'|' -f2)
CATEGORY=$(echo "$CURRENT_INFO" | cut -d'|' -f3)
CURRENT_NAME=$(echo "$CURRENT_INFO" | cut -d'|' -f4)
FILE_PATH=$(echo "$CURRENT_INFO" | cut -d'|' -f5)
FUNCTION_NAME=$(echo "$CURRENT_INFO" | cut -d'|' -f6)
PROMPT_CONTENT=$(echo "$CURRENT_INFO" | cut -d'|' -f7)
DESCRIPTION=$(echo "$CURRENT_INFO" | cut -d'|' -f8)

CONTENT_LENGTH=$(echo -n "$PROMPT_CONTENT" | wc -c | tr -d ' ')

print_success "当前版本: $CURRENT_VERSION"
echo "  类别: $CATEGORY"
echo "  名称: $CURRENT_NAME"
echo "  文件路径: $FILE_PATH"
echo "  函数名: $FUNCTION_NAME"
echo "  内容长度: ${CONTENT_LENGTH} 字符"
echo ""

# 2. 请求用户输入变更说明
print_info "步骤2: 请输入版本变更说明"
echo "请描述此次更新的主要变更（按Enter结束每一行，输入空行结束）:"
echo ""

CHANGE_NOTES=""
CHANGE_COUNT=0
while true; do
    read -p "变更点 $((CHANGE_COUNT + 1)): " line
    if [ -z "$line" ]; then
        break
    fi
    CHANGE_COUNT=$((CHANGE_COUNT + 1))
    CHANGE_NOTES="${CHANGE_NOTES}${CHANGE_COUNT}. ${line}\n"
done

if [ $CHANGE_COUNT -eq 0 ]; then
    print_warning "未输入变更说明，使用默认说明"
    CHANGE_NOTES="1. 更新Prompt内容\n"
fi

echo ""
print_success "变更说明已记录"
echo ""

# 3. 获取下一个迁移文件编号
print_info "步骤3: 生成迁移文件"
LAST_MIGRATION=$(ls -1 "$MIGRATIONS_DIR" | grep -E '^[0-9]{3}_.*\.sql$' | grep -v '\.pg\.sql$' | tail -1)
if [ -z "$LAST_MIGRATION" ]; then
    NEXT_NUMBER="001"
else
    LAST_NUMBER=$(echo "$LAST_MIGRATION" | sed 's/^\([0-9]*\).*/\1/')
    NEXT_NUMBER=$(printf "%03d" $((10#$LAST_NUMBER + 1)))
fi

MIGRATION_FILENAME="${NEXT_NUMBER}_update_$(echo $PROMPT_ID | tr '_' '-')_${NEW_VERSION}.sql"
MIGRATION_PATH="${MIGRATIONS_DIR}/${MIGRATION_FILENAME}"

print_success "迁移文件名: $MIGRATION_FILENAME"
echo ""

# 4. 生成迁移文件内容
print_info "步骤4: 生成迁移SQL（从数据库导出内容）"

# 转义Prompt内容中的单引号
ESCAPED_CONTENT=$(echo "$PROMPT_CONTENT" | sed "s/'/''/g")

# 生成新名称
NEW_NAME="${CURRENT_NAME%%v*}${NEW_VERSION}"

cat > "$MIGRATION_PATH" << EOF
-- Migration: ${NEXT_NUMBER}_update_$(echo $PROMPT_ID | tr '_' '-')_${NEW_VERSION}
-- Description: 更新 ${PROMPT_ID} 到 ${NEW_VERSION} 版本
-- Created: $(date +%Y-%m-%d)

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = '$PROMPT_ID' AND is_active = 1;

-- 2. 插入新版本（内容从开发环境数据库导出）
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  '$PROMPT_ID',
  '$NEW_VERSION',
  '$CATEGORY',
  '$NEW_NAME',
  '$DESCRIPTION',
  '$FILE_PATH',
  '$FUNCTION_NAME',
  '$ESCAPED_CONTENT',
  'Chinese',
  1,
  '
$NEW_VERSION 更新内容:
$(echo -e "$CHANGE_NOTES")
'
);
EOF

print_success "迁移文件已生成: $MIGRATION_PATH"
echo ""

# 5. 预览迁移文件
print_info "步骤5: 预览迁移文件（前30行）"
echo "----------------------------------------"
head -30 "$MIGRATION_PATH"
echo "..."
echo "----------------------------------------"
echo ""

# 6. 显示内容统计
MIGRATION_LINES=$(wc -l < "$MIGRATION_PATH" | tr -d ' ')
MIGRATION_SIZE=$(ls -lh "$MIGRATION_PATH" | awk '{print $5}')
print_info "迁移文件统计"
echo "  总行数: ${MIGRATION_LINES}"
echo "  文件大小: ${MIGRATION_SIZE}"
echo ""

# 7. 询问是否Git提交
read -p "是否Git提交此迁移文件？(y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_info "步骤6: Git提交"

    cd "$PROJECT_ROOT"
    git add "$MIGRATION_PATH"

    COMMIT_MESSAGE="feat: 更新${PROMPT_ID} Prompt到${NEW_VERSION}

变更说明:
$(echo -e "$CHANGE_NOTES")

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

    git commit -m "$COMMIT_MESSAGE"
    print_success "Git提交完成"

    echo ""
    read -p "是否推送到远程仓库？(y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git push origin main
        print_success "已推送到远程仓库"
    else
        print_warning "跳过推送，请手动执行: git push origin main"
    fi
else
    print_warning "跳过Git提交"
    print_info "手动提交命令:"
    echo "  cd $PROJECT_ROOT"
    echo "  git add $MIGRATION_PATH"
    echo "  git commit -m \"feat: 更新${PROMPT_ID} Prompt到${NEW_VERSION}\""
fi

echo ""
echo "======================================"
print_success "🎉 迁移文件生成完成！"
echo "======================================"
echo ""
echo "下一步:"
echo "1. 如果已推送到远程，生产环境部署后会自动应用迁移"
echo "2. 如果未推送，执行: git push origin main"
echo "3. 生产环境验证: docker logs autoads-prod | grep '$MIGRATION_FILENAME'"
echo ""
echo "工作原理:"
echo "  ✅ 开发环境: 数据库中的Prompt已是最新版本"
echo "  ✅ 迁移文件: 包含从开发数据库导出的完整内容"
echo "  ✅ 生产环境: 应用启动时自动执行迁移，同步到最新版本"
echo ""
