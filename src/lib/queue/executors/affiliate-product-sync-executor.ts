import type { Task } from '@/lib/queue/types'
import {
  checkAffiliatePlatformConfig,
  type AffiliatePlatform,
  type SyncMode,
  syncAffiliateProducts,
  updateAffiliateProductSyncRun,
} from '@/lib/affiliate-products'

export type AffiliateProductSyncTaskData = {
  userId: number
  platform: AffiliatePlatform
  mode: SyncMode
  runId: number
  productId?: number
  trigger?: 'manual' | 'retry' | 'schedule'
}

export async function executeAffiliateProductSync(task: Task<AffiliateProductSyncTaskData>) {
  const data = task.data
  if (!data?.userId || !data?.platform || !data?.runId) {
    throw new Error('任务参数不完整')
  }

  const startedAt = new Date().toISOString()
  await updateAffiliateProductSyncRun({
    runId: data.runId,
    status: 'running',
    startedAt,
    errorMessage: null,
  })

  try {
    const configCheck = await checkAffiliatePlatformConfig(data.userId, data.platform)
    if (!configCheck.configured) {
      throw new Error(`配置不完整: ${configCheck.missingKeys.join(', ')}`)
    }

    const result = await syncAffiliateProducts({
      userId: data.userId,
      platform: data.platform,
      mode: data.mode || 'platform',
      productId: data.productId,
    })

    await updateAffiliateProductSyncRun({
      runId: data.runId,
      status: 'completed',
      totalItems: result.totalFetched,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
      failedCount: 0,
      completedAt: new Date().toISOString(),
      errorMessage: null,
    })

    return {
      success: true,
      runId: data.runId,
      ...result,
    }
  } catch (error: any) {
    await updateAffiliateProductSyncRun({
      runId: data.runId,
      status: 'failed',
      failedCount: 1,
      completedAt: new Date().toISOString(),
      errorMessage: error?.message || '同步失败',
    })
    throw error
  }
}

