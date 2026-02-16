import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type ParamRow = {
  key: string
  desc: string
  note?: string
}

const AI_MINIMAL_PARAMS: ParamRow[] = [
  { key: 'ai_models_json', desc: 'AI Providers / Models JSON', note: '必填' },
]

const AI_OPTIONAL_PARAMS: ParamRow[] = [
  { key: 'openclaw_models_mode', desc: '模型合并模式', note: '默认 merge（通常无需填写）' },
  { key: 'openclaw_models_bedrock_discovery_json', desc: 'Bedrock 发现配置 JSON', note: '可选' },
]

const FEISHU_MINIMAL_PARAMS: ParamRow[] = [
  { key: 'feishu_app_id', desc: '飞书 App ID（cli_xxx）', note: '必填' },
  { key: 'feishu_app_secret', desc: '飞书 App Secret', note: '必填（敏感）' },
  { key: 'feishu_target', desc: '推送目标（open_id / union_id / chat_id）', note: '必填' },
]

const FEISHU_OPTIONAL_PARAMS: ParamRow[] = [
  { key: 'feishu_bot_name', desc: 'Bot 展示名', note: '可选' },
  { key: 'feishu_domain', desc: 'feishu / lark / https://...', note: '可选，默认 feishu' },
  { key: 'feishu_doc_folder_token', desc: '飞书文档目录 Token', note: '日报写文档可选' },
  { key: 'feishu_doc_title_prefix', desc: '文档标题前缀', note: '可选' },
  { key: 'feishu_bitable_app_token', desc: 'Bitable App Token', note: '写多维表可选' },
  { key: 'feishu_bitable_table_id', desc: 'Bitable Table ID', note: '可留空自动创建' },
  { key: 'feishu_bitable_table_name', desc: 'Bitable Table 名称', note: '可选' },
  { key: 'feishu_groups_json', desc: '群组级覆盖 JSON', note: '高级可选' },
  { key: 'feishu_accounts_json', desc: '多账号 / Webhook 扩展 JSON', note: '可选' },
]

const FEISHU_ADVANCED_DEFAULT_PARAMS: ParamRow[] = [
  { key: 'feishu_require_mention', desc: '群聊是否强制 @', note: '默认 true' },
  { key: 'feishu_history_limit', desc: '群历史消息数', note: '默认 20' },
  { key: 'feishu_dm_history_limit', desc: 'DM 历史消息数', note: '默认 20' },
  { key: 'feishu_streaming', desc: '流式回复', note: '默认 true' },
  { key: 'feishu_block_streaming', desc: '禁用 block streaming', note: '默认 false' },
  { key: 'feishu_config_writes', desc: '允许聊天内写配置', note: '默认 true' },
  { key: 'feishu_text_chunk_limit', desc: '消息分块长度', note: '默认 2000' },
]

const FEISHU_ACCOUNT_JSON_FIELDS: ParamRow[] = [
  {
    key: 'feishu_accounts_json.<account>.name',
    desc: '账号显示名',
  },
  {
    key: 'feishu_accounts_json.<account>.appId',
    desc: '账号 App ID',
  },
  {
    key: 'feishu_accounts_json.<account>.appSecret',
    desc: '账号 App Secret',
  },
  {
    key: 'feishu_accounts_json.<account>.verificationToken',
    desc: 'Webhook Verification Token（仅 webhook 模式）',
  },
  {
    key: 'feishu_accounts_json.<account>.encryptKey',
    desc: 'Webhook Encrypt Key（仅 webhook 模式）',
  },
  {
    key: 'feishu_accounts_json.<account>.connectionMode',
    desc: '连接模式 websocket / webhook',
    note: '默认 websocket',
  },
]

const AFFILIATE_MINIMAL_PARAMS: ParamRow[] = [
  { key: 'yeahpromos_token', desc: 'YeahPromos API Token', note: '可选（与 PB 可二选一）' },
  { key: 'yeahpromos_site_id', desc: 'YeahPromos Site ID', note: '使用 YP 时建议填写' },
  { key: 'partnerboost_token', desc: 'PartnerBoost API Token', note: '可选（与 YP 可二选一）' },
]

