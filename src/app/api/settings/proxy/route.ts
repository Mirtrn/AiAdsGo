import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/settings';

/**
 * GET /api/settings/proxy?country=us
 * 根据国家代码获取代理配置
 */
export async function GET(request: NextRequest) {
  try {
    // 从中间件注入的请求头中获取用户ID
    const userId = request.headers.get('x-user-id');
    const userIdNum = userId ? parseInt(userId, 10) : undefined;

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams;
    const country = searchParams.get('country');

    if (!country) {
      return NextResponse.json(
        {
          success: false,
          error: '缺少 country 参数',
        },
        { status: 400 }
      );
    }

    // 查询代理配置：proxy.{country}_proxy_url
    const proxyKey = `${country.toLowerCase()}_proxy_url`;
    const proxySetting = await getSetting('proxy', proxyKey, userIdNum);

    if (!proxySetting || !proxySetting.value) {
      return NextResponse.json(
        {
          success: false,
          error: `未配置 ${country.toUpperCase()} 代理`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        country: country.toUpperCase(),
        proxy_url: proxySetting.value,
        validation_status: proxySetting.validationStatus,
        last_validated_at: proxySetting.lastValidatedAt,
      },
    });
  } catch (error: any) {
    console.error('获取代理配置失败:', error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || '获取代理配置失败',
      },
      { status: 500 }
    );
  }
}
