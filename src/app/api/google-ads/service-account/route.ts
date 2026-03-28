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

    const db = getDatabase()
    const id = crypto.randomUUID()
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    // 🔧 修复：只保留1个服务账号，先读取旧的访问级别，再删除，再插入新的
    // 先读取旧服务账号的 api_access_level，避免重新保存时丢失已设置的等级
    const oldRecord = await db.queryOne(`
      SELECT api_access_level FROM google_ads_service_accounts WHERE user_id = ? LIMIT 1
    `, [user.id]) as { api_access_level?: string } | undefined
    const preservedAccessLevel = oldRecord?.api_access_level || 'explorer'

    // 先解除 google_ads_accounts 对旧服务账号的外键引用，避免外键约束冲突
    await db.exec(`
      UPDATE google_ads_accounts
      SET service_account_id = NULL
      WHERE service_account_id IN (
        SELECT id FROM google_ads_service_accounts WHERE user_id = ?
      )
    `, [user.id])

    await db.exec(`
      DELETE FROM google_ads_service_accounts
      WHERE user_id = ?
    `, [user.id])

    await db.exec(`
      INSERT INTO google_ads_service_accounts (
        id, user_id, name, mcc_customer_id, developer_token,
        service_account_email, private_key, project_id,
        api_access_level, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})
    `, [id, user.id, name, mccCustomerId, developerToken, clientEmail, encryptedPrivateKey, projectId, preservedAccessLevel])

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

  const db = getDatabase()
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

    const db = getDatabase()

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
