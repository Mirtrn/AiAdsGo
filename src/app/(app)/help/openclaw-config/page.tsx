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

const GATEWAY_PARAMS: ParamRow[] = [
  { key: 'gateway_port', desc: 'OpenClaw Gateway 端口', note: '默认 18789' },
  { key: 'gateway_bind', desc: '绑定地址模式', note: 'loopback / auto / lan / tailnet' },
  { key: 'gateway_token', desc: 'Gateway 访问 Token', note: '自动生成，可手动覆盖' },
]

const FEISHU_PARAMS: ParamRow[] = [
  { key: 'feishu_app_id', desc: 'App ID（cli_xxx）', note: '必填' },
  { key: 'feishu_app_secret', desc: 'App Secret', note: '必填（敏感）' },
  { key: 'feishu_app_secret_file', desc: 'App Secret 文件路径', note: '可替代 App Secret' },
  { key: 'feishu_domain', desc: 'feishu / lark / https://...', note: '国内/国际租户' },
  { key: 'feishu_bot_name', desc: 'Bot 展示名' },
  { key: 'feishu_dm_policy', desc: 'DM 策略', note: 'pairing / allowlist / open / disabled' },
  { key: 'feishu_group_policy', desc: '群聊策略', note: 'open / allowlist / disabled' },
  { key: 'feishu_allow_from', desc: 'DM 白名单', note: 'JSON 数组（open_id / union_id）' },
  { key: 'feishu_group_allow_from', desc: '群白名单', note: 'JSON 数组（open_id / union_id）' },
  { key: 'feishu_require_mention', desc: '群聊是否强制 @', note: '默认 true' },
  { key: 'feishu_history_limit', desc: '群历史消息数', note: '默认 20' },
  { key: 'feishu_dm_history_limit', desc: 'DM 历史消息数', note: '默认 20' },
  { key: 'feishu_streaming', desc: '是否流式回复', note: '默认 true' },
  { key: 'feishu_block_streaming', desc: '禁用 block streaming', note: '默认 false' },
  { key: 'feishu_text_chunk_limit', desc: '消息分块长度', note: '默认 2000' },
  { key: 'feishu_chunk_mode', desc: '分块策略', note: 'length / newline' },
  { key: 'feishu_config_writes', desc: '允许频道内写配置', note: '默认 true' },
  { key: 'feishu_markdown_tables', desc: 'Markdown 表格模式', note: 'off / bullets / code' },
  { key: 'feishu_media_max_mb', desc: '媒体最大 MB' },
  { key: 'feishu_response_prefix', desc: '回复前缀' },
  { key: 'feishu_groups_json', desc: '群组级配置 JSON', note: 'groups.<chat_id>' },
  { key: 'feishu_accounts_json', desc: '多账号 JSON', note: 'accounts.<id>' },
]

const FEISHU_DOC_PARAMS: ParamRow[] = [
  { key: 'feishu_target', desc: '飞书推送目标', note: 'open_id / union_id / chat_id' },
  { key: 'feishu_doc_folder_token', desc: '飞书文档目录 Token', note: 'fldc_xxx' },
  { key: 'feishu_doc_title_prefix', desc: '文档标题前缀', note: 'OpenClaw 每日报表' },
  { key: 'feishu_bitable_app_token', desc: 'Bitable App Token', note: 'basc_xxx' },
  { key: 'feishu_bitable_table_id', desc: 'Bitable Table ID', note: 'tbl_xxx，可留空自动创建' },
  { key: 'feishu_bitable_table_name', desc: 'Bitable Table Name', note: 'OpenClaw Daily Report' },
]

const YEAHPROMOS_PARAMS: ParamRow[] = [
  { key: 'yeahpromos_token', desc: 'API Token' },
  { key: 'yeahpromos_site_id', desc: 'Site ID' },
  { key: 'yeahpromos_start_date', desc: '起始日期', note: 'YYYY-MM-DD' },
  { key: 'yeahpromos_end_date', desc: '结束日期', note: 'YYYY-MM-DD' },
  { key: 'yeahpromos_is_amazon', desc: '仅 Amazon 订单', note: '1=是' },
  { key: 'yeahpromos_page', desc: '默认页码' },
  { key: 'yeahpromos_limit', desc: '默认条数' },
]

