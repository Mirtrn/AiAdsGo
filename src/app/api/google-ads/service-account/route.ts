import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { parseServiceAccountJson } from '@/lib/google-ads-service-account'
import { encrypt } from '@/lib/crypto'
import { getUserIdFromRequest, findUserById } from '@/lib/auth'

async function getAuthenticatedUser(request: NextRequest) {
  const userId = getUserIdFromRequest(request)
  if (!userId) return null
  return await findUserById(userId)
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { name, mccCustomerId, developerToken, serviceAccountJson } = await req.json()

    const { clientEmail, privateKey, projectId } = parseServiceAccountJson(serviceAccountJson)
    const encryptedPrivateKey = encrypt(privateKey)

    const db = await getDatabase()

    // 🔧 防止重复绑定：同一用户不允许多次绑定相同的 MCC ID
    const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
    const cleanMccId = mccCustomerId ? String(mccCustomerId).replace(/[\s-]/g, '') : ''

    // 🔧 格式校验：MCC Customer ID 必须是 10 位纯数字
    if (!cleanMccId || !/^\d{10}$/.test(cleanMccId)) {
      return NextResponse.json({ error: 'MCC Customer ID 格式错误，必须是10位数字（例如：1234567890）' }, { status: 400 })
    }
    const existing = await db.queryOne(`
      SELECT id FROM google_ads_service_accounts
      WHERE user_id = ? AND mcc_customer_id = ? AND ${isActiveCondition}
      LIMIT 1
    `, [user.id, cleanMccId])
    if (existing) {
      return NextResponse.json({ error: `MCC 账号 ${cleanMccId} 已绑定，请勿重复添加` }, { status: 409 })
    }

    const id = crypto.randomUUID()
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    // 🔧 支持多MCC绑定：直接追加插入，不再全量删除
    // 新记录默认 api_access_level = 'explorer'
    const preservedAccessLevel = 'explorer'

    // 统一使用 cleanMccId（去除空格和横杠）存储，保证后续 mcc_customer_id 查询一致
    await db.exec(`
      INSERT INTO google_ads_service_accounts (
        id, user_id, name, mcc_customer_id, developer_token,
        service_account_email, private_key, project_id,
        api_access_level, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})
    `, [id, user.id, name, cleanMccId, developerToken, clientEmail, encryptedPrivateKey, projectId, preservedAccessLevel])

    return NextResponse.json({ success: true, id })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = await getDatabase()

  // 🔧 历史数据自愈：将存量中带横杠/空格的 mcc_customer_id 一次性清洗为纯数字格式
  // 新版 POST 路由已统一存储 cleanMccId，此处兜底兼容旧数据，防止 MCC 路由匹配失败
  try {
    await db.exec(`
      UPDATE google_ads_service_accounts
      SET mcc_customer_id = REPLACE(REPLACE(mcc_customer_id, '-', ''), ' ', ''),
          updated_at = ${db.type === 'postgres' ? 'NOW()' : "datetime('now')"}
      WHERE user_id = ?
        AND (mcc_customer_id LIKE '%-%' OR mcc_customer_id LIKE '% %')
    `, [user.id])
  } catch {
    // 自愈失败不影响正常查询流程
  }

  const accounts = await db.query(`
    SELECT id, name, mcc_customer_id, service_account_email, is_active, created_at
    FROM google_ads_service_accounts
    WHERE user_id = ?
    ORDER BY created_at DESC
  `, [user.id])

  return NextResponse.json({ accounts })
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }

    const db = await getDatabase()

    // 先解除 google_ads_accounts 对该服务账号的外键引用，避免外键约束冲突
    await db.exec(`
      UPDATE google_ads_accounts
      SET service_account_id = NULL
      WHERE service_account_id = ?
    `, [id])

    await db.exec(`
      DELETE FROM google_ads_service_accounts
      WHERE id = ? AND user_id = ?
    `, [id, user.id])

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
