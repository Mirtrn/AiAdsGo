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
                    <span>只需要测试权限的Developer Token即可</span>
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
                  <li>启用 <strong>Google Ads API</strong>（在"API和服务"→"库"中搜索启用）</li>
                  <li>进入"API和服务"→"<a href="https://console.cloud.google.com/apis/credentials" target="_blank" className="text-blue-600 hover:underline">凭据</a>"页面</li>
                  <li>点击"创建凭据"→"OAuth 2.0 客户端 ID"</li>
                  <li>选择"Web 应用"类型，设置名称</li>
                  <li>在"已授权的 JavaScript 来源"中添加您的生产环境域名（如：<code className="bg-gray-100 px-1 rounded">https://www.autoads.dev</code>）</li>
                  <li>在"已授权的重定向 URI"中添加：<code className="bg-gray-100 px-1 rounded">https://www.autoads.dev/api/google-ads/oauth/callback</code></li>
                  <li>创建完成后，点击客户端名称查看 <strong>客户端 ID</strong>和<strong>客户端密钥</strong></li>
                  <li>访问 <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline">Google Ads API Center</a> 申请 Developer Token（需要基本访问权限）</li>
                  <li>在系统设置页面配置 Client ID、Client Secret、Developer Token，然后点击"启动OAuth授权"</li>
                </ol>
                <Alert className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    OAuth 方式需要"基本访问权限"或更高级别的 Developer Token
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* OAuth Client ID 获取方式 */}
            <Card id="oauth-client-id">
              <CardHeader>
                <CardTitle className="text-base">如何获取 Client ID 和 Client Secret</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <ol className="list-decimal list-inside space-y-2">
                  <li>访问 <a href="https://console.cloud.google.com/" target="_blank" className="text-blue-600 hover:underline">Google Cloud Console</a></li>
                  <li>选择或创建您的项目（建议与 Google Ads 账号关联的项目）</li>
                  <li>确保已启用 <strong>Google Ads API</strong>（在"API和服务"→"库"中搜索并启用）</li>
                  <li>进入"<a href="https://console.cloud.google.com/apis/credentials" target="_blank" className="text-blue-600 hover:underline">凭据</a>"页面</li>
                  <li>点击"创建凭据"→"OAuth 2.0 客户端 ID"</li>
                  <li>选择"Web 应用"类型，填写名称</li>
                  <li>在"已授权的 JavaScript 来源"中添加您的生产环境域名（如：<code className="bg-gray-100 px-1 rounded">https://www.autoads.dev</code>）</li>
                  <li>在"已授权的重定向 URI"中添加：<code className="bg-gray-100 px-1 rounded">https://www.autoads.dev/api/google-ads/oauth/callback</code></li>
                  <li>点击"创建"按钮</li>
                  <li>在弹出的页面中，复制 <strong>客户端 ID</strong>和<strong>客户端密钥</strong></li>
                </ol>
                <Alert className="mt-3 bg-amber-50 border-amber-200">
                  <AlertDescription>
                    <strong>注意：</strong>请妥善保管 Client Secret，它只会在创建时显示一次
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* OAuth Developer Token 获取方式 */}
            <Card id="oauth-developer-token">
              <CardHeader>
                <CardTitle className="text-base">如何获取 Developer Token（OAuth方式）</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <ol className="list-decimal list-inside space-y-2">
                  <li>访问 <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline">Google Ads API Center</a></li>
                  <li>登录您的 Google Ads MCC 账号</li>
                  <li>进入"Tools &amp; Settings" → "API Center"</li>
                  <li>在"Developer Token"部分申请 Token</li>
                  <li>OAuth 方式需要 <strong>基本访问权限</strong>或更高级别</li>
                  <li>提交申请后，等待 Google 审核（通常1-3个工作日）</li>
                </ol>
                <Alert className="mt-3 bg-blue-50 border-blue-200">
                  <AlertDescription>
                    <strong>提示：</strong>基本访问权限的 Token 即可满足 OAuth 认证需求，审核周期通常1-3个工作日
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
                  <li>访问 <a href="https://console.cloud.google.com/" target="_blank" className="text-blue-600 hover:underline">Google Cloud Console</a> 创建项目</li>
                  <li>确保 GCP 项目<strong>启用了 Google Ads API</strong>（在"API和服务"→"库"中搜索并启用）</li>
                  <li>在 GCP 项目中创建服务账号并下载 JSON 密钥文件</li>
                  <li>在 MCC 账号中申请 Developer Token（只需要测试权限即可）</li>
                  <li>在 MCC 账号的"访问权限和安全"中添加服务账号邮箱</li>
                  <li>在系统设置页面上传 JSON 文件并配置</li>
                </ol>
                <Alert className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>提示：</strong>服务账号方式只需要测试权限的Developer Token即可，但必须先启用 Google Ads API
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* MCC Customer ID 获取方式 */}
            <Card id="mcc-customer-id">
              <CardHeader>
                <CardTitle className="text-base">如何获取 MCC Customer ID</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <ol className="list-decimal list-inside space-y-2">
                  <li>访问 <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline">Google Ads API Center</a></li>
                  <li>登录您的 MCC（管理账号）</li>
                  <li>点击顶部导航栏的"设置"图标</li>
                  <li>在"账号信息"部分找到"MCC 账号 ID"</li>
                  <li>ID 格式为10位数字（如 1234567890），请去掉连字符</li>
                </ol>
                <Alert className="mt-3 bg-blue-50 border-blue-200">
                  <AlertDescription>
                    MCC Customer ID 是您的管理账号的唯一标识，用于访问所有子账号
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* Developer Token 获取方式 */}
            <Card id="developer-token">
              <CardHeader>
                <CardTitle className="text-base">如何获取 Developer Token</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <ol className="list-decimal list-inside space-y-2">
                  <li>访问 <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline">Google Ads API Center</a></li>
                  <li>确保您的账号是 MCC（管理账号）</li>
                  <li>进入"Tools &amp; Settings" → "API Center"</li>
                  <li>在"Developer Token"部分申请或查看 Token</li>
                  <li>服务账号方式只需要<strong>测试权限</strong>即可</li>
                </ol>
                <Alert className="mt-3 bg-blue-50 border-blue-200">
                  <AlertDescription>
                    <strong>提示：</strong>服务账号方式对 Developer Token 的权限级别没有特殊要求，测试权限即可使用
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* 服务账号 JSON 获取方式 */}
            <Card id="service-account-json">
              <CardHeader>
                <CardTitle className="text-base">如何获取服务账号 JSON</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <ol className="list-decimal list-inside space-y-2">
                  <li>访问 <a href="https://console.cloud.google.com/" target="_blank" className="text-blue-600 hover:underline">Google Cloud Console</a></li>
                  <li>选择或创建您的项目</li>
                  <li>启用 <strong>Google Ads API</strong>（在"API和服务"→"库"中搜索启用）</li>
                  <li>进入" IAM 和管理"→"<a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" className="text-blue-600 hover:underline">服务账号</a>"</li>
                  <li>点击"创建服务账号"，填写名称和描述</li>
                  <li>在"授予此服务账号的权限"中，选择角色"基本"→"所有者"或自定义权限</li>
                  <li>创建完成后，在服务账号列表中点击该账号</li>
                  <li>进入"密钥"标签页，点击"添加密钥"→"创建新密钥"</li>
                  <li>选择"JSON"类型，点击"创建"下载密钥文件</li>
                  <li>用文本编辑器打开下载的文件，复制完整内容</li>
                </ol>
                <Alert className="mt-3 bg-blue-50 border-blue-200">
                  <AlertDescription>
                    <strong>提示：</strong>确保服务账号邮箱已被添加到 Google Ads MCC 的"访问权限和安全"中，否则无法访问 API
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
                测试权限通常立即可用；基本访问权限通常需要1-3个工作日审核。
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

        <Card className="mt-6 border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-orange-800">故障排除：invalid_client 错误</CardTitle>
            <CardDescription className="text-orange-700">
              如果您在配置过程中遇到 <code className="bg-orange-100 px-1 rounded">invalid_client</code> 错误，请按以下步骤排查
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="border-l-4 border-orange-400 pl-4">
              <h4 className="font-semibold text-orange-800 mb-2">1. 检查 GCP 项目中的 Google Ads API 是否已启用</h4>
              <p className="text-sm text-gray-600 mb-2">请访问以下链接确认 API 状态：</p>
              <a
                href="https://console.cloud.google.com/apis/library/googleads.googleapis.com"
                target="_blank"
                className="text-blue-600 hover:underline text-sm inline-flex items-center gap-1"
              >
                Google Cloud Console - Google Ads API 库 <ExternalLink className="w-3 h-3" />
              </a>
              <p className="text-sm text-gray-600 mt-2">
                确认状态显示为 <strong>"Enabled"</strong>（已启用）。如果未启用，请点击"启用"按钮。
              </p>
            </div>

            <div className="border-l-4 border-orange-400 pl-4">
              <h4 className="font-semibold text-orange-800 mb-2">2. 验证 Developer Token 是否有效</h4>
              <p className="text-sm text-gray-600 mb-2">请在 Google Ads API Center 中检查：</p>
              <a
                href="https://ads.google.com/aw/apicenter"
                target="_blank"
                className="text-blue-600 hover:underline text-sm inline-flex items-center gap-1"
              >
                Google Ads API Center <ExternalLink className="w-3 h-3" />
              </a>
              <ul className="text-sm text-gray-600 mt-2 list-disc list-inside space-y-1">
                <li>Developer Token 状态必须是 <strong>"Enabled"</strong> 或 <strong>"Test - Ready to use"</strong></li>
                <li>Token 格式是 22 位字符</li>
                <li>如果 Token 状态为 "Pending" 或 "Review"，请等待 Google 审核</li>
              </ul>
            </div>

            <div className="border-l-4 border-orange-400 pl-4">
              <h4 className="font-semibold text-orange-800 mb-2">3. 确认服务账号邮箱已添加到 Google Ads MCC</h4>
              <p className="text-sm text-gray-600 mb-2">请执行以下操作：</p>
              <ol className="text-sm text-gray-600 list-decimal list-inside space-y-1">
                <li>在 GCP 控制台获取完整的服务账号邮箱地址：
                  <a
                    href="https://console.cloud.google.com/iam-admin/serviceaccounts"
                    target="_blank"
                    className="text-blue-600 hover:underline ml-1 inline-flex items-center gap-1"
                  >
                    服务账号列表 <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li>访问 <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline">Google Ads API Center</a></li>
                <li>进入 <strong>"Tools & Settings" → "Access and security"</strong></li>
                <li>添加服务账号邮箱，并分配适当的角色（如 "Standard access" 或 "Admin access"）</li>
              </ol>
              <Alert className="mt-3 bg-white border-orange-300">
                <AlertCircle className="h-4 w-4 text-orange-500" />
                <AlertDescription className="text-sm text-gray-600">
                  <strong>重要：</strong>添加服务账号后，可能需要等待几分钟才能生效
                </AlertDescription>
              </Alert>
            </div>

            <div className="border-l-4 border-blue-400 pl-4 bg-blue-50 rounded-r">
              <h4 className="font-semibold text-blue-800 mb-2">快速检查清单</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>GCP 项目中 <strong>Google Ads API</strong> 已启用</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>Developer Token 状态为 <strong>Enabled</strong> 或 <strong>Test - Ready to use</strong></span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>服务账号邮箱已添加到 MCC 的 <strong>Access and security</strong></span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span>MCC Customer ID 格式正确（10位数字，不带连字符）</span>
                </li>
              </ul>
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