const AFFILIATE_OPTIONAL_PARAMS: ParamRow[] = [
  { key: 'yeahpromos_page', desc: 'YP 默认页码', note: '默认 1' },
  { key: 'yeahpromos_limit', desc: 'YP 默认条数', note: '默认 1000' },
  { key: 'yeahpromos_request_delay_ms', desc: 'YP 请求间隔(ms)', note: '默认 120' },
  { key: 'yeahpromos_rate_limit_max_retries', desc: 'YP 429 最大重试次数', note: '默认 3' },
  { key: 'yeahpromos_rate_limit_base_delay_ms', desc: 'YP 429 重试基准延迟(ms)', note: '默认 600' },
  { key: 'yeahpromos_rate_limit_max_delay_ms', desc: 'YP 429 重试最大延迟(ms)', note: '默认 10000' },
  { key: 'partnerboost_base_url', desc: 'PB API Base URL', note: '默认 https://app.partnerboost.com' },
  { key: 'partnerboost_products_country_code', desc: 'PB products country_code', note: '默认 US' },
  { key: 'partnerboost_products_link_batch_size', desc: 'PB 商品链接批次大小', note: '默认 20（建议 10~30）' },
  { key: 'partnerboost_asin_link_batch_size', desc: 'PB ASIN 链接批次大小', note: '默认 20（建议 10~30）' },
  { key: 'partnerboost_request_delay_ms', desc: 'PB 批次间隔(ms)', note: '默认 150' },
  { key: 'partnerboost_rate_limit_max_retries', desc: 'PB 429 最大重试次数', note: '默认 4' },
  { key: 'partnerboost_rate_limit_base_delay_ms', desc: 'PB 429 重试基准延迟(ms)', note: '默认 800' },
  { key: 'partnerboost_rate_limit_max_delay_ms', desc: 'PB 429 重试最大延迟(ms)', note: '默认 12000' },
  { key: 'partnerboost_link_country_code', desc: 'PB link country_code', note: '默认 US' },
  { key: 'partnerboost_link_uid', desc: 'PB link uid', note: '可选' },
]

const STRATEGY_MINIMAL_PARAMS: ParamRow[] = [
  { key: 'openclaw_strategy_enabled', desc: '启用策略', note: '必填（true/false）' },
  { key: 'openclaw_strategy_cron', desc: 'Cron 表达式', note: '建议默认 0 9 * * *' },
  { key: 'openclaw_strategy_ads_account_ids', desc: 'Ads 账号 ID 列表', note: '建议 JSON 数组或换行输入' },
]

const STRATEGY_OPTIONAL_PARAMS: ParamRow[] = [
  { key: 'openclaw_strategy_priority_asins', desc: '优先 ASIN 列表', note: '可选，JSON 数组' },
  { key: 'openclaw_strategy_default_budget', desc: '默认日预算', note: '可选（有默认值）' },
  { key: 'openclaw_strategy_max_cpc', desc: '最大 CPC', note: '可选（有默认值）' },
  { key: 'openclaw_strategy_min_cpc', desc: '最小 CPC', note: '可选（有默认值）' },
  { key: 'openclaw_strategy_daily_budget_cap', desc: '每日预算上限', note: '可选（有默认值）' },
  { key: 'openclaw_strategy_daily_spend_cap', desc: '每日花费上限', note: '可选（有默认值）' },
  { key: 'openclaw_strategy_target_roas', desc: '目标 ROAS', note: '可选（有默认值）' },
  { key: 'openclaw_strategy_enable_auto_publish', desc: '自动发布', note: '默认 true' },
  { key: 'openclaw_strategy_enable_auto_pause', desc: '自动暂停冲突 Campaign', note: '默认 true' },
  { key: 'openclaw_strategy_enable_auto_adjust_cpc', desc: '自动调整 CPC', note: '默认 true' },
  { key: 'openclaw_strategy_allow_affiliate_fetch', desc: '允许联盟平台补全', note: '默认 true' },
  { key: 'openclaw_strategy_enforce_autoads_only', desc: '仅 AutoAds 链路', note: '建议固定 true' },
  { key: 'openclaw_strategy_dry_run', desc: 'Dry Run 模式', note: '默认 false' },
]

const AI_JSON_EXAMPLE = `{
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "YOUR_API_KEY",
      "api": "openai-responses",
      "models": [
        { "id": "gpt-5-mini", "name": "GPT-5 Mini" }
      ]
    }
  }
}`

const FEISHU_ACCOUNTS_JSON_EXAMPLE = `{
  "main": {
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "botName": "AutoAds",
    "connectionMode": "websocket"
  },
  "backup": {
    "name": "backup-bot",
    "appId": "cli_backup_xxx",
    "appSecret": "backup_secret_xxx",
    "connectionMode": "webhook",
    "verificationToken": "your_verify_token",
    "encryptKey": "your_encrypt_key"
  }
}`

