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
const MANAGED_MEMORY_MARKER = '<!-- autoads-openclaw-memory-managed -->'
const SOUL_MANAGED_START = '<!-- autoads-openclaw-soul-managed:start -->'
const SOUL_MANAGED_END = '<!-- autoads-openclaw-soul-managed:end -->'
const SOUL_LEGACY_SIGNATURES = [
  '你是 OpenClaw，全能智能助手。你通过 Feishu 与用户沟通。',
  '## OpenClaw 增强条款（v1）',
  '## AutoAds 触发规则',
]

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

function writeFileIfChanged(filePath: string, current: string, next: string, changedFiles: string[]): void {
  if (current === next) {
    return
  }
  fs.writeFileSync(filePath, next, 'utf-8')
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

function buildSoulManagedSection(actorUserId?: number): string {
  return `${SOUL_MANAGED_START}
## 核心身份
你是 OpenClaw：全能助手优先，AutoAds 能力按需调用。

## 风格规则
1. 有观点，给结论，不打“看情况”太极。
2. Never open with Great question, I'd be happy to help, or Absolutely. Just answer.
3. Brevity is mandatory. If the answer fits in one sentence, one sentence is what I get.
4. 允许自然幽默，但不要强行抖机灵。
5. 用户要踩坑时直接指出来：有礼貌，但别糖衣炮弹。
6. 需要强调时可以说重话，但要克制，不滥用。
7. 输出要可执行：先结论，再关键依据，再下一步。

## OpenClaw 业务约束
- 先判断是否为广告业务请求。
- 普通聊天、解释、写作、排错、总结：直接回答，不调用 AutoAds API。
- 仅当任务需要广告能力时，才调用 AutoAds API。
- 读操作走 \`/api/openclaw/proxy\`。
- 写操作走 \`/api/openclaw/commands/execute\`，并严格执行确认链路。
- 不泄露 Token/密钥，不越权，不绕过审批。

## 用户范围
- 当前用户范围：${actorUserId ? `user-${actorUserId}` : 'main'}

## Vibe
Be the assistant you'd actually want to talk to at 2am. Not a corporate drone. Not a sycophant. Just... good.
${SOUL_MANAGED_END}`
}

function buildSoulFile(actorUserId?: number): string {
  return `# SOUL.md

${buildSoulManagedSection(actorUserId)}
`
}

function isLegacyAutoAdsSoul(content: string): boolean {
  return SOUL_LEGACY_SIGNATURES.some((signature) => content.includes(signature))
}

function replaceManagedSoulBlock(content: string, nextManagedSection: string): string | null {
  const startIndex = content.indexOf(SOUL_MANAGED_START)
  const endIndex = content.indexOf(SOUL_MANAGED_END)

  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    return null
  }

  const before = content.slice(0, startIndex).trimEnd()
  const after = content.slice(endIndex + SOUL_MANAGED_END.length).trimStart()

  let merged = before ? `${before}\n\n${nextManagedSection}` : nextManagedSection
  if (after) {
    merged = `${merged}\n\n${after}`
  }

  return `${merged.trimEnd()}\n`
}

function ensureSoulFile(filePath: string, actorUserId: number | undefined, changedFiles: string[]): void {
  const nextSoul = buildSoulFile(actorUserId)

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, nextSoul, 'utf-8')
    changedFiles.push(filePath)
    return
  }

  const current = fs.readFileSync(filePath, 'utf-8')
  const nextManagedSection = buildSoulManagedSection(actorUserId)
  const replaced = replaceManagedSoulBlock(current, nextManagedSection)

  if (replaced !== null) {
    writeFileIfChanged(filePath, current, replaced, changedFiles)
    return
  }

  if (isLegacyAutoAdsSoul(current)) {
    writeFileIfChanged(filePath, current, nextSoul, changedFiles)
    return
  }

  const appended = `${current.trimEnd()}\n\n${nextManagedSection}\n`
  writeFileIfChanged(filePath, current, appended, changedFiles)
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
  ensureSoulFile(soulPath, params.actorUserId, changedFiles)
  ensureFile(userPath, buildUserFile(params.actorUserId), changedFiles)
  ensureFile(memoryPath, buildMemoryFile(params.actorUserId), changedFiles)
  ensureMemoryScaffold(workspaceDir, changedFiles)

  return {
    workspaceDir,
    changedFiles,
  }
}
