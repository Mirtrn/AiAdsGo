import { pageMetadata } from '@/lib/seo'

// P2-1: 登录页SEO metadata
export const metadata = pageMetadata.login

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
