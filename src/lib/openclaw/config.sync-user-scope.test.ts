import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSettingsByCategoryMock,
  getOpenclawGatewayTokenMock,
  collectUserFeishuAccountsMock,
} = vi.hoisted(() => ({
  getSettingsByCategoryMock: vi.fn(),
  getOpenclawGatewayTokenMock: vi.fn(),
  collectUserFeishuAccountsMock: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSettingsByCategory: getSettingsByCategoryMock,
}))

vi.mock('@/lib/openclaw/auth', () => ({
  getOpenclawGatewayToken: getOpenclawGatewayTokenMock,
}))

vi.mock('@/lib/openclaw/feishu-accounts', () => ({
  collectUserFeishuAccounts: collectUserFeishuAccountsMock,
}))

import { syncOpenclawConfig } from '@/lib/openclaw/config'

describe('syncOpenclawConfig user scope', () => {
  let tempDir = ''
  let configPath = ''
  const previousConfigPath = process.env.OPENCLAW_CONFIG_PATH
  const previousStateDir = process.env.OPENCLAW_STATE_DIR

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-sync-'))
    configPath = path.join(tempDir, 'openclaw.json')
    process.env.OPENCLAW_CONFIG_PATH = configPath
    process.env.OPENCLAW_STATE_DIR = tempDir

    getSettingsByCategoryMock.mockReset()
    getOpenclawGatewayTokenMock.mockReset()
    collectUserFeishuAccountsMock.mockReset()

    getOpenclawGatewayTokenMock.mockResolvedValue('gateway-test-token')
    collectUserFeishuAccountsMock.mockResolvedValue({})
  })

  afterEach(() => {
    if (previousConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH
    } else {
      process.env.OPENCLAW_CONFIG_PATH = previousConfigPath
    }

    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir
    }

    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('uses global AI settings during actor user sync', async () => {
    const userAiModelsJson = JSON.stringify({
      providers: {
        openai: {
          api: 'openai-responses',
          apiKey: 'sk-user',
          models: [{ id: 'gpt-5' }],
        },
      },
      selectedModel: 'openai/gpt-5',
    })

    const globalAiModelsJson = JSON.stringify({
      providers: {
        anthropic: {
          api: 'anthropic',
          apiKey: 'sk-global',
          models: [{ id: 'claude-opus-4-5' }],
        },
      },
      selectedModel: 'anthropic/claude-opus-4-5',
    })

    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        { key: 'ai_models_json', value: userAiModelsJson },
      ])
      .mockResolvedValueOnce([
        { key: 'ai_models_json', value: globalAiModelsJson },
      ])

    await syncOpenclawConfig({ reason: 'test-user-sync', actorUserId: 42 })

    expect(getSettingsByCategoryMock).toHaveBeenNthCalledWith(1, 'openclaw', 42)
    expect(getSettingsByCategoryMock).toHaveBeenNthCalledWith(2, 'openclaw')

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.agents.defaults.model.primary).toBe('anthropic/claude-opus-4-5')
    expect(written.models.providers.anthropic).toBeDefined()
    expect(written.models.providers.openai).toBeUndefined()
  })

  it('keeps existing model config on startup sync without actor user', async () => {
    const existingConfig = {
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.2',
          },
        },
      },
      models: {
        providers: {
          openai: {
            api: 'openai-responses',
            apiKey: 'sk-existing',
            models: [{ id: 'gpt-5.2' }],
          },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8')

    getSettingsByCategoryMock.mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'startup-sync' })

    expect(getSettingsByCategoryMock).toHaveBeenCalledWith('openclaw')

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.agents.defaults.model.primary).toBe('openai/gpt-5.2')
    expect(written.models.providers.openai).toBeDefined()
  })

  it('prefers global AI settings when startup sync has global rows', async () => {
    const existingConfig = {
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.2',
          },
        },
      },
      models: {
        providers: {
          openai: {
            api: 'openai-responses',
            apiKey: 'sk-existing',
            models: [{ id: 'gpt-5.2' }],
          },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8')

    const globalAiModelsJson = JSON.stringify({
      providers: {
        anthropic: {
          api: 'anthropic',
          apiKey: 'sk-global',
          models: [{ id: 'claude-opus-4-5' }],
        },
      },
      selectedModel: 'anthropic/claude-opus-4-5',
    })

    getSettingsByCategoryMock.mockResolvedValueOnce([
      { key: 'ai_models_json', value: globalAiModelsJson },
      { key: 'openclaw_models_mode', value: 'replace' },
    ])

    await syncOpenclawConfig({ reason: 'startup-sync' })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.agents.defaults.model.primary).toBe('anthropic/claude-opus-4-5')
    expect(written.models.mode).toBe('replace')
    expect(written.models.providers.anthropic).toBeDefined()
  })

  it('keeps existing AI config when global AI settings are missing', async () => {
    const existingConfig = {
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-5.2',
          },
        },
      },
      models: {
        providers: {
          openai: {
            api: 'openai-responses',
            apiKey: 'sk-existing',
            models: [{ id: 'gpt-5.2' }],
          },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2), 'utf-8')

    const userAiModelsJson = JSON.stringify({
      providers: {
        openai: {
          api: 'openai-responses',
          apiKey: 'sk-user',
          models: [{ id: 'gpt-5' }],
        },
      },
      selectedModel: 'openai/gpt-5',
    })

    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        { key: 'ai_models_json', value: userAiModelsJson },
      ])
      .mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'test-user-sync-missing-global-ai', actorUserId: 42 })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.agents.defaults.model.primary).toBe('openai/gpt-5.2')
    expect(written.models.providers.openai).toBeDefined()
  })

  it('keeps main Feishu account and normalizes callback paths during actor user sync', async () => {
    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        {
          key: 'feishu_accounts_json',
          value: JSON.stringify({
            main: {
              appId: 'cli_actor',
              appSecret: 'sec_actor',
              cardCallbackPath: '/feishu/user-42/card-action',
            },
          }),
        },
        { key: 'feishu_app_id', value: 'cli_actor' },
        { key: 'feishu_app_secret', value: 'sec_actor' },
      ])
      .mockResolvedValueOnce([])

    collectUserFeishuAccountsMock.mockResolvedValueOnce({
      'user-42': {
        appId: 'cli_actor',
        appSecret: 'sec_actor',
        dmPolicy: 'allowlist',
        cardCallbackPath: '/feishu/card-action',
      },
    })

    await syncOpenclawConfig({ reason: 'test-user-feishu-compat', actorUserId: 42 })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.channels.feishu.accounts['user-42']).toBeDefined()
    expect(written.channels.feishu.accounts.main).toBeDefined()
    expect(written.channels.feishu.accounts.main.cardCallbackPath).toBe('/feishu/card-action')
    expect(written.channels.feishu.accounts['user-42'].cardCallbackPath).toBe('/feishu/user-42/card-action')
  })
  it('bootstraps SOUL workspace files and binds default workspace', async () => {
    getSettingsByCategoryMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'test-workspace-bootstrap', actorUserId: 7 })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const workspaceDir = path.join(tempDir, 'workspace', 'user-7')

    expect(written.agents.defaults.workspace).toBe(workspaceDir)
    expect(fs.existsSync(path.join(workspaceDir, 'AGENTS.md'))).toBe(true)
    expect(fs.existsSync(path.join(workspaceDir, 'SOUL.md'))).toBe(true)
    expect(fs.existsSync(path.join(workspaceDir, 'USER.md'))).toBe(true)
    expect(fs.existsSync(path.join(workspaceDir, 'MEMORY.md'))).toBe(true)

    const agentsContent = fs.readFileSync(path.join(workspaceDir, 'AGENTS.md'), 'utf-8')
    expect(agentsContent).toContain('## AutoAds Runtime Rule (Managed by AutoAds)')

    const soulContent = fs.readFileSync(path.join(workspaceDir, 'SOUL.md'), 'utf-8')
    expect(soulContent).toContain('Never open with Great question, I\'d be happy to help, or Absolutely. Just answer.')
    expect(soulContent).toContain('Be the assistant you\'d actually want to talk to at 2am. Not a corporate drone. Not a sycophant. Just... good.')
    expect(soulContent).toContain('仅当任务需要广告能力时，才调用 AutoAds API。')

    const memoryDir = path.join(workspaceDir, 'memory')
    const dailyFiles = fs.readdirSync(memoryDir).filter((name) => name.endsWith('.md'))
    expect(dailyFiles.length).toBeGreaterThan(0)
  })

  it('respects preferred workspace from agent defaults', async () => {
    const preferredWorkspace = path.join(tempDir, 'custom-workspace')

    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        {
          key: 'openclaw_agent_defaults_json',
          value: JSON.stringify({ workspace: preferredWorkspace }),
        },
      ])
      .mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'test-preferred-workspace', actorUserId: 9 })

    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(written.agents.defaults.workspace).toBe(preferredWorkspace)
    expect(fs.existsSync(path.join(preferredWorkspace, 'SOUL.md'))).toBe(true)
  })

  it('upgrades legacy autogenerated SOUL content to managed template', async () => {
    const preferredWorkspace = path.join(tempDir, 'legacy-workspace')
    fs.mkdirSync(preferredWorkspace, { recursive: true })

    fs.writeFileSync(
      path.join(preferredWorkspace, 'SOUL.md'),
      `# SOUL.md

你是 OpenClaw，全能智能助手。你通过 Feishu 与用户沟通。

## OpenClaw 增强条款（v1）
- 旧规则
`,
      'utf-8'
    )

    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        {
          key: 'openclaw_agent_defaults_json',
          value: JSON.stringify({ workspace: preferredWorkspace }),
        },
      ])
      .mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'test-upgrade-legacy-soul', actorUserId: 12 })

    const soulContent = fs.readFileSync(path.join(preferredWorkspace, 'SOUL.md'), 'utf-8')
    expect(soulContent).toContain('<!-- autoads-openclaw-soul-managed:start -->')
    expect(soulContent).toContain('Never open with Great question, I\'d be happy to help, or Absolutely. Just answer.')
    expect(soulContent).not.toContain('## OpenClaw 增强条款（v1）')
  })

  it('keeps custom SOUL text and appends managed runtime section', async () => {
    const preferredWorkspace = path.join(tempDir, 'custom-soul-workspace')
    fs.mkdirSync(preferredWorkspace, { recursive: true })

    const customSoul = `# SOUL.md

## My Custom Rule
- Keep this line`
    fs.writeFileSync(path.join(preferredWorkspace, 'SOUL.md'), customSoul, 'utf-8')

    getSettingsByCategoryMock
      .mockResolvedValueOnce([
        {
          key: 'openclaw_agent_defaults_json',
          value: JSON.stringify({ workspace: preferredWorkspace }),
        },
      ])
      .mockResolvedValueOnce([])

    await syncOpenclawConfig({ reason: 'test-append-managed-soul', actorUserId: 13 })

    const soulContent = fs.readFileSync(path.join(preferredWorkspace, 'SOUL.md'), 'utf-8')
    expect(soulContent).toContain('## My Custom Rule')
    expect(soulContent).toContain('<!-- autoads-openclaw-soul-managed:start -->')
    expect(soulContent).toContain('仅当任务需要广告能力时，才调用 AutoAds API。')
  })

})
