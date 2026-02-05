import { getDatabase } from '@/lib/db'
import { updateSettings } from '@/lib/settings'
import { getOpenclawFeishuDocConfig } from '@/lib/openclaw/feishu-config'
import { feishuRequest, getTenantAccessToken, resolveFeishuApiBase } from '@/lib/openclaw/feishu-api'

type DailyReportPayload = {
  date: string
  summary?: any
  kpis?: any
  roi?: any
  actions?: any[]
  budget?: any
  campaigns?: any
  trends?: any
  generatedAt?: string
}

type FeishuDocRow = {
  id: number
  user_id: number
  bitable_app_token: string | null
  bitable_table_id: string | null
  folder_token: string | null
  last_doc_token: string | null
  last_doc_date: string | null
}

async function getFeishuDocRow(userId: number): Promise<FeishuDocRow | null> {
  const db = await getDatabase()
  const row = await db.queryOne<FeishuDocRow>(
    'SELECT * FROM openclaw_feishu_docs WHERE user_id = ? LIMIT 1',
    [userId]
  )
  return row || null
}

async function upsertFeishuDocRow(userId: number, updates: Partial<FeishuDocRow>) {
  const db = await getDatabase()
  const existing = await getFeishuDocRow(userId)
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  if (existing) {
    const fields: string[] = []
    const values: any[] = []
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id' || key === 'user_id') continue
      fields.push(`${key} = ?`)
      values.push(value ?? null)
    }
    if (fields.length === 0) return
    await db.exec(
      `UPDATE openclaw_feishu_docs SET ${fields.join(', ')}, updated_at = ${nowFunc} WHERE user_id = ?`,
      [...values, userId]
    )
  } else {
    await db.exec(
      `INSERT INTO openclaw_feishu_docs (user_id, bitable_app_token, bitable_table_id, folder_token, last_doc_token, last_doc_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})`,
      [
        userId,
        updates.bitable_app_token ?? null,
        updates.bitable_table_id ?? null,
        updates.folder_token ?? null,
        updates.last_doc_token ?? null,
        updates.last_doc_date ?? null,
      ]
    )
  }
}

function buildDocLines(report: DailyReportPayload): string[] {
  const summary = report.summary?.kpis || {}
  const roi = report.roi?.data?.overall || {}
  const totalCost = Number(roi.totalCost) || 0
  const totalRevenue = Number(roi.totalRevenue) || 0
  const roas = totalCost > 0 ? totalRevenue / totalCost : 0

  const lines: string[] = []
  lines.push(`OpenClaw 每日报表 ${report.date}`)
  lines.push(`生成时间: ${report.generatedAt || new Date().toISOString()}`)
  lines.push('')
  lines.push(`Offers: ${summary.totalOffers ?? 0}`)
  lines.push(`Campaigns: ${summary.totalCampaigns ?? 0}`)
  lines.push(`Clicks: ${summary.totalClicks ?? 0}`)
  lines.push(`Cost: ${totalCost}`)
  lines.push(`Revenue: ${totalRevenue}`)
  lines.push(`ROAS: ${roas.toFixed(2)}x`)
  lines.push(`ROI: ${roi.roi ?? 0}%`)
  lines.push('')
  lines.push(`操作记录: ${(report.actions || []).length}`)
  return lines
}

async function ensureBitableTable(params: {
  userId: number
  appToken: string
  tableId?: string
  tableName: string
  token: string
  apiBase: string
}): Promise<string> {
  if (params.tableId) return params.tableId

  const createTable = await feishuRequest<{ data?: { table_id?: string } }>(
    {
      method: 'POST',
      url: `${params.apiBase}/bitable/v1/apps/${params.appToken}/tables`,
      token: params.token,
      body: {
        table: { name: params.tableName },
      },
    }
  )

  const tableId = createTable?.data?.table_id
  if (!tableId) {
    throw new Error('Feishu Bitable table create failed: missing table_id')
  }

  const fields = [
    'Date',
    'Offers',
    'Campaigns',
    'Revenue',
    'Cost',
    'ROAS',
    'ROI',
    'Actions',
    'Notes',
  ]

  for (const fieldName of fields) {
    try {
      await feishuRequest(
        {
          method: 'POST',
          url: `${params.apiBase}/bitable/v1/apps/${params.appToken}/tables/${tableId}/fields`,
          token: params.token,
          body: {
            field_name: fieldName,
            type: 1,
          },
        }
      )
    } catch (error) {
      console.warn(`Feishu Bitable field create skipped: ${fieldName}`, error)
    }
  }

  await updateSettings(
    [{ category: 'openclaw', key: 'feishu_bitable_table_id', value: tableId }],
    params.userId
  )

  await upsertFeishuDocRow(params.userId, {
    bitable_app_token: params.appToken,
    bitable_table_id: tableId,
  })

  return tableId
}

