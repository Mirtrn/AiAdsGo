import { describe, expect, it } from 'vitest'
import { buildDkiFirstHeadline } from '../ad-creative-generator'

describe('ad-creative-generator DKI', () => {
  it('does not truncate default text for valid DKI length (Google Ads counts defaultText only)', () => {
    // "Armed American Supply" = 21 chars, should fit without truncation
    expect(buildDkiFirstHeadline('Armed American Supply')).toBe('{KeyWord:Armed American Supply} Official')
  })

  it('drops suffix when brand+suffix exceeds 30, but keeps full brand if <=30', () => {
    const brand = 'A'.repeat(30)
    expect(buildDkiFirstHeadline(brand)).toBe(`{KeyWord:${brand}}`)
  })

  it('truncates brand only when brand itself exceeds 30', () => {
    const brand = 'B'.repeat(40)
    expect(buildDkiFirstHeadline(brand)).toBe(`{KeyWord:${'B'.repeat(30)}}`)
  })
})

