import { describe, expect, it } from 'vitest'
import {
  OFFER_EXTRACTION_DEFERRED_MESSAGE,
  createOfferExtractionDeferredEvent,
  createOfferExtractionSubmittedEvent,
  isOfferExtractionDeferredTimeout,
} from './offer-extraction-sse-events'

describe('offer extraction SSE events', () => {
  it('creates a submitted event with the task id so the client can track queued work', () => {
    expect(createOfferExtractionSubmittedEvent('task-123')).toMatchObject({
      type: 'submitted',
      data: {
        taskId: 'task-123',
        stage: 'resolving_link',
        status: 'pending',
        progress: 0,
      },
    })
  })

  it('creates a deferred event instead of an error when the SSE wait window ends', () => {
    expect(createOfferExtractionDeferredEvent('task-123', 'sse_timeout')).toMatchObject({
      type: 'deferred',
      data: {
        taskId: 'task-123',
        reason: 'sse_timeout',
        stage: 'resolving_link',
        status: 'pending',
        message: OFFER_EXTRACTION_DEFERRED_MESSAGE,
      },
    })
  })

  it('recognizes the legacy timeout error that means the task may still be running', () => {
    expect(isOfferExtractionDeferredTimeout('SSE timeout - task may still be running')).toBe(true)
    expect(isOfferExtractionDeferredTimeout('network timeout')).toBe(false)
  })
})
