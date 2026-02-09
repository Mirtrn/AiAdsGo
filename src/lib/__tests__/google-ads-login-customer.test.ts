import { describe, expect, it } from 'vitest'
import { resolveLoginCustomerId } from '@/lib/google-ads-login-customer'

describe('resolveLoginCustomerId', () => {
  it('prefers account parent MCC in oauth mode', () => {
    const result = resolveLoginCustomerId({
      authType: 'oauth',
      accountParentMccId: '8551016013',
      oauthLoginCustomerId: '7137504017',
    })

    expect(result).toBe('8551016013')
  })

  it('falls back to oauth credential login customer id when parent MCC is missing', () => {
    const result = resolveLoginCustomerId({
      authType: 'oauth',
      accountParentMccId: null,
      oauthLoginCustomerId: '7137504017',
    })

    expect(result).toBe('7137504017')
  })

  it('uses service account MCC first in service_account mode', () => {
    const result = resolveLoginCustomerId({
      authType: 'service_account',
      accountParentMccId: '8551016013',
      serviceAccountMccId: '9998887776',
      oauthLoginCustomerId: '7137504017',
    })

    expect(result).toBe('9998887776')
  })
})

