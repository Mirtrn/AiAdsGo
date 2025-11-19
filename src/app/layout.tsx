import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from "@/components/ui/sonner"
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  // P0-4: SEO优化 - 更精准的标题和描述
  title: 'AutoAds - Google Ads快速测试和一键优化营销平台 | AI自动生成高质量广告文案',
  description: 'AutoAds - AI驱动的Google Ads自动化投放平台。自动生成高质量广告文案、获取真实Keyword Planner数据、数据驱动持续优化、构建"印钞机"增长飞轮。适合BB新人和独立工作室，最大化投放ROI。',
  keywords: [
    'Google Ads',
    'Google Ads自动化',
    'AI广告文案',
    '广告自动化投放',
    'ROI优化',
    'Google Keyword Planner',
    '关键词规划',
    '广告效果优化',
    'AI营销',
    '联盟营销',
    'Affiliate Marketing',
    'BB推广',
    '印钞机组合',
    '增长飞轮',
  ],
  authors: [{ name: 'AutoAds Team' }],
  creator: 'AutoAds',
  publisher: 'AutoAds',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  openGraph: {
    title: 'AutoAds - Google Ads AI广告自动化投放系统',
    description: '自动化Offer管理、AI广告文案生成、真实关键词数据、增长飞轮，最大化投放ROI',
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    siteName: 'AutoAds',
    images: [
      {
        url: '/logo.png', // P2-1: 临时使用logo.png，建议创建专门的og-image.png (1200x630)
        width: 1200,
        height: 630,
        alt: 'AutoAds - Google Ads AI广告自动化投放系统',
      },
    ],
    locale: 'zh_CN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AutoAds - Google Ads AI广告自动化投放系统',
    description: '自动化Offer管理、AI广告文案生成、真实关键词数据，最大化投放ROI',
    images: ['/logo.png'], // P2-1: 临时使用logo.png
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
