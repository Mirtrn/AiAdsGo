import { describe, expect, it } from 'vitest'

import { MODEL_TEST_MAX_OUTPUT_TOKENS, MODEL_TEST_PROMPT } from './route'

describe('admin ai model test route params', () => {
  it('uses a deterministic ping with enough output budget for reasoning models', () => {
    expect(MODEL_TEST_PROMPT).toContain('OK')
    expect(MODEL_TEST_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(128)
  })
})
