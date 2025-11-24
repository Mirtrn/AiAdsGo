/**
 * Server-Sent Events (SSE) helper utilities
 */

import type { SSEMessage } from '@/types/progress';

/**
 * Create a text encoder for SSE streaming
 */
export function createSSEEncoder() {
  return new TextEncoder();
}

/**
 * Format an SSE message
 */
export function formatSSEMessage(message: SSEMessage): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

/**
 * Create a ReadableStream for SSE
 */
export function createSSEStream(
  onStart: (controller: ReadableStreamDefaultController) => Promise<void>
): ReadableStream<Uint8Array> {
  const encoder = createSSEEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        await onStart(controller);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorData = formatSSEMessage({
          type: 'error',
          data: {
            message: errorMessage,
            stage: 'error',
            details: error instanceof Error ? { stack: error.stack } : {},
          },
        });
        controller.enqueue(encoder.encode(errorData));
        controller.close();
      }
    },
  });
}

/**
 * Helper to send progress update via SSE
 */
export function sendSSEMessage(
  controller: ReadableStreamDefaultController,
  message: SSEMessage
): void {
  const encoder = createSSEEncoder();
  const formatted = formatSSEMessage(message);
  controller.enqueue(encoder.encode(formatted));
}

/**
 * Helper to send progress event
 */
export function sendProgress(
  controller: ReadableStreamDefaultController,
  stage: import('@/types/progress').ProgressStage,
  status: 'pending' | 'in_progress' | 'completed' | 'error',
  message: string,
  details?: import('@/types/progress').ProgressEvent['details']
): void {
  sendSSEMessage(controller, {
    type: 'progress',
    data: {
      stage,
      status,
      message,
      timestamp: Date.now(),
      details,
    },
  });
}

/**
 * Helper to send completion event
 */
export function sendComplete(
  controller: ReadableStreamDefaultController,
  data: { success: boolean; finalUrl: string; brand: string; productCount?: number }
): void {
  sendSSEMessage(controller, {
    type: 'complete',
    data,
  });
  controller.close();
}

/**
 * Helper to send error event
 */
export function sendError(
  controller: ReadableStreamDefaultController,
  stage: import('@/types/progress').ProgressStage,
  message: string,
  details?: Record<string, unknown>
): void {
  sendSSEMessage(controller, {
    type: 'error',
    data: {
      message,
      stage,
      details,
    },
  });
  controller.close();
}