const PARTNERBOOST_BASE: ParamRow[] = [
  { key: 'partnerboost_base_url', desc: 'API Base URL', note: '默认 https://app.partnerboost.com' },
  { key: 'partnerboost_token', desc: 'API Token' },
]

const PARTNERBOOST_PRODUCTS: ParamRow[] = [
  { key: 'partnerboost_products_page_size', desc: 'page_size' },
  { key: 'partnerboost_products_page', desc: 'page' },
  { key: 'partnerboost_products_default_filter', desc: 'default_filter' },
  { key: 'partnerboost_products_country_code', desc: 'country_code' },
  { key: 'partnerboost_products_brand_id', desc: 'brand_id' },
  { key: 'partnerboost_products_sort', desc: 'sort' },
  { key: 'partnerboost_products_asins', desc: 'asins' },
  { key: 'partnerboost_products_relationship', desc: 'relationship' },
  { key: 'partnerboost_products_is_original_currency', desc: 'is_original_currency' },
  { key: 'partnerboost_products_has_promo_code', desc: 'has_promo_code' },
  { key: 'partnerboost_products_has_acc', desc: 'has_acc' },
  { key: 'partnerboost_products_filter_sexual_wellness', desc: 'filter_sexual_wellness' },
]

const PARTNERBOOST_LINKS: ParamRow[] = [
  { key: 'partnerboost_link_product_ids', desc: 'product_ids' },
  { key: 'partnerboost_link_asins', desc: 'asins' },
  { key: 'partnerboost_link_country_code', desc: 'country_code' },
  { key: 'partnerboost_link_uid', desc: 'uid' },
  { key: 'partnerboost_link_return_partnerboost_link', desc: 'return_partnerboost_link' },
  { key: 'partnerboost_link_status_link_ids', desc: 'link_ids' },
]

const PARTNERBOOST_BRANDS: ParamRow[] = [
  { key: 'partnerboost_brands_bids', desc: 'bids (brands)' },
  { key: 'partnerboost_brands_page_size', desc: 'page_size (brands)' },
  { key: 'partnerboost_brands_page', desc: 'page (brands)' },
  { key: 'partnerboost_storefront_bids', desc: 'bids (storefront)' },
  { key: 'partnerboost_storefront_uid', desc: 'uid (storefront)' },
]

const PARTNERBOOST_REPORT: ParamRow[] = [
  { key: 'partnerboost_report_page_size', desc: 'page_size' },
  { key: 'partnerboost_report_page', desc: 'page' },
  { key: 'partnerboost_report_start_date', desc: 'start_date', note: 'YYYYMMDD' },
  { key: 'partnerboost_report_end_date', desc: 'end_date', note: 'YYYYMMDD' },
  { key: 'partnerboost_report_marketplace', desc: 'marketplace' },
  { key: 'partnerboost_report_asins', desc: 'asins' },
  { key: 'partnerboost_report_ad_group_ids', desc: 'adGroupIds' },
  { key: 'partnerboost_report_order_ids', desc: 'order_ids' },
]

const PARTNERBOOST_ASSOCIATES: ParamRow[] = [
  { key: 'partnerboost_associates_page_size', desc: 'page_size' },
  { key: 'partnerboost_associates_page', desc: 'page' },
  { key: 'partnerboost_associates_filter_sexual_wellness', desc: 'filter_sexual_wellness' },
  { key: 'partnerboost_associates_region', desc: 'region' },
]

