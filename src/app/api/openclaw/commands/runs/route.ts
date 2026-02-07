import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listOpenclawCommandRuns } from '@/lib/openclaw/commands/runs-service'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

const runsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.string().optional(),
  riskLevel: z.string().optional(),
})

export async function GET(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  const queryObject = {
    page: request.nextUrl.searchParams.get('page') || undefined,
    limit: request.nextUrl.searchParams.get('limit') || undefined,
    status: request.nextUrl.searchParams.get('status') || undefined,
    riskLevel: request.nextUrl.searchParams.get('riskLevel') || undefined,
  }

  const parsedQuery = runsQuerySchema.safeParse(queryObject)
  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: parsedQuery.error.errors[0]?.message || '请求参数错误' },
      { status: 400 }
    )
  }

  try {
    const result = await listOpenclawCommandRuns({
      userId: auth.userId,
      page: parsedQuery.data.page,
      limit: parsedQuery.data.limit,
      status: parsedQuery.data.status,
      riskLevel: parsedQuery.data.riskLevel,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    const message = error?.message || '命令运行记录查询失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
