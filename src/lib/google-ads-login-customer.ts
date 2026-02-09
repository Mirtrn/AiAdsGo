type AuthType = 'oauth' | 'service_account'

interface ResolveLoginCustomerIdParams {
  authType: AuthType
  accountParentMccId?: unknown
  oauthLoginCustomerId?: unknown
  serviceAccountMccId?: unknown
}

function normalizeId(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const normalized = String(value).trim()
  return normalized || undefined
}

/**
 * 解析 Google Ads login-customer-id。
 *
 * 关键规则：
 * 1) 账号有 parent_mcc_id 时优先使用（与选中子账号绑定，支持多MCC）
 * 2) OAuth 模式下 parent 缺失时回退到凭证里的 login_customer_id
 * 3) 服务账号模式优先使用服务账号配置里的 MCC，缺失时回退到 parent
 */
export function resolveLoginCustomerId(params: ResolveLoginCustomerIdParams): string | undefined {
  const parentMccId = normalizeId(params.accountParentMccId)

  if (params.authType === 'service_account') {
    const serviceAccountMccId = normalizeId(params.serviceAccountMccId)
    return serviceAccountMccId || parentMccId
  }

  const oauthLoginCustomerId = normalizeId(params.oauthLoginCustomerId)
  return parentMccId || oauthLoginCustomerId
}

