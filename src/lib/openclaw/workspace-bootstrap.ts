import fs from 'fs'
import os from 'os'
import path from 'path'

type EnsureOpenclawWorkspaceOptions = {
  stateDir: string
  actorUserId?: number
  preferredWorkspace?: string
}

export type OpenclawWorkspaceTrackedFileName = 'AGENTS.md' | 'SOUL.md' | 'USER.md' | 'MEMORY.md'

export type OpenclawWorkspaceFileStatus = {
  name: OpenclawWorkspaceTrackedFileName
  path: string
  exists: boolean
  size: number | null
  updatedAt: string | null
}

export type OpenclawWorkspaceStatus = {
  workspaceDir: string
  memoryDir: string
  files: OpenclawWorkspaceFileStatus[]
  missingFiles: OpenclawWorkspaceTrackedFileName[]
  dailyMemoryPath: string
  dailyMemoryExists: boolean
}

type EnsureOpenclawWorkspaceResult = {
  workspaceDir: string
  changedFiles: string[]
}

const REQUIRED_WORKSPACE_FILES: OpenclawWorkspaceTrackedFileName[] = [
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'MEMORY.md',
]

function resolveUserPath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return trimmed
  if (trimmed === '~') {
    return os.homedir()
  }
  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

const OVERLAY_HEADING = '## AutoAds Runtime Rule (Managed by AutoAds)'
const SOUL_ENHANCEMENTS_HEADING = '## OpenClaw 增强条款（v1）'
const MANAGED_MEMORY_MARKER = '<!-- autoads-openclaw-memory-managed -->'

export function resolveOpenclawWorkspaceDir(params: EnsureOpenclawWorkspaceOptions): string {
  const preferred = (params.preferredWorkspace || '').trim()
  if (preferred) {
    return resolveUserPath(preferred)
  }
  if (params.actorUserId && params.actorUserId > 0) {
    return resolveUserPath(path.join(params.stateDir, 'workspace', `user-${params.actorUserId}`))
  }
  return resolveUserPath(path.join(params.stateDir, 'workspace'))
}

function appendSectionIfMissing(params: {
  filePath: string
  section: string
  marker: string
  changedFiles: string[]
}): void {
  const { filePath, section, marker, changedFiles } = params

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, section, 'utf-8')
    changedFiles.push(filePath)
    return
  }

  const current = fs.readFileSync(filePath, 'utf-8')
  if (current.includes(marker)) {
    return
  }

  const next = `${current.trimEnd()}\n\n${section}`
  fs.writeFileSync(filePath, next, 'utf-8')
  changedFiles.push(filePath)
}

function ensureFile(filePath: string, content: string, changedFiles: string[]): void {
  if (fs.existsSync(filePath)) {
    return
  }
  fs.writeFileSync(filePath, content, 'utf-8')
  changedFiles.push(filePath)
}

