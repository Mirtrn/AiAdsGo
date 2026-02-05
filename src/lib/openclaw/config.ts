import fs from 'fs'
import path from 'path'
import { getSettingsByCategory } from '@/lib/settings'
import { getOpenclawGatewayToken } from '@/lib/openclaw/auth'

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

function parseModelsProviders(value: string | null | undefined): Record<string, any> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object') {
      if (parsed.providers && typeof parsed.providers === 'object') {
        return parsed.providers as Record<string, any>
      }
      if (parsed.models && typeof parsed.models === 'object' && parsed.models.providers) {
        return parsed.models.providers as Record<string, any>
      }
      return parsed as Record<string, any>
    }
  } catch (error) {
    console.error('❌ OpenClaw models JSON 解析失败:', error)
  }
  return undefined
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

  const settings = await getSettingsByCategory('openclaw')
  const settingMap = buildSettingMap(settings)

  const gatewayToken = await getOpenclawGatewayToken()
  const gatewayPort = parseNumber(settingMap.gateway_port, DEFAULT_GATEWAY_PORT) || DEFAULT_GATEWAY_PORT
  const gatewayBind = (settingMap.gateway_bind || 'loopback').trim() || 'loopback'

  const feishuAllowFrom = parseJsonArray(settingMap.feishu_allow_from)
  const feishuGroupAllowFrom = parseJsonArray(settingMap.feishu_group_allow_from)
  const feishuGroups = parseJsonObject(settingMap.feishu_groups_json)
  const feishuAccounts = parseJsonObject(settingMap.feishu_accounts_json)
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

  const modelsProviders = parseModelsProviders(settingMap.ai_models_json)
  const modelsMode = (settingMap.openclaw_models_mode || '').trim()
  const bedrockDiscovery = parseJsonObject(settingMap.openclaw_models_bedrock_discovery_json)
  const agentDefaults = parseJsonObject(settingMap.openclaw_agent_defaults_json)
  const agentList = parseJsonArrayValue(settingMap.openclaw_agent_list_json)
  const sessionOverrides = parseJsonObject(settingMap.openclaw_session_json)
  const messagesConfig = parseJsonObject(settingMap.openclaw_messages_json)
  const commandsConfig = parseJsonObject(settingMap.openclaw_commands_json)
  const approvalsExec = parseJsonObject(settingMap.openclaw_approvals_exec_json)
  const redactPatterns = parseJsonArray(settingMap.openclaw_logging_redact_patterns_json)
  const diagnosticsOtel = parseJsonObject(settingMap.openclaw_diagnostics_otel_json)

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
      },
    },
  }

  const feishuAccountsConfig = feishuAccounts && typeof feishuAccounts === 'object' && !Array.isArray(feishuAccounts)
    ? { ...feishuAccounts }
    : {}
  const existingMain = feishuAccountsConfig.main
  if (existingMain && typeof existingMain === 'object' && !Array.isArray(existingMain)) {
    feishuAccountsConfig.main = { ...feishuAccount, ...existingMain }
  } else {
    feishuAccountsConfig.main = feishuAccount
  }
  config.channels.feishu.accounts = feishuAccountsConfig

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

  if (agentDefaults || (agentList && agentList.length > 0)) {
    config.agents = {}
    if (agentDefaults && Object.keys(agentDefaults).length > 0) {
      config.agents.defaults = agentDefaults
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
