// GET /api/admin/url-swap/stats - 获取全局统计

import { NextResponse } from 'next/server';
import { getUrlSwapGlobalStats } from '@/lib/url-swap';

/**
 * GET - 获取全局统计（管理员）
 */
export async function GET() {
  try {
    const stats = await getUrlSwapGlobalStats();

    return NextResponse.json(stats);

  } catch (error: any) {
    console.error('[admin/url-swap] 获取统计失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取统计失败: ' + error.message },
      { status: 500 }
    );
  }
}