export async function writeDailyReportToBitable(userId: number, report: DailyReportPayload): Promise<void> {
  const config = await getOpenclawFeishuDocConfig(userId)
  if (!config.appId || !config.appSecret || !config.bitableAppToken) return

  const token = await getTenantAccessToken({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: config.domain,
  })
  const apiBase = resolveFeishuApiBase(config.domain)

  const tableId = await ensureBitableTable({
    userId,
    appToken: config.bitableAppToken,
    tableId: config.bitableTableId,
    tableName: config.bitableTableName || 'OpenClaw Daily Report',
    token,
    apiBase,
  })

  const roi = report.roi?.data?.overall || {}
  const totalCost = Number(roi.totalCost) || 0
  const totalRevenue = Number(roi.totalRevenue) || 0
  const roas = totalCost > 0 ? totalRevenue / totalCost : 0

  await feishuRequest(
    {
      method: 'POST',
      url: `${apiBase}/bitable/v1/apps/${config.bitableAppToken}/tables/${tableId}/records/batch_create`,
      token,
      body: {
        records: [
          {
            fields: {
              Date: report.date,
              Offers: String(report.summary?.kpis?.totalOffers ?? 0),
              Campaigns: String(report.summary?.kpis?.totalCampaigns ?? 0),
              Revenue: String(totalRevenue),
              Cost: String(totalCost),
              ROAS: roas.toFixed(2),
              ROI: String(roi.roi ?? 0),
              Actions: String((report.actions || []).length),
              Notes: '',
            },
          },
        ],
      },
    }
  )
}

async function createDoc(params: {
  apiBase: string
  token: string
  title: string
  folderToken?: string
}): Promise<string> {
  const payload: Record<string, any> = { title: params.title }
  if (params.folderToken) {
    payload.folder_token = params.folderToken
  }

  const result = await feishuRequest<{ data?: { document_id?: string } }>(
    {
      method: 'POST',
      url: `${params.apiBase}/docx/v1/documents`,
      token: params.token,
      body: payload,
    }
  )

  const documentId = result?.data?.document_id
  if (!documentId) {
    throw new Error('Feishu doc create failed: missing document_id')
  }
  return documentId
}

async function appendDocLines(params: {
  apiBase: string
  token: string
  documentId: string
  lines: string[]
}) {
  if (params.lines.length === 0) return
  const chunks: string[][] = []
  const chunkSize = 40
  for (let i = 0; i < params.lines.length; i += chunkSize) {
    chunks.push(params.lines.slice(i, i + chunkSize))
  }

  for (const group of chunks) {
    const children = group.map((line) => ({
      block_type: 2,
      text: {
        elements: [
          {
            text_run: {
              content: line,
            },
          },
        ],
      },
    }))

    await feishuRequest(
      {
        method: 'POST',
        url: `${params.apiBase}/docx/v1/documents/${params.documentId}/blocks/${params.documentId}/children`,
        token: params.token,
        body: { children },
      }
    )
  }
}

export async function writeDailyReportToDoc(userId: number, report: DailyReportPayload): Promise<void> {
  const config = await getOpenclawFeishuDocConfig(userId)
  if (!config.appId || !config.appSecret || !config.docFolderToken) return

  const token = await getTenantAccessToken({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: config.domain,
  })
  const apiBase = resolveFeishuApiBase(config.domain)

  const docRow = await getFeishuDocRow(userId)
  const shouldReuse = docRow?.last_doc_date === report.date && docRow?.last_doc_token
  const docTitlePrefix = config.docTitlePrefix || 'OpenClaw 每日报表'
  const docTitle = `${docTitlePrefix} ${report.date}`

  const documentId = shouldReuse
    ? (docRow!.last_doc_token as string)
    : await createDoc({
        apiBase,
        token,
        title: docTitle,
        folderToken: config.docFolderToken,
      })

  await appendDocLines({
    apiBase,
    token,
    documentId,
    lines: buildDocLines(report),
  })

  await upsertFeishuDocRow(userId, {
    folder_token: config.docFolderToken || null,
    last_doc_token: documentId,
    last_doc_date: report.date,
  })
}
