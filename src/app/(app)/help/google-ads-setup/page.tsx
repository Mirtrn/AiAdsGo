'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'

export default function GoogleAdsSetupGuidePage() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Google Ads API 配置指南</h1>
          <p className="text-gray-600 mt-2">
            选择适合您的配置方式，按照步骤完成 Google Ads API 接入
          </p>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>两种配置方式对比</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Badge>方式一</Badge>
                  <h3 className="font-semibold">OAuth 用户授权</h3>
                </div>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5" />
                    <span>适合管理自己的 Google Ads 账号</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5" />
                    <span>需要浏览器授权（一次性）</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-orange-500 mt-0.5" />
                    <span>需要申请"基本访问权限"Developer Token</span>
                  </li>
                </ul>
              </div>

              <div className="border rounded-lg p-4 bg-blue-50">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="secondary">方式二</Badge>
                  <h3 className="font-semibold">服务账号认证</h3>
                  <Badge variant="outline" className="text-xs">推荐</Badge>
                </div>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5" />
                    <span>适合 MCC 账号管理多个子账号</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5" />
                    <span>无需用户交互，自动化程度高</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5" />
                    <span>需要Explorer级别或更高的Developer Token</span>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="service-account" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="oauth">方式一：OAuth 授权</TabsTrigger>
            <TabsTrigger value="service-account">方式二：服务账号</TabsTrigger>
          </TabsList>

          <TabsContent value="oauth" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>OAuth 配置步骤</CardTitle>
                <CardDescription>适合管理自己的 Google Ads 账号</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal list-inside space-y-3 text-sm">
                  <li>访问 <a href="https://console.cloud.google.com/" target="_blank" className="text-blue-600 hover:underline">Google Cloud Console</a> 创建项目</li>
                  <li>启用 Google Ads API</li>
                  <li>创建 OAuth 2.0 凭据（Web 应用类型）</li>
                  <li>在 Google Ads 中申请 Developer Token（需要基本访问权限）</li>
                  <li>在系统设置页面配置凭证并完成授权</li>
                </ol>
                <Alert className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    OAuth 方式需要"基本访问权限"或更高级别的 Developer Token
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="service-account" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>服务账号配置步骤</CardTitle>
                <CardDescription>适合 MCC 账号管理多个子账号</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal list-inside space-y-3 text-sm">
                  <li>访问 <a href="https://console.cloud.google.com/" target="_blank" className="text-blue-600 hover:underline">Google Cloud Console</a> 创建服务账号</li>
                  <li>下载服务账号 JSON 密钥文件</li>
                  <li>在 MCC 账号中申请 Developer Token（需要Explorer级别或更高）</li>
                  <li>在 MCC 账号的"访问权限和安全"中添加服务账号邮箱</li>
                  <li>在系统设置页面上传 JSON 文件并配置</li>
                </ol>
                <Alert className="mt-4">
                  <AlertDescription>
                    <strong>注意：</strong>服务账号方式需要Explorer级别或更高的Developer Token
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>常见问题</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2">Q: 我应该选择哪种配置方式？</h4>
              <p className="text-sm text-gray-600">
                如果您只管理自己的 Google Ads 账号，选择 OAuth 方式；如果您使用 MCC 账号管理多个子账号，推荐使用服务账号方式。
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Q: Developer Token 审核需要多久？</h4>
              <p className="text-sm text-gray-600">
                Explorer级别通常需要1-3个工作日审核；基本访问权限审核时间类似。
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Q: 服务账号密钥丢失怎么办？</h4>
              <p className="text-sm text-gray-600">
                在 Google Cloud Console 中删除旧密钥，重新创建新密钥并更新系统配置即可。
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>帮助资源</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="https://developers.google.com/google-ads/api/docs/start" target="_blank" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                  Google Ads API 官方文档 <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <a href="https://developers.google.com/google-ads/api/docs/oauth/service-accounts" target="_blank" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                  服务账号认证指南 <ExternalLink className="w-3 h-3" />
                </a>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
