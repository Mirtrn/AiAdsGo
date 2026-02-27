import { NextRequest, NextResponse } from 'next/server'
import { verifyProductManagementSessionAuth } from '@/lib/openclaw/request-auth'
import {
  buildYeahPromosCaptureBookmarklet,
  createYeahPromosCaptureChallenge,
} from '@/lib/yeahpromos-session'

export async function POST(request: NextRequest) {
  const auth = await verifyProductManagementSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const challenge = await createYeahPromosCaptureChallenge(auth.user.userId)
  const origin = request.nextUrl.origin
  const captureUrl = `${origin}/api/products/yeahpromos/session/capture`
  const loginUrl = 'https://yeahpromos.com/index/login/login'
  const productsUrl = 'https://yeahpromos.com/index/offer/products'

  return NextResponse.json({
    success: true,
    loginUrl,
    productsUrl,
    captureUrl,
    captureTokenExpiresAt: challenge.expiresAt,
    bookmarklet: buildYeahPromosCaptureBookmarklet({
      captureUrl,
      captureToken: challenge.captureToken,
    }),
  })
}