const STRATEGY_PARAMS: ParamRow[] = [
  { key: 'openclaw_strategy_enabled', desc: '启用策略', note: 'true/false' },
  { key: 'openclaw_strategy_cron', desc: 'Cron 表达式', note: '默认 0 9 * * *' },
  { key: 'openclaw_strategy_max_offers_per_run', desc: '每次最大Offer数' },
  { key: 'openclaw_strategy_default_budget', desc: '默认日预算' },
  { key: 'openclaw_strategy_max_cpc', desc: '最大CPC' },
  { key: 'openclaw_strategy_min_cpc', desc: '最小CPC' },
  { key: 'openclaw_strategy_daily_budget_cap', desc: '每日预算上限' },
  { key: 'openclaw_strategy_daily_spend_cap', desc: '每日花费上限' },
  { key: 'openclaw_strategy_target_roas', desc: '目标ROAS' },
  { key: 'openclaw_strategy_ads_account_ids', desc: 'Ads账号ID列表', note: 'JSON数组' },
  { key: 'openclaw_strategy_enable_auto_publish', desc: '自动发布' },
  { key: 'openclaw_strategy_enable_auto_pause', desc: '自动暂停冲突Campaign' },
  { key: 'openclaw_strategy_enable_auto_adjust_cpc', desc: '自动调整CPC' },
  { key: 'openclaw_strategy_allow_affiliate_fetch', desc: '允许联盟平台补全' },
  { key: 'openclaw_strategy_enforce_autoads_only', desc: '仅AutoAds发布链路', note: '建议固定 true' },
  { key: 'openclaw_strategy_dry_run', desc: 'Dry Run 模式' },
]

const OPENCLAW_ADVANCED_PARAMS: ParamRow[] = [
  { key: 'openclaw_agent_defaults_json', desc: 'agents.defaults (JSON)' },
  { key: 'openclaw_agent_list_json', desc: 'agents.list (JSON)' },
  { key: 'openclaw_session_json', desc: 'session (JSON)' },
  { key: 'openclaw_messages_json', desc: 'messages (JSON)' },
  { key: 'openclaw_commands_json', desc: 'commands (JSON)' },
  { key: 'openclaw_approvals_exec_json', desc: 'approvals.exec (JSON)' },
  { key: 'openclaw_models_mode', desc: 'models.mode', note: 'merge / replace' },
  { key: 'openclaw_models_bedrock_discovery_json', desc: 'models.bedrockDiscovery (JSON)' },
  { key: 'openclaw_logging_redact_patterns_json', desc: 'logging.redactPatterns (JSON array)' },
  { key: 'openclaw_diagnostics_otel_json', desc: 'diagnostics.otel (JSON)' },
]

const AI_JSON_EXAMPLE = `{
  "providers": {
    "aicodecat-gpt": {
      "baseUrl": "https://aicode.cat/v1",
      "apiKey": "YOUR_KEY",
      "api": "openai-responses",
      "models": [
        {
          "id": "gpt-5.2",
          "name": "GPT-5.2",
          "reasoning": true,
          "input": ["text", "image"],
          "cost": { "input": 1.75, "output": 14, "cacheRead": 0.175, "cacheWrite": 0 },
          "contextWindow": 400000,
          "maxTokens": 128000
        }
      ]
    }
  }
}`

