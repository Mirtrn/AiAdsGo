/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker优化：启用standalone输出模式
  output: 'standalone',

  // 性能优化：启用SWC minification
  swcMinify: true,

  // 生产环境优化
  productionBrowserSourceMaps: false,

  // 启用压缩
  compress: true,

  // 性能优化：优化字体加载
  optimizeFonts: true,

  // 图片优化配置
  images: {
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 60,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  // 外部包配置：避免webpack打包特定库
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'cheerio'],
    // 优化包导入
    optimizePackageImports: ['lucide-react'],
  },

  webpack: (config, { isServer }) => {
    // 支持better-sqlite3和cheerio
    if (isServer) {
      config.externals.push('better-sqlite3', 'cheerio');
    }

    // 优化chunk splitting
    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: false,
            vendors: false,
            // 将react相关库单独打包
            react: {
              name: 'react-vendors',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 40,
              enforce: true,
            },
            // 将大型库单独打包
            libs: {
              name: 'lib-vendors',
              test: /[\\/]node_modules[\\/](@google|google-ads-api|axios)[\\/]/,
              priority: 30,
              reuseExistingChunk: true,
            },
            // 公共代码
            commons: {
              name: 'commons',
              minChunks: 2,
              priority: 20,
            },
          },
        },
      };
    }

    return config;
  },

  // 页面和API路由配置
  poweredByHeader: false,

  // Headers优化
  async headers() {
    return [
      {
        source: '/:all*(svg|jpg|png|webp|avif)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
}

module.exports = nextConfig
