import type { ProgressStage, ProgressStatus } from '@/types/progress'

export const OFFER_EXTRACTION_SUBMITTED_MESSAGE = '任务已提交，正在排队处理...'
export const OFFER_EXTRACTION_DEFERRED_MESSAGE = '任务已提交，后台继续处理，请稍后在列表页确认任务是否完成。'

export type OfferExtractionDeferredReason = 'sse_timeout' | 'client_timeout' | 'stream_closed'

export interface OfferExtractionSubmittedEvent {
  type: 'submitted'
  data: {
    taskId: string
    stage: ProgressStage
    status: ProgressStatus
    progress: number
    message: string
    timestamp: number
  }
}

export interface OfferExtractionDeferredEvent {
  type: 'deferred'
  data: {
    taskId: string
    reason: OfferExtractionDeferredReason
    stage: ProgressStage
    status: ProgressStatus
    message: string
    timestamp: number
  }
}

export function createOfferExtractionSubmittedEvent(
  taskId: string,
  message = OFFER_EXTRACTION_SUBMITTED_MESSAGE
): OfferExtractionSubmittedEvent {
  return {
    type: 'submitted',
    data: {
      taskId,
      stage: 'resolving_link',
      status: 'pending',
      progress: 0,
      message,
      timestamp: Date.now(),
    },
  }
}

export function createOfferExtractionDeferredEvent(
  taskId: string,
  reason: OfferExtractionDeferredReason
): OfferExtractionDeferredEvent {
  return {
    type: 'deferred',
    data: {
      taskId,
      reason,
      stage: 'resolving_link',
      status: 'pending',
      message: OFFER_EXTRACTION_DEFERRED_MESSAGE,
      timestamp: Date.now(),
    },
  }
}

export function isOfferExtractionDeferredTimeout(message: unknown): boolean {
  if (typeof message !== 'string') return false

  const normalized = message.toLowerCase()
  return normalized.includes('sse timeout') && normalized.includes('may still be running')
}
