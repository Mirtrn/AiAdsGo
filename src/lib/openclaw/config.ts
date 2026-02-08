import fs from 'fs'
import path from 'path'
import { getSettingsByCategory } from '@/lib/settings'
import { getOpenclawGatewayToken } from '@/lib/openclaw/auth'
import { collectUserFeishuAccounts } from '@/lib/openclaw/feishu-accounts'
import { parseAiModelsJson } from '@/lib/openclaw/ai-models'

type SyncOpenclawConfigOptions = {
  reason?: string
  actorUserId?: number
}

type OpenclawSettingMap = Record<string, string | null>

const DEFAULT_GATEWAY_PORT = 18789
const DEFAULT_LOG_FILE = '/proc/self/fd/1'

function resolveEnvValue(value: string | undefined, fallback: string): string {
  const trimmed = (value || '').trim()
  return trimmed || fallback
}

function buildSettingMap(settings: Array<{ key: string; value: string | null }>): OpenclawSettingMap {
  return settings.reduce<OpenclawSettingMap>((acc, setting) => {
    acc[setting.key] = setting.value
    return acc
  }, {})
}

function parseBoolean(value: string | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function parseNumber(value: string | null | undefined, fallback?: number): number | undefined {
  if (value === null || value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

function parseJsonArray(value: string | null | undefined): Array<string | number> {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => (typeof item === 'string' || typeof item === 'number' ? item : String(item)))
  } catch {
    return []
  }
}

function parseJsonArrayValue(value: string | null | undefined): any[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch (error) {
    console.error('❌ OpenClaw JSON 解析失败:', error)
    return undefined
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, any> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as Record<string, any>
  } catch (error) {
    console.error('❌ OpenClaw JSON 解析失败:', error)
    return undefined
  }
}

function asObject(value: unknown): Record<string, any> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, any>
}

function readExistingConfig(configPath: string): Record<string, any> | undefined {
  try {
    if (!fs.existsSync(configPath)) {
      return undefined
    }
    const raw = fs.readFileSync(configPath, 'utf-8')
    if (!raw.trim()) {
      return undefined
    }
    return asObject(JSON.parse(raw))
  } catch {
    return undefined
  }
}

function resolveOpenclawPublicBaseUrl(): string | undefined {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || process.env.OPENCLAW_PUBLIC_BASE_URL || '').trim()
  if (!raw) return undefined
  return raw.replace(/\/+$/, '')
}

function applyFeishuCardAutoDefaults(params: {
  accountId: string
  accountConfig: Record<string, any>
  gatewayToken: string
  appBaseUrl?: string
}): Record<string, any> {
  const next = { ...params.accountConfig }

  const callbackPath = params.accountId === 'main'
    ? '/feishu/card-action'
    : `/feishu/${encodeURIComponent(params.accountId)}/card-action`

  if (!(typeof next.cardCallbackPath === 'string' && next.cardCallbackPath.trim())) {
    next.cardCallbackPath = callbackPath
  }

  if (params.appBaseUrl && !(typeof next.cardConfirmUrl === 'string' && next.cardConfirmUrl.trim())) {
    next.cardConfirmUrl = `${params.appBaseUrl}/api/openclaw/commands/confirm`
  }

  if (!(typeof next.cardConfirmAuthToken === 'string' && next.cardConfirmAuthToken.trim())) {
    next.cardConfirmAuthToken = params.gatewayToken
  }

  const timeoutMs = Number(next.cardConfirmTimeoutMs)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    next.cardConfirmTimeoutMs = 10000
  }

  return next
}

function resolveConfigPath(): { configPath: string; stateDir: string } {
  const configPath = (process.env.OPENCLAW_CONFIG_PATH || '').trim()
    || path.join(process.cwd(), '.openclaw', 'openclaw.json')
  const stateDir = (process.env.OPENCLAW_STATE_DIR || '').trim()
    || path.dirname(configPath)
  return { configPath, stateDir }
}

