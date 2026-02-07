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
  {
    key: 'feishu_accounts_json',
    desc: '多账号 JSON',
    note: 'accounts.<id>（支持 cardCallbackPath/cardVerificationToken/cardConfirmUrl 等 card* 字段）',
  },
]

const FEISHU_CARD_ACCOUNT_FIELDS: ParamRow[] = [
  {
    key: 'feishu_accounts_json.<account>.cardCallbackPath',
    desc: '卡片回调路径',
    note: '默认 main=/feishu/card-action；子账号=/feishu/<accountId>/card-action',
  },
  {
    key: 'feishu_accounts_json.<account>.cardVerificationToken',
    desc: '飞书卡片回调 Verification Token',
    note: '来自飞书开放平台卡片回传设置',
  },
  {
    key: 'feishu_accounts_json.<account>.cardEncryptKey',
    desc: '飞书卡片回调 Encrypt Key',
    note: '飞书开启加密传输时必填',
  },
  {
    key: 'feishu_accounts_json.<account>.cardConfirmUrl',
    desc: '确认接口地址',
    note: '建议 https://<domain>/api/openclaw/commands/confirm',
  },
  {
    key: 'feishu_accounts_json.<account>.cardConfirmAuthToken',
    desc: '确认接口鉴权 Token',
    note: '建议与 gateway_token 一致',
  },
  {
    key: 'feishu_accounts_json.<account>.cardConfirmTimeoutMs',
    desc: '确认请求超时（毫秒）',
    note: '推荐 10000（范围 1000~60000）',
  },
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
  { key: 'openclaw_skills_entries_json', desc: 'skills.entries (JSON)' },
  { key: 'openclaw_skills_allow_bundled_json', desc: 'skills.allowBundled (JSON array)' },
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

const FEISHU_ACCOUNTS_JSON_EXAMPLE = `{
  "main": {
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "botName": "AutoAds",
    "cardCallbackPath": "/feishu/card-action",
    "cardVerificationToken": "your_feishu_verification_token",
    "cardEncryptKey": "your_feishu_encrypt_key",
    "cardConfirmUrl": "https://your-domain.com/api/openclaw/commands/confirm",
    "cardConfirmAuthToken": "your_gateway_token",
    "cardConfirmTimeoutMs": 10000
  }
}`

const NGINX_SPLIT_SNIPPET = `upstream nextjs {
  server 127.0.0.1:3000;
}

upstream openclaw_gateway {
  server 127.0.0.1:18789;
}

# 飞书卡片回调路径转发给 OpenClaw Gateway
location ~ ^/feishu(?:/[^/]+)?/card-action$ {
  proxy_pass http://openclaw_gateway;
}

# 其余请求仍交给 Next.js
location / {
  proxy_pass http://nextjs;
}`

const CARD_CONFIRM_ENV_EXAMPLE = `# 可选环境变量（同机部署常不需要覆盖）
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
OPENCLAW_CARD_CONFIRM_URL=https://your-domain.com/api/openclaw/commands/confirm
OPENCLAW_CARD_CONFIRM_TOKEN=replace_with_gateway_token
OPENCLAW_CARD_CONFIRM_TIMEOUT_MS=10000`

export default function OpenClawConfigGuidePage() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">OpenClaw 配置指南</h1>
            <p className="mt-2 text-slate-600">
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
            <CardTitle>生产上线最小清单</CardTitle>
            <CardDescription>按此顺序配置，最快完成可用闭环</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">1. Gateway</Badge>
              <Badge variant="secondary">2. Feishu Bot</Badge>
              <Badge variant="secondary">3. 卡片回调</Badge>
              <Badge variant="secondary">4. 用户绑定</Badge>
              <Badge variant="secondary">5. 联调验证</Badge>
            </div>
            <div>1）先确认 Gateway 正常启动并记录 <code className="rounded bg-slate-100 px-1 py-0.5">gateway_token</code>。</div>
            <div>2）完成飞书应用配置（App ID / Secret + Bot 权限 + 事件订阅）。</div>
            <div>3）配置卡片回调地址（默认 <code className="rounded bg-slate-100 px-1 py-0.5">/feishu/card-action</code>）。</div>
            <div>4）将飞书用户绑定到 AutoAds 用户（<code className="rounded bg-slate-100 px-1 py-0.5">openclaw_user_bindings</code>）。</div>
            <div>5）发起一个高风险动作，验证“卡片确认 → 入队执行”全链路。</div>
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
            <div>
              支持直接传入 <strong>providers</strong> 或 <strong>models.providers</strong> 结构。
            </div>
            <div className="text-xs text-slate-500">建议只填写实际可用的模型与 API Key。</div>
            <pre className="overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">{AI_JSON_EXAMPLE}</pre>
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
            <CardTitle>高风险动作卡片确认（必须）</CardTitle>
            <CardDescription>OpenClaw 发送确认卡片，点击后回调 AutoAds 进行确认执行</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ParamTable rows={FEISHU_CARD_ACCOUNT_FIELDS} />
            <div className="space-y-2 text-sm text-slate-700">
              <div>推荐在 <code className="rounded bg-slate-100 px-1 py-0.5">feishu_accounts_json</code> 中显式配置 card 字段：</div>
              <pre className="overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">{FEISHU_ACCOUNTS_JSON_EXAMPLE}</pre>
            </div>
            <div className="space-y-2 text-sm text-slate-700">
              <div>也可通过环境变量兜底（配置优先级低于 account JSON）：</div>
              <pre className="overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">{CARD_CONFIRM_ENV_EXAMPLE}</pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Nginx 80 端口分流</CardTitle>
            <CardDescription>对外仅开放 80，内部将飞书卡片回调分流到 OpenClaw Gateway</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <div>
              回调路径建议使用 <code className="rounded bg-slate-100 px-1 py-0.5">/feishu/card-action</code>（或
              <code className="rounded bg-slate-100 px-1 py-0.5">/feishu/&lt;accountId&gt;/card-action</code>）。
            </div>
            <pre className="overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">{NGINX_SPLIT_SNIPPET}</pre>
            <div className="text-xs text-slate-500">生效前请执行：<code className="rounded bg-slate-100 px-1 py-0.5">nginx -t</code>，然后 reload。</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>用户级隔离与回调映射</CardTitle>
            <CardDescription>回调地址可共用，但用户身份必须严格映射，避免跨用户数据混用</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <div>
              1）飞书回调不要求“每用户一个 URL”；推荐共用入口，再通过头信息做用户映射。
            </div>
            <div>
              2）网关会透传 <code className="rounded bg-slate-100 px-1 py-0.5">x-openclaw-account-id</code>、
              <code className="rounded bg-slate-100 px-1 py-0.5">x-openclaw-tenant-key</code>、
              <code className="rounded bg-slate-100 px-1 py-0.5">x-openclaw-sender</code>。
            </div>
            <div>
              3）AutoAds 侧使用 <code className="rounded bg-slate-100 px-1 py-0.5">openclaw_user_bindings</code> 解析用户；
              Feishu 渠道要求 tenant/account 至少命中其一。
            </div>
            <div>
              4）确认执行时还会校验 <code className="rounded bg-slate-100 px-1 py-0.5">runId + userId</code> 一致性，防止跨用户确认。
            </div>
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
            <CardTitle>OpenClaw Access Token</CardTitle>
            <CardDescription>OpenClaw 调用 AutoAds API 的用户级 Token</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
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
            <div>
              默认：
              <code className="rounded bg-slate-100 px-2 py-0.5">logging.file=/proc/self/fd/1</code>
            </div>
            <div>可用环境变量覆盖：</div>
            <pre className="overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">
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
          <CardContent className="space-y-2 text-sm text-slate-700">
            <div>1. Gateway Token、Card Confirm Token、OpenClaw Token 均为高敏感信息，禁止外泄。</div>
            <div>2. 建议按用户独立生成 Token，并定期轮换。</div>
            <div>3. 如怀疑泄露，请立即撤销 Token、更新回调 Token 并复测卡片确认链路。</div>
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