export default function OpenClawConfigGuidePage() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">OpenClaw 配置指南</h1>
            <p className="mt-2 text-slate-600">
              当前版本仅保留用户级配置；默认优先最小必填，其余参数可留空使用默认值。
            </p>
          </div>
          <Link href="/openclaw" className={buttonVariants({ variant: 'outline' })}>
            返回 OpenClaw
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>配置入口</CardTitle>
            <CardDescription>OpenClaw 统一为用户级配置，不再区分系统级/个人级</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">用户级</Badge>
              <span>OpenClaw → 配置中心（AI 引擎 / 飞书聊天 / 联盟平台 / 策略中心）</span>
            </div>
            <div className="text-xs text-slate-500">
              Gateway 状态在页面内只读展示，参数不在用户配置中心填写。
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>最小可用清单</CardTitle>
            <CardDescription>按此顺序配置，最快完成可用闭环</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">1. Gateway 在线</Badge>
              <Badge variant="secondary">2. AI 引擎</Badge>
              <Badge variant="secondary">3. 飞书聊天</Badge>
              <Badge variant="secondary">4. 策略中心</Badge>
            </div>
            <div>1）确认 OpenClaw 页内 Gateway 状态为在线（只读检查）。</div>
            <div>2）填写 <code className="rounded bg-slate-100 px-1 py-0.5">ai_models_json</code>。</div>
            <div>
              3）填写飞书最小三项：
              <code className="rounded bg-slate-100 px-1 py-0.5">feishu_app_id</code>、
              <code className="rounded bg-slate-100 px-1 py-0.5">feishu_app_secret</code>、
              <code className="rounded bg-slate-100 px-1 py-0.5">feishu_target</code>。
            </div>
            <div>
              4）策略至少配置：
              <code className="rounded bg-slate-100 px-1 py-0.5">openclaw_strategy_enabled</code>、
              <code className="rounded bg-slate-100 px-1 py-0.5">openclaw_strategy_cron</code>、
              <code className="rounded bg-slate-100 px-1 py-0.5">openclaw_strategy_ads_account_ids</code>。
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI 引擎（用户级）</CardTitle>
            <CardDescription>最小只需要 providers JSON</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="space-y-2">
              <div className="text-sm font-semibold text-slate-700">最小参数</div>
              <ParamTable rows={AI_MINIMAL_PARAMS} />
            </section>
            <section className="space-y-2">
              <div className="text-sm font-semibold text-slate-700">可选参数</div>
              <ParamTable rows={AI_OPTIONAL_PARAMS} />
            </section>
            <section className="space-y-2 text-sm text-slate-700">
              <div>建议从最小模板开始：</div>
              <pre className="overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">{AI_JSON_EXAMPLE}</pre>
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>飞书聊天（用户级）</CardTitle>
            <CardDescription>最小仅需 App ID / App Secret / 推送目标</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="space-y-2">
              <div className="text-sm font-semibold text-slate-700">最小参数</div>
              <ParamTable rows={FEISHU_MINIMAL_PARAMS} />
            </section>
            <section className="space-y-2">
              <div className="text-sm font-semibold text-slate-700">常用可选参数</div>
              <ParamTable rows={FEISHU_OPTIONAL_PARAMS} />
            </section>
            <section className="space-y-2">
              <div className="text-sm font-semibold text-slate-700">高级参数（默认可留空）</div>
              <ParamTable rows={FEISHU_ADVANCED_DEFAULT_PARAMS} />
            </section>
            <section className="space-y-3">
              <div className="text-sm font-semibold text-slate-700">多账号 / Webhook 扩展（可选）</div>
              <div className="text-xs text-slate-500">
                高风险命令默认自动确认并入队执行；本页仅保留近 7 天命令审计记录查看。
              </div>
              <ParamTable rows={FEISHU_ACCOUNT_JSON_FIELDS} />
              <pre className="overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">{FEISHU_ACCOUNTS_JSON_EXAMPLE}</pre>
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>联盟平台（用户级，可选）</CardTitle>
            <CardDescription>未配置时走平台默认行为；按需填写鉴权即可</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="space-y-2">
              <div className="text-sm font-semibold text-slate-700">最小参数</div>
              <ParamTable rows={AFFILIATE_MINIMAL_PARAMS} />
            </section>
            <section className="space-y-2">
              <div className="text-sm font-semibold text-slate-700">可选参数（有默认值）</div>
              <ParamTable rows={AFFILIATE_OPTIONAL_PARAMS} />
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>策略中心（用户级）</CardTitle>
            <CardDescription>先用最小参数跑通，再按需调优预算与自动化细项</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="space-y-2">
              <div className="text-sm font-semibold text-slate-700">最小参数</div>
              <ParamTable rows={STRATEGY_MINIMAL_PARAMS} />
            </section>
            <section className="space-y-2">
              <div className="text-sm font-semibold text-slate-700">可选参数（默认可用）</div>
              <ParamTable rows={STRATEGY_OPTIONAL_PARAMS} />
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>OpenClaw Access Token（用户级）</CardTitle>
            <CardDescription>用于 OpenClaw 调用 AutoAds API，按用户隔离</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <div>路径：OpenClaw → 配置中心 → OpenClaw Access Tokens → 生成新 Token</div>
            <div className="text-xs text-slate-500">每个 Token 都绑定用户身份，调用时会进行授权校验。</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>迁移说明</CardTitle>
            <CardDescription>旧文档中的系统级参数已不再作为页面配置入口</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <div>1. 原系统级/全局级配置入口已下线，当前以用户级配置为唯一入口。</div>
            <div>2. 建议先启用简化模式，仅填写最小必填参数。</div>
            <div>3. 若历史环境存在旧键，建议在用户级页面逐项保存完成迁移。</div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ParamTable({ rows }: { rows: ParamRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[280px]">参数</TableHead>
          <TableHead>说明</TableHead>
          <TableHead className="w-[240px]">备注</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="font-mono text-xs text-slate-700">{row.key}</TableCell>
            <TableCell className="text-sm text-slate-700">{row.desc}</TableCell>
            <TableCell className="text-sm text-slate-500">{row.note || '-'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
