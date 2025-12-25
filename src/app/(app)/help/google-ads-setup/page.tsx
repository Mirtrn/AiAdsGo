'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, AlertCircle, ExternalLink, HelpCircle, Settings } from 'lucide-react'

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

        {/* 方式对比 */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              两种配置方式对比
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border rounded-lg p-4 hover:border-blue-300 transition-colors">
                <div className="flex items-center gap-2 mb-3">
                  <Badge>方式一</Badge>
                  <h3 className="font-semibold">OAuth 用户授权</h3>
                </div>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>适合管理<strong>自己的</strong> Google Ads 账号</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>需要浏览器授权（一次性）</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                    <span>需要申请"基本访问权限" Developer Token</span>
                  </li>
                </ul>
              </div>

              <div className="border-2 border-blue-200 rounded-lg p-4 bg-blue-50/50">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="secondary">方式二</Badge>
                  <h3 className="font-semibold">服务账号认证</h3>
                  <Badge variant="outline" className="text-xs bg-blue-100">推荐</Badge>
                </div>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>适合 MCC 账号<strong>管理多个子账号</strong></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>无需用户交互，自动化程度高</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>只需<strong>测试权限</strong>的 Developer Token</span>
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

          {/* 方式一：OAuth */}
          <TabsContent value="oauth" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>配置步骤</CardTitle>
                <CardDescription>适合管理自己的 Google Ads 账号</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">1</div>
                    <div>
                      <h4 className="font-medium">创建 GCP 项目并启用 API</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        访问 <a href="https://console.cloud.google.com/" target="_blank" className="text-blue-600 hover:underline">Google Cloud Console</a> 创建项目，然后在"API和服务"→"库"中搜索并启用 <strong>Google Ads API</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">2</div>
                    <div>
                      <h4 className="font-medium">创建 OAuth 客户端</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        进入<a href="https://console.cloud.google.com/apis/credentials" target="_blank" className="text-blue-600 hover:underline">凭据</a>页面，点击"创建凭据"→"OAuth 2.0 客户端 ID"，选择"Web 应用"类型
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">3</div>
                    <div>
                      <h4 className="font-medium">配置授权 URI</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在"已授权的重定向 URI"中添加：<code className="bg-gray-100 px-2 py-0.5 rounded text-xs">https://www.autoads.dev/api/google-ads/oauth/callback</code>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">4</div>
                    <div>
                      <h4 className="font-medium">获取 Client ID 和 Client Secret</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        创建完成后，点击客户端名称查看 <strong>客户端 ID</strong>和<strong>客户端密钥</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">5</div>
                    <div>
                      <h4 className="font-medium">申请 Developer Token</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        访问 <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline">Google Ads API Center</a> 申请 Token，OAuth 方式需要 <strong>基本访问权限</strong>（审核1-3个工作日）
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">6</div>
                    <div>
                      <h4 className="font-medium">完成配置</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在系统设置页面配置 Client ID、Client Secret、Developer Token，然后点击"启动 OAuth 授权"
                      </p>
                    </div>
                  </div>
                </div>

                <Alert className="mt-4 bg-orange-50 border-orange-200">
                  <AlertCircle className="h-4 w-4 text-orange-500" />
                  <AlertDescription>
                    OAuth 方式需要"基本访问权限"或更高级别的 Developer Token（测试权限不可用）
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 方式二：服务账号 */}
          <TabsContent value="service-account" className="space-y-4 mt-4">
            {/* 配置步骤 */}
            <Card>
              <CardHeader>
                <CardTitle>配置步骤</CardTitle>
                <CardDescription>适合 MCC 账号管理多个子账号</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">1</div>
                    <div>
                      <h4 className="font-medium">启用 Google Ads API</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在 <a href="https://console.cloud.google.com/" target="_blank" className="text-blue-600 hover:underline">Google Cloud Console</a> 中创建项目，然后在"API和服务"→"库"中启用 <strong>Google Ads API</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">2</div>
                    <div>
                      <h4 className="font-medium">创建服务账号并下载 JSON</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在" IAM 和管理"→"服务账号"中创建服务账号，选择"JSON"密钥类型并下载
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">3</div>
                    <div>
                      <h4 className="font-medium">获取 MCC Customer ID</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在 Google Ads API Center 中获取您的 MCC 账号 ID（10位数字，不带连字符）
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">4</div>
                    <div>
                      <h4 className="font-medium">申请测试权限 Developer Token</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在 <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline">Google Ads API Center</a> 申请 Token，服务账号方式只需<strong>测试权限</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">5</div>
                    <div>
                      <h4 className="font-medium">添加服务账号到 MCC</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在 Google Ads MCC 的"访问权限和安全"中添加服务账号邮箱，分配<strong>标准角色</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold">6</div>
                    <div>
                      <h4 className="font-medium">完成配置</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        在系统设置页面上传 JSON 文件，配置 MCC Customer ID 和 Developer Token
                      </p>
                    </div>
                  </div>
                </div>

                <Alert className="mt-4 bg-blue-50 border-blue-200">
                  <AlertDescription>
                    <strong>提示：</strong>服务账号方式只需要测试权限的 Developer Token，无需等待审核
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* 详细指南：获取服务账号 JSON */}
            <Card id="service-account-json">
              <CardHeader>
                <CardTitle className="text-base">详细指南：如何获取服务账号 JSON</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <ol className="list-decimal list-inside space-y-3">
                  <li>
                    访问 <a href="https://console.cloud.google.com/" target="_blank" className="text-blue-600 hover:underline">Google Cloud Console</a>，选择或创建项目
                  </li>
                  <li>
                    启用 <strong>Google Ads API</strong>（"API和服务"→"库"中搜索启用）
                  </li>
                  <li>
                    进入" IAM 和管理"→"<a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" className="text-blue-600 hover:underline">服务账号</a>"
                  </li>
                  <li>
                    点击"创建服务账号"，填写名称和描述后点击"创建"
                  </li>
                  <li>
                    在<strong>"授予此服务账号的权限"</strong>步骤中：
                    <ul className="list-disc list-inside ml-4 mt-1 text-gray-600">
                      <li>展开"基本"角色列表</li>
                      <li>选择<strong>"所有者"</strong>（Owner）或根据需求选择自定义权限</li>
                    </ul>
                  </li>
                  <li>
                    点击"创建密钥"，选择"JSON"类型，点击"创建"下载文件
                  </li>
                  <li>
                    用文本编辑器打开下载的文件，复制完整内容
                  </li>
                </ol>
                <Alert className="mt-3 bg-amber-50 border-amber-200">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <AlertDescription>
                    <strong>重要：</strong>服务账号邮箱必须添加到 Google Ads MCC 的"访问权限和安全"中，否则无法访问 API
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* 常见问题 */}
            <Card id="faq">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  常见问题
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">Q: 我应该选择哪种配置方式？</h4>
                  <p className="text-sm text-gray-600">
                    如果您只管理自己的 Google Ads 账号，选择 <strong>OAuth 方式</strong>；如果您使用 MCC 账号管理多个子账号，推荐使用<strong>服务账号方式</strong>。
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Q: Developer Token 审核需要多久？</h4>
                  <p className="text-sm text-gray-600">
                    <strong>测试权限</strong>通常立即可用；<strong>基本访问权限</strong>通常需要 1-3 个工作日审核。
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Q: 服务账号密钥丢失怎么办？</h4>
                  <p className="text-sm text-gray-600">
                    在 Google Cloud Console 中删除旧密钥，重新创建新密钥并更新系统配置即可。
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Q: 如何确认服务账号已正确配置？</h4>
                  <p className="text-sm text-gray-600">
                    请检查以下三项：
                    <ul className="list-disc list-inside ml-2 mt-1">
                      <li>Google Ads API 在 GCP 项目中已启用</li>
                      <li>Developer Token 状态为 "Enabled" 或 "Test - Ready to use"</li>
                      <li>服务账号邮箱已在 MCC 的 "Access and security" 中添加</li>
                    </ul>
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* 故障排除 */}
            <Card className="border-orange-200 bg-orange-50/50" id="troubleshooting">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-800">
                  <AlertCircle className="w-5 h-5" />
                  故障排除
                </CardTitle>
                <CardDescription className="text-orange-700">
                  如果遇到 API 错误，请按以下步骤排查
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 错误1：配置不完整 */}
                <div className="bg-white rounded-lg p-4 border border-orange-200">
                  <h5 className="font-semibold text-orange-800 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 bg-orange-100 rounded flex items-center justify-center text-xs">!</span>
                    错误：服务账号配置不完整
                  </h5>
                  <p className="text-sm text-gray-600 mb-3">
                    如果遇到 API 验证错误，请按以下步骤检查：
                  </p>
                  <div className="space-y-3 ml-2">
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center text-xs flex-shrink-0">1</span>
                      <div>
                        <strong className="text-sm">检查 Google Ads API 是否已启用</strong>
                        <p className="text-xs text-gray-600 mt-1">
                          确认 GCP 项目中 Google Ads API 状态为 "Enabled"
                          <a href="https://console.cloud.google.com/apis/library/googleads.googleapis.com" target="_blank" className="text-blue-600 hover:underline ml-1">检查</a>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center text-xs flex-shrink-0">2</span>
                      <div>
                        <strong className="text-sm">验证 Developer Token 有效性</strong>
                        <p className="text-xs text-gray-600 mt-1">
                          Token 必须为 "Enabled" 或 "Test - Ready to use"，格式为 22 位字符
                          <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline ml-1">检查</a>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center text-xs flex-shrink-0">3</span>
                      <div>
                        <strong className="text-sm">确认服务账号已添加到 MCC</strong>
                        <p className="text-xs text-gray-600 mt-1">
                          在 "Tools & Settings → Access and security" 中添加服务账号邮箱
                        </p>
                      </div>
                    </div>
                  </div>
                  <Alert className="mt-3 bg-blue-50 border-blue-200">
                    <AlertDescription className="text-sm">
                      <strong>注意：</strong>添加服务账号后，可能需要等待 5-10 分钟才能生效
                    </AlertDescription>
                  </Alert>
                </div>

                {/* 错误2：PERMISSION_DENIED */}
                <div className="bg-white rounded-lg p-4 border border-red-200">
                  <h5 className="font-semibold text-red-800 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 bg-red-100 rounded flex items-center justify-center text-xs">!</span>
                    错误：PERMISSION_DENIED
                  </h5>
                  <p className="text-sm text-gray-600 mb-3">
                    如果日志中出现 <code className="bg-red-50 px-1 rounded">PERMISSION_DENIED: The caller does not have permission</code> 错误，说明服务账号没有被添加到 Google Ads MCC 账户中。
                  </p>
                  <p className="text-sm text-gray-600 mb-2">
                    <strong>解决方法：</strong>
                  </p>
                  <ol className="text-sm text-gray-600 list-decimal list-inside space-y-2 ml-1">
                    <li>
                      <strong>登录 Google Ads MCC 账号</strong>
                      <a href="https://ads.google.com/aw/apicenter" target="_blank" className="text-blue-600 hover:underline ml-1">访问</a>
                    </li>
                    <li>
                      <strong>添加服务账号</strong>：
                      <ul className="list-disc list-inside ml-4 mt-1 text-gray-600">
                        <li>点击 <strong>"Tools & Settings" → "Access and security"</strong></li>
                        <li>点击 <strong>"Add Access"</strong> 或 <strong>"Link Account"</strong></li>
                        <li>输入服务账号邮箱（如 <code className="bg-gray-100 px-1 rounded">xxx@project-id.iam.gserviceaccount.com</code>）</li>
                        <li>分配角色：<strong>"Admin access"</strong> 或 <strong>"Standard access"</strong></li>
                      </ul>
                    </li>
                    <li>
                      <strong>等待 5-30 分钟</strong>让权限生效
                    </li>
                  </ol>
                  <Alert className="mt-3 bg-amber-50 border-amber-200">
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                    <AlertDescription className="text-sm">
                      <strong>重要：</strong>服务账号必须被添加到 Google Ads MCC 账户中，即使它在 Google Cloud 有完全权限。
                    </AlertDescription>
                  </Alert>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 帮助资源 - 页面底部 */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>帮助资源</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <a href="https://developers.google.com/google-ads/api/docs/start" target="_blank" className="flex items-center gap-2 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                <ExternalLink className="w-4 h-4 text-blue-500" />
                <span className="text-blue-600 hover:underline">Google Ads API 官方文档</span>
              </a>
              <a href="https://developers.google.com/google-ads/api/docs/oauth/service-accounts" target="_blank" className="flex items-center gap-2 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                <ExternalLink className="w-4 h-4 text-blue-500" />
                <span className="text-blue-600 hover:underline">服务账号认证指南</span>
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
