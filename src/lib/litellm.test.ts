import { describe, expect, it } from 'vitest'

import { extractOpenAICompatibleText } from './litellm'

describe('extractOpenAICompatibleText', () => {
  it('extracts text when OpenAI-compatible message content is an array', () => {
    const text = extractOpenAICompatibleText({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 'OK' },
              { type: 'text', text: ' done' },
            ],
          },
          finish_reason: 'stop',
        },
      ],
    })

    expect(text).toBe('OK done')
  })

  it('extracts top-level output_text fallback from compatible gateways', () => {
    const text = extractOpenAICompatibleText({
      output_text: 'OK',
    })

    expect(text).toBe('OK')
  })
})
