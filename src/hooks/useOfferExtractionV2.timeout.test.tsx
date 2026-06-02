// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OFFER_EXTRACTION_DEFERRED_MESSAGE } from '@/lib/offer-extraction-sse-events'
import { useOfferExtractionV2 } from './useOfferExtractionV2'

function createSseResponse(events: unknown[]): Response {
  const encoder = new TextEncoder()

  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}

describe('useOfferExtractionV2 timeout handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps an already queued task as background processing instead of marking creation failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => createSseResponse([
      {
        type: 'submitted',
        data: {
          taskId: 'task-123',
          stage: 'resolving_link',
          status: 'pending',
          progress: 0,
          message: '任务已提交，正在排队处理...',
        },
      },
      {
        type: 'error',
        data: {
          message: 'SSE timeout - task may still be running',
          stage: 'error',
          details: {},
        },
      },
    ])))

    const { result } = renderHook(() => useOfferExtractionV2())

    await act(async () => {
      await result.current.startExtraction('https://example.test/track', 'US')
    })

    await waitFor(() => expect(result.current.isExtracting).toBe(false))
    expect(result.current.taskId).toBe('task-123')
    expect(result.current.error).toBeNull()
    expect(result.current.currentStage).toBe('resolving_link')
    expect(result.current.currentStatus).toBe('pending')
    expect(result.current.currentMessage).toBe(OFFER_EXTRACTION_DEFERRED_MESSAGE)
  })
})
