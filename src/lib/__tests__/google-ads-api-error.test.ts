import { describe, expect, it } from 'vitest'

import { formatGoogleAdsApiError } from '@/lib/google-ads-api-error'

describe('formatGoogleAdsApiError', () => {
  it('formats policy_violation_details with actionable context', () => {
    const error = {
      request_id: 'nlyd5wqRrXgcCgAlvLur0Q',
      errors: [
        {
          message: 'A policy was violated. See PolicyViolationDetails for more detail.',
          trigger: { string_value: 'kahi' },
          location: {
            field_path_elements: [
              { field_name: 'operations', index: 0 },
              { field_name: 'create' },
              { field_name: 'keyword' },
              { field_name: 'text' },
            ],
          },
          details: {
            policy_violation_details: {
              external_policy_description:
                "Your account must have a copyright certificate for the domain on which you're promoting the streaming or downloading of copyrighted content.",
              key: { policy_name: 'COPYRIGHTED_CONTENT', violating_text: 'kahi' },
              external_policy_name: 'Copyrighted content',
              is_exemptible: true,
            },
          },
        },
        {
          message: 'A policy was violated. See PolicyViolationDetails for more detail.',
          trigger: { string_value: 'Kahi' },
          location: {
            field_path_elements: [
              { field_name: 'operations', index: 1 },
              { field_name: 'create' },
              { field_name: 'keyword' },
              { field_name: 'text' },
            ],
          },
          details: {
            policy_violation_details: {
              external_policy_description:
                "Your account must have a copyright certificate for the domain on which you're promoting the streaming or downloading of copyrighted content.",
              key: { policy_name: 'COPYRIGHTED_CONTENT', violating_text: 'Kahi' },
              external_policy_name: 'Copyrighted content',
              is_exemptible: true,
            },
          },
        },
      ],
    }

    const message = formatGoogleAdsApiError(error)
    expect(message).toContain('Google Ads 政策违规')
    expect(message).toContain('Copyrighted content / COPYRIGHTED_CONTENT')
    expect(message).toContain('关键词: kahi, Kahi')
    expect(message).toContain('可申请豁免: 是')
    expect(message).toContain('RequestId=nlyd5wqRrXgcCgAlvLur0Q')
  })

  it('falls back to joined error messages when no policy details exist', () => {
    const message = formatGoogleAdsApiError({
      request_id: 'req-123',
      errors: [{ message: 'Some error' }, { message: 'Some error' }, { message: 'Another error' }],
    })

    expect(message).toContain('Some error')
    expect(message).toContain('Another error')
    expect(message).toContain('RequestId=req-123')
  })

  it('handles non-object errors', () => {
    expect(formatGoogleAdsApiError('bad')).toBe('bad')
    expect(formatGoogleAdsApiError(new Error('boom'))).toBe('boom')
  })
})