export default function OpenClawConfigGuidePage() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">OpenClaw 配置指南</h1>
            <p className="text-slate-600 mt-2">
              解释 OpenClaw 在 AutoAds 中的配置参数、作用与配置方法。配置优先在「OpenClaw → 配置中心」完成。
            </p>
          </div>
          <Link href="/openclaw" className={buttonVariants({ variant: 'outline' })}>
            返回 OpenClaw
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>配置入口</CardTitle>
            <CardDescription>系统级与用户级配置入口说明</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">系统级</Badge>
              <span>OpenClaw → 配置中心 → 系统级配置（管理员可编辑）</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">用户级</Badge>
              <span>OpenClaw → 配置中心 → 个人配置</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Gateway 参数</CardTitle>
            <CardDescription>OpenClaw Gateway 的连接与鉴权配置</CardDescription>
          </CardHeader>
          <CardContent>
            <ParamTable rows={GATEWAY_PARAMS} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI 引擎参数（ai_models_json）</CardTitle>
            <CardDescription>配置 OpenClaw 模型提供商与模型列表</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <div>支持直接传入 <strong>providers</strong> 或 <strong>models.providers</strong> 结构。</div>
            <div className="text-xs text-slate-500">建议只填写实际可用的模型与 API Key。</div>
            <pre className="bg-slate-900 text-slate-100 rounded-md p-4 text-xs overflow-auto">
              {AI_JSON_EXAMPLE}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>飞书参数</CardTitle>
            <CardDescription>与 OpenClaw Feishu 插件配置一致</CardDescription>
          </CardHeader>
          <CardContent>
            <ParamTable rows={FEISHU_PARAMS} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>飞书文档 / Bitable（用户级）</CardTitle>
            <CardDescription>用于每日报表写入飞书文档与多维表格</CardDescription>
          </CardHeader>
          <CardContent>
            <ParamTable rows={FEISHU_DOC_PARAMS} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>广告联盟平台（可共存）</CardTitle>
            <CardDescription>YeahPromos 与 PartnerBoost(Amazon) 可同时配置</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <section className="space-y-2">
              <div className="text-sm font-semibold text-slate-700">YeahPromos</div>
              <ParamTable rows={YEAHPROMOS_PARAMS} />
            </section>

            <section className="space-y-4">
              <div className="text-sm font-semibold text-slate-700">PartnerBoost (Amazon)</div>
              <div className="space-y-3">
                <div className="text-xs uppercase text-slate-500">Base</div>
                <ParamTable rows={PARTNERBOOST_BASE} />
              </div>
              <div className="space-y-3">
                <div className="text-xs uppercase text-slate-500">Get Products API</div>
                <ParamTable rows={PARTNERBOOST_PRODUCTS} />
              </div>
              <div className="space-y-3">
                <div className="text-xs uppercase text-slate-500">Link APIs</div>
                <ParamTable rows={PARTNERBOOST_LINKS} />
              </div>
              <div className="space-y-3">
                <div className="text-xs uppercase text-slate-500">Brands / Storefront APIs</div>
                <ParamTable rows={PARTNERBOOST_BRANDS} />
              </div>
              <div className="space-y-3">
                <div className="text-xs uppercase text-slate-500">Amazon Report API</div>
                <ParamTable rows={PARTNERBOOST_REPORT} />
              </div>
              <div className="space-y-3">
                <div className="text-xs uppercase text-slate-500">Associates ASIN List API</div>
                <ParamTable rows={PARTNERBOOST_ASSOCIATES} />
              </div>
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>策略中心（用户级）</CardTitle>
            <CardDescription>OpenClaw 自我进化策略参数</CardDescription>
          </CardHeader>
          <CardContent>
            <ParamTable rows={STRATEGY_PARAMS} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>OpenClaw 高级配置（JSON）</CardTitle>
            <CardDescription>按 OpenClaw schema 扩展能力，留空使用默认</CardDescription>
          </CardHeader>
          <CardContent>
            <ParamTable rows={OPENCLAW_ADVANCED_PARAMS} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>用户级配置</CardTitle>
            <CardDescription>每个用户独立绑定飞书推送目标</CardDescription>
          </CardHeader>
          <CardContent>
            <ParamTable rows={[{ key: 'feishu_target', desc: '推送目标', note: 'open_id / union_id / chat_id' }]} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>OpenClaw Access Token</CardTitle>
            <CardDescription>OpenClaw 调用 AutoAds API 的用户级 Token</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-700 space-y-2">
            <div>路径：OpenClaw → 配置中心 → OpenClaw Access Tokens → 生成新 Token</div>
            <div className="text-xs text-slate-500">每个 Token 都绑定用户身份，调用时会进行授权校验。</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>日志与排障</CardTitle>
            <CardDescription>OpenClaw 日志默认输出到容器 stdout</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <div>默认：<code className="bg-slate-100 px-2 py-0.5 rounded">logging.file=/proc/self/fd/1</code></div>
            <div>可用环境变量覆盖：</div>
            <pre className="bg-slate-900 text-slate-100 rounded-md p-4 text-xs overflow-auto">
OPENCLAW_LOG_FILE=/tmp/openclaw/openclaw-YYYY-MM-DD.log
OPENCLAW_CONSOLE_LEVEL=info
OPENCLAW_CONSOLE_STYLE=compact
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>安全提示</CardTitle>
            <CardDescription>敏感信息建议</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-700 space-y-2">
            <div>1. Gateway Token 与 OpenClaw Token 均为高敏感信息，禁止外泄。</div>
            <div>2. 建议按用户独立生成 Token，并定期轮换。</div>
            <div>3. 如怀疑泄露，请立即撤销 Token 并重新生成。</div>
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
          <TableHead className="w-[240px]">参数</TableHead>
          <TableHead>说明</TableHead>
          <TableHead className="w-[220px]">备注</TableHead>
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