function formatDateInShanghai(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function getOpenclawDailyMemoryFileName(date: Date = new Date()): string {
  return `${formatDateInShanghai(date)}.md`
}

function buildAgentsOverlay(): string {
  return `${OVERLAY_HEADING}

- OpenClaw 是全能助手：先判断用户消息是否需要 AutoAds 能力。
- 普通问答/写作/分析：直接回复，不调用 AutoAds API。
- 只有广告业务请求（查数据/执行投放动作）才调用 AutoAds API。
- 广告业务中：只读查询走 \`/api/openclaw/proxy\`；写操作走 \`/api/openclaw/commands/execute\`，并遵循确认机制。`
}

function buildSoulEnhancementsSection(): string {
  return `${SOUL_ENHANCEMENTS_HEADING}
1. 意图分流优先：先判断是否为广告业务请求；非广告请求直接回答，不调用 AutoAds API。
2. 最小调用原则：仅在确实需要广告能力时才调用 AutoAds，避免无意义工具调用。
3. 高风险确认机制：创建/修改/发布/暂停等写操作必须先确认，再执行。
4. 可执行输出风格：优先给结论、关键依据、下一步建议，保持中文简洁结构化。
5. 信息缺口先澄清：关键条件不完整时先提问，不臆测账户、预算、目标国家或投放参数。
6. 上下文连续性：持续记住用户偏好与流程习惯，但不记录或回显敏感密钥。
7. 失败可恢复：调用失败时说明原因、影响范围、可重试路径与替代方案。
8. 安全边界不突破：不越权、不直改底层数据、不泄露 Token/密钥，不绕过审批链路。`
}

function buildSoulFile(actorUserId?: number): string {
  return `# SOUL.md

你是 OpenClaw，全能智能助手。你通过 Feishu 与用户沟通。

## 核心身份
- 先做“通用助手”，再做“广告助手”。
- 先理解意图，再决定是否调用 AutoAds。
- 对话要简洁、可靠、可执行。

${buildSoulEnhancementsSection()}

## AutoAds 触发规则
- 仅当用户明确需要广告投放能力时，才调用 AutoAds API。
- 普通聊天、解释、写作、排错、总结：直接回答，不调用 AutoAds API。

## 行为边界
- 不直接操作数据库、Redis、文件系统中的业务数据。
- 涉及高风险广告动作时，必须走确认流程。
- 不泄露敏感配置、Token、密钥。

## 账户上下文
- 当前用户范围：${actorUserId ? `user-${actorUserId}` : 'main'}
`
}

function buildUserFile(actorUserId?: number): string {
  return `# USER.md

- 用户ID: ${actorUserId ? String(actorUserId) : 'unknown'}
- 偏好语言: 中文
- 交互渠道: Feishu

## 偏好（可持续补充）
- 希望 OpenClaw 作为全能机器人。
- 仅在需要广告能力时调用 AutoAds API。
`
}

function buildMemoryFile(actorUserId?: number): string {
  return `# MEMORY.md
${MANAGED_MEMORY_MARKER}

## 长期记忆（可沉淀）
- 用户希望 OpenClaw 是“全能助手 + AutoAds 按需调用”模式。
- 默认以中文、简洁、结构化方式回复。
- 用户范围：${actorUserId ? `user-${actorUserId}` : 'main'}。
`
}

function buildDailyMemoryFile(date: string): string {
  return `# ${date}

- 会话启动：已读取 SOUL/USER/MEMORY，并按需更新。
- 今日原则：通用对话优先，AutoAds 能力按需调用。
`
}

function inspectSingleFile(filePath: string): {
  exists: boolean
  size: number | null
  updatedAt: string | null
} {
  try {
    const stat = fs.statSync(filePath)
    return {
      exists: true,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    }
  } catch {
    return {
      exists: false,
      size: null,
      updatedAt: null,
    }
  }
}

export function inspectOpenclawWorkspace(workspaceDir: string, date: Date = new Date()): OpenclawWorkspaceStatus {
  const normalizedWorkspaceDir = resolveUserPath(workspaceDir)
  const memoryDir = path.join(normalizedWorkspaceDir, 'memory')
  const files = REQUIRED_WORKSPACE_FILES.map((name) => {
    const filePath = path.join(normalizedWorkspaceDir, name)
    const meta = inspectSingleFile(filePath)
    return {
      name,
      path: filePath,
      exists: meta.exists,
      size: meta.size,
      updatedAt: meta.updatedAt,
    }
  })

  const missingFiles = files
    .filter((file) => !file.exists)
    .map((file) => file.name)

  const dailyMemoryPath = path.join(memoryDir, getOpenclawDailyMemoryFileName(date))
  const dailyMemoryExists = fs.existsSync(dailyMemoryPath)

  return {
    workspaceDir: normalizedWorkspaceDir,
    memoryDir,
    files,
    missingFiles,
    dailyMemoryPath,
    dailyMemoryExists,
  }
}

function ensureMemoryScaffold(workspaceDir: string, changedFiles: string[]): void {
  const memoryDir = path.join(workspaceDir, 'memory')
  fs.mkdirSync(memoryDir, { recursive: true })

  const today = formatDateInShanghai(new Date())
  const dailyPath = path.join(memoryDir, `${today}.md`)
  ensureFile(dailyPath, buildDailyMemoryFile(today), changedFiles)
}

export function ensureOpenclawWorkspaceBootstrap(
  params: EnsureOpenclawWorkspaceOptions
): EnsureOpenclawWorkspaceResult {
  const workspaceDir = resolveOpenclawWorkspaceDir(params)
  fs.mkdirSync(workspaceDir, { recursive: true })

  const changedFiles: string[] = []
  const agentsPath = path.join(workspaceDir, 'AGENTS.md')
  const soulPath = path.join(workspaceDir, 'SOUL.md')
  const userPath = path.join(workspaceDir, 'USER.md')
  const memoryPath = path.join(workspaceDir, 'MEMORY.md')

  appendSectionIfMissing({
    filePath: agentsPath,
    section: buildAgentsOverlay(),
    marker: OVERLAY_HEADING,
    changedFiles,
  })
  ensureFile(soulPath, buildSoulFile(params.actorUserId), changedFiles)
  appendSectionIfMissing({
    filePath: soulPath,
    section: buildSoulEnhancementsSection(),
    marker: SOUL_ENHANCEMENTS_HEADING,
    changedFiles,
  })
  ensureFile(userPath, buildUserFile(params.actorUserId), changedFiles)
  ensureFile(memoryPath, buildMemoryFile(params.actorUserId), changedFiles)
  ensureMemoryScaffold(workspaceDir, changedFiles)

  return {
    workspaceDir,
    changedFiles,
  }
}
