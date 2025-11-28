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
 * 检查控制器是否可用
 */
function isControllerOpen(controller: ReadableStreamDefaultController): boolean {
  try {
    // 尝试获取desiredSize来判断controller是否仍然打开
    const size = controller.desiredSize;
    return size !== null;
  } catch {
    return false;
  }
}

/**
 * Helper to send progress update via SSE
 */
export function sendSSEMessage(
  controller: ReadableStreamDefaultController,
  message: SSEMessage
): void {
  if (!isControllerOpen(controller)) {
    console.warn('SSE Controller already closed, skipping message:', message.type);
    return;
  }
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
  details?: import('@/types/progress').ProgressEvent['details'],
  duration?: number
): void {
  sendSSEMessage(controller, {
    type: 'progress',
    data: {
      stage,
      status,
      message,
      timestamp: Date.now(),
      duration,
      details,
    },
  });
}

/**
 * Helper to send completion event
 */
export function sendComplete(
  controller: ReadableStreamDefaultController,
  data: { success: boolean; finalUrl: string; brand: string; productCount?: number; [key: string]: any }
): void {
  if (!isControllerOpen(controller)) {
    console.warn('SSE Controller already closed, cannot send complete');
    return;
  }
  sendSSEMessage(controller, {
    type: 'complete',
    data,
  });
  try {
    controller.close();
  } catch (e) {
    console.warn('SSE Controller close failed:', e);
  }
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
  if (!isControllerOpen(controller)) {
    console.warn('SSE Controller already closed, cannot send error');
    return;
  }
  sendSSEMessage(controller, {
    type: 'error',
    data: {
      message,
      stage,
      details,
    },
  });
  try {
    controller.close();
  } catch (e) {
    console.warn('SSE Controller close failed:', e);
  }
}