export async function syncOpenclawConfig(options: SyncOpenclawConfigOptions = {}) {
  const { configPath, stateDir } = resolveConfigPath()
  fs.mkdirSync(stateDir, { recursive: true })

  const actorUserId = Number.isInteger(options.actorUserId) && (options.actorUserId || 0) > 0
    ? Number(options.actorUserId)
    : undefined

  const settings = actorUserId
    ? await getSettingsByCategory('openclaw', actorUserId)
    : await getSettingsByCategory('openclaw')

  const useExistingConfigFallback = !actorUserId
  const existingConfig = useExistingConfigFallback ? readExistingConfig(configPath) : undefined
  const existingModelsNode = asObject(existingConfig?.models)
  const existingAgentDefaults = asObject(asObject(existingConfig?.agents)?.defaults)
  const existingModelPrimary = (() => {
    const modelNode = existingAgentDefaults?.model
    if (typeof modelNode === 'string' && modelNode.trim()) {
      return modelNode.trim()
    }
    if (modelNode && typeof modelNode === 'object' && !Array.isArray(modelNode)) {
      const primary = (modelNode as { primary?: string }).primary
      if (typeof primary === 'string' && primary.trim()) {
        return primary.trim()
      }
    }
    return null
  })()

  const settingMap = buildSettingMap(settings)

  const gatewayToken = await getOpenclawGatewayToken()
  const appBaseUrl = resolveOpenclawPublicBaseUrl()
  const gatewayPort = parseNumber(settingMap.gateway_port, DEFAULT_GATEWAY_PORT) || DEFAULT_GATEWAY_PORT
  const gatewayBind = (settingMap.gateway_bind || 'loopback').trim() || 'loopback'

  const feishuAllowFrom = parseJsonArray(settingMap.feishu_allow_from)
  const feishuGroupAllowFrom = parseJsonArray(settingMap.feishu_group_allow_from)
  const feishuGroups = parseJsonObject(settingMap.feishu_groups_json)
  const feishuAccounts = parseJsonObject(settingMap.feishu_accounts_json)
  const userFeishuAccounts = await collectUserFeishuAccounts()
  const feishuMarkdownTables = (settingMap.feishu_markdown_tables || '').trim()
  const feishuMediaMaxMb = parseNumber(settingMap.feishu_media_max_mb, undefined)

  const feishuAccount = {
    appId: (settingMap.feishu_app_id || '').trim() || undefined,
    appSecret: (settingMap.feishu_app_secret || '').trim() || undefined,
    appSecretFile: (settingMap.feishu_app_secret_file || '').trim() || undefined,
    domain: (settingMap.feishu_domain || '').trim() || undefined,
    botName: (settingMap.feishu_bot_name || '').trim() || undefined,
    dmPolicy: (settingMap.feishu_dm_policy || '').trim() || undefined,
    groupPolicy: (settingMap.feishu_group_policy || '').trim() || undefined,
    allowFrom: feishuAllowFrom.length > 0 ? feishuAllowFrom : undefined,
    groupAllowFrom: feishuGroupAllowFrom.length > 0 ? feishuGroupAllowFrom : undefined,
    markdown: feishuMarkdownTables ? { tables: feishuMarkdownTables } : undefined,
    historyLimit: parseNumber(settingMap.feishu_history_limit, undefined),
    dmHistoryLimit: parseNumber(settingMap.feishu_dm_history_limit, undefined),
    streaming: parseBoolean(settingMap.feishu_streaming, true),
    blockStreaming: parseBoolean(settingMap.feishu_block_streaming, false),
    textChunkLimit: parseNumber(settingMap.feishu_text_chunk_limit, undefined),
    chunkMode: (settingMap.feishu_chunk_mode || '').trim() || undefined,
    configWrites: parseBoolean(settingMap.feishu_config_writes, true),
    mediaMaxMb: feishuMediaMaxMb,
    responsePrefix: (settingMap.feishu_response_prefix || '').trim() || undefined,
    enabled: true,
  }

  const requireMentionRaw = settingMap.feishu_require_mention
  let mergedGroups = feishuGroups
  if (requireMentionRaw !== null && requireMentionRaw !== undefined && requireMentionRaw !== '') {
    const requireMention = parseBoolean(requireMentionRaw, true)
    if (!mergedGroups) {
      mergedGroups = {}
    }
    const starGroup = mergedGroups['*']
    if (!starGroup || typeof starGroup !== 'object' || Array.isArray(starGroup)) {
      mergedGroups['*'] = { requireMention }
    } else if (!('requireMention' in starGroup)) {
      starGroup.requireMention = requireMention
    }
  }
  if (mergedGroups && Object.keys(mergedGroups).length > 0) {
    ;(feishuAccount as any).groups = mergedGroups
  }

  const aiModelsConfig = parseAiModelsJson(settingMap.ai_models_json)
  if (aiModelsConfig.parseError && (settingMap.ai_models_json || '').trim()) {
    console.error('❌ OpenClaw models JSON 解析失败:', aiModelsConfig.parseError)
  }
  const modelsProviders = aiModelsConfig.providers
    || (useExistingConfigFallback ? asObject(existingModelsNode?.providers) : undefined)
  const aiSelectedModelRef = aiModelsConfig.explicitSelectedModelRef
    || (useExistingConfigFallback ? existingModelPrimary : null)
  const aiFallbackModelRef = aiModelsConfig.selectedModelRef
    || (useExistingConfigFallback ? existingModelPrimary : null)
  const modelsModeFromSettings = (settingMap.openclaw_models_mode || '').trim()
  const modelsMode = modelsModeFromSettings || (
    useExistingConfigFallback && typeof existingModelsNode?.mode === 'string'
      ? existingModelsNode.mode.trim()
      : ''
  )
  const bedrockDiscovery = parseJsonObject(settingMap.openclaw_models_bedrock_discovery_json)
    || (useExistingConfigFallback ? asObject(existingModelsNode?.bedrockDiscovery) : undefined)
  const agentDefaults = parseJsonObject(settingMap.openclaw_agent_defaults_json)
    || (useExistingConfigFallback ? existingAgentDefaults : undefined)
  const agentList = parseJsonArrayValue(settingMap.openclaw_agent_list_json)
  const sessionOverrides = parseJsonObject(settingMap.openclaw_session_json)
  const messagesConfig = parseJsonObject(settingMap.openclaw_messages_json)
  const commandsConfig = parseJsonObject(settingMap.openclaw_commands_json)
  const approvalsExec = parseJsonObject(settingMap.openclaw_approvals_exec_json)
  const redactPatterns = parseJsonArray(settingMap.openclaw_logging_redact_patterns_json)
  const diagnosticsOtel = parseJsonObject(settingMap.openclaw_diagnostics_otel_json)
  const skillsEntries = parseJsonObject(settingMap.openclaw_skills_entries_json)
  const skillsAllowBundled = parseJsonArray(settingMap.openclaw_skills_allow_bundled_json)

  const config: Record<string, any> = {
    meta: {
      lastTouchedAt: new Date().toISOString(),
      lastTouchedVersion: 'autoads',
    },
    logging: {
      level: 'info',
      file: resolveEnvValue(process.env.OPENCLAW_LOG_FILE, DEFAULT_LOG_FILE),
      consoleLevel: resolveEnvValue(process.env.OPENCLAW_CONSOLE_LEVEL, 'info'),
      consoleStyle: resolveEnvValue(process.env.OPENCLAW_CONSOLE_STYLE, 'compact'),
      redactSensitive: 'tools',
    },
    session: {
      dmScope: 'per-account-channel-peer',
    },
    gateway: {
      mode: 'local',
      bind: gatewayBind,
      port: gatewayPort,
      auth: {
        mode: 'token',
        token: gatewayToken,
      },
      controlUi: {
        enabled: false,
      },
      reload: {
        mode: 'hybrid',
      },
    },
    plugins: {
      entries: {
        feishu: { enabled: true },
      },
    },
    channels: {
      feishu: {
        enabled: true,
        accounts: {},
      },
    },
    skills: {
      entries: {
        autoads: { enabled: true },
        'autoads-report-qa': { enabled: true },
        'autoads-prd-writer': { enabled: true },
      },
    },
  }

  const feishuAccountsConfig = feishuAccounts && typeof feishuAccounts === 'object' && !Array.isArray(feishuAccounts)
    ? { ...feishuAccounts }
    : {}
  const existingMain = feishuAccountsConfig.main
  const hasMainCredentials = Boolean(
    feishuAccount.appId &&
      (feishuAccount.appSecret || feishuAccount.appSecretFile)
  )
  if (existingMain && typeof existingMain === 'object' && !Array.isArray(existingMain)) {
    const mergedMain = { ...feishuAccount, ...existingMain }
    if (mergedMain.appId && (mergedMain.appSecret || mergedMain.appSecretFile)) {
      feishuAccountsConfig.main = mergedMain
    } else {
      delete feishuAccountsConfig.main
    }
  } else if (hasMainCredentials) {
    feishuAccountsConfig.main = feishuAccount
  } else {
    delete feishuAccountsConfig.main
  }
  const mergedFeishuAccounts: Record<string, any> = { ...feishuAccountsConfig }
  for (const [accountId, userAccount] of Object.entries(userFeishuAccounts)) {
    const existing = mergedFeishuAccounts[accountId]
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      mergedFeishuAccounts[accountId] = { ...existing, ...userAccount }
    } else {
      mergedFeishuAccounts[accountId] = userAccount
    }
  }

  for (const [accountId, accountConfig] of Object.entries(mergedFeishuAccounts)) {
    if (!accountConfig || typeof accountConfig !== 'object' || Array.isArray(accountConfig)) {
      continue
    }
    mergedFeishuAccounts[accountId] = applyFeishuCardAutoDefaults({
      accountId,
      accountConfig: accountConfig as Record<string, any>,
      gatewayToken,
      appBaseUrl,
    })
  }

  config.channels.feishu.accounts = mergedFeishuAccounts

  if (sessionOverrides && Object.keys(sessionOverrides).length > 0) {
    config.session = { ...config.session, ...sessionOverrides }
  }

  if (messagesConfig && Object.keys(messagesConfig).length > 0) {
    config.messages = messagesConfig
  }

  if (commandsConfig && Object.keys(commandsConfig).length > 0) {
    config.commands = commandsConfig
  }

  if (approvalsExec && Object.keys(approvalsExec).length > 0) {
    config.approvals = { exec: approvalsExec }
  }

  if (redactPatterns.length > 0) {
    config.logging.redactPatterns = redactPatterns.map((entry) => String(entry))
  }

  if (diagnosticsOtel && Object.keys(diagnosticsOtel).length > 0) {
    config.diagnostics = { ...(config.diagnostics || {}), otel: diagnosticsOtel }
  }

  if (skillsEntries && Object.keys(skillsEntries).length > 0) {
    config.skills = {
      ...(config.skills || {}),
      entries: {
        ...((config.skills && config.skills.entries) || {}),
        ...skillsEntries,
      },
    }
  }

  if (skillsAllowBundled.length > 0) {
    config.skills = {
      ...(config.skills || {}),
      allowBundled: skillsAllowBundled.map((entry) => String(entry)),
    }
  }

  const mergedAgentDefaults = (() => {
    const base = agentDefaults && Object.keys(agentDefaults).length > 0
      ? { ...agentDefaults }
      : {}

    const hasExistingPrimaryModel = (() => {
      const existingModel = base.model
      if (typeof existingModel === 'string') {
        return Boolean(existingModel.trim())
      }
      if (existingModel && typeof existingModel === 'object' && !Array.isArray(existingModel)) {
        return typeof existingModel.primary === 'string' && Boolean(existingModel.primary.trim())
      }
      return false
    })()

    const preferredModelRef =
      aiSelectedModelRef ||
      (!hasExistingPrimaryModel ? aiFallbackModelRef : null)

    if (preferredModelRef) {
      const existingModel = base.model
      if (existingModel && typeof existingModel === 'object' && !Array.isArray(existingModel)) {
        base.model = { ...existingModel, primary: preferredModelRef }
      } else {
        base.model = { primary: preferredModelRef }
      }
    }

    return Object.keys(base).length > 0 ? base : undefined
  })()

  if (mergedAgentDefaults || (agentList && agentList.length > 0)) {
    config.agents = {}
    if (mergedAgentDefaults) {
      config.agents.defaults = mergedAgentDefaults
    }
    if (agentList && agentList.length > 0) {
      config.agents.list = agentList
    }
  }

  if (
    (modelsProviders && Object.keys(modelsProviders).length > 0) ||
    (modelsMode && ['merge', 'replace'].includes(modelsMode)) ||
    (bedrockDiscovery && Object.keys(bedrockDiscovery).length > 0)
  ) {
    config.models = {}
    if (modelsProviders && Object.keys(modelsProviders).length > 0) {
      config.models.providers = modelsProviders
    }
    if (modelsMode && ['merge', 'replace'].includes(modelsMode)) {
      config.models.mode = modelsMode
    }
    if (bedrockDiscovery && Object.keys(bedrockDiscovery).length > 0) {
      config.models.bedrockDiscovery = bedrockDiscovery
    }
  }

  const configJson = JSON.stringify(config, null, 2)
  fs.writeFileSync(configPath, configJson, 'utf-8')

  console.log(
    `✅ OpenClaw 配置已同步 (${options.reason || 'manual'}) -> ${configPath}`
  )

  return { configPath, config }
}
