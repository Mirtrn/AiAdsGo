## 更新说明

由于设置页面文件较大且包含转义字符，请手动更新以下部分：

### 位置
文件：`src/app/(app)/settings/page.tsx`
行号：约1951-2018

### 需要替换的内容
找到 `{/* API 访问级别配置 */}` 这一部分（包含两个可点击的按钮：Explorer Access 和 Basic Access）

### 替换为以下代码：

```tsx
                    {/* API 访问级别显示（自动检测） */}
                    {googleAdsCredentialStatus?.hasCredentials && (
                      <div className="border-t pt-6">
                        <div className="mb-4">
                          <Label className="label-text mb-2 block">Google Ads API 访问级别</Label>
                          <p className="text-sm text-gray-600 mb-3">
                            系统会自动检测您的 Developer Token 权限级别，并据此显示每日API调用次数上限
                          </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Test Access */}
                          <div className={`p-4 border-2 rounded-lg ${
                            googleAdsCredentialStatus.apiAccessLevel === 'test'
                              ? 'border-red-500 bg-red-50'
                              : 'border-gray-200 bg-gray-50'
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="font-semibold text-gray-900">Test Access</div>
                              {googleAdsCredentialStatus.apiAccessLevel === 'test' && (
                                <CheckCircle2 className="w-5 h-5 text-red-600" />
                              )}
                            </div>
                            <div className="text-sm text-gray-600 mb-2">
                              每日调用上限：<span className="font-semibold text-gray-900">0 次</span>
                            </div>
                            <div className="text-xs text-gray-500">
                              仅限测试账号，需升级权限
                            </div>
                          </div>

                          {/* Explorer Access */}
                          <div className={`p-4 border-2 rounded-lg ${
                            googleAdsCredentialStatus.apiAccessLevel === 'explorer'
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 bg-gray-50'
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="font-semibold text-gray-900">Explorer Access</div>
                              {googleAdsCredentialStatus.apiAccessLevel === 'explorer' && (
                                <CheckCircle2 className="w-5 h-5 text-blue-600" />
                              )}
                            </div>
                            <div className="text-sm text-gray-600 mb-2">
                              每日调用上限：<span className="font-semibold text-gray-900">2,880 次</span>
                            </div>
                            <div className="text-xs text-gray-500">
                              默认权限级别
                            </div>
                          </div>

                          {/* Basic Access */}
                          <div className={`p-4 border-2 rounded-lg ${
                            googleAdsCredentialStatus.apiAccessLevel === 'basic'
                              ? 'border-green-500 bg-green-50'
                              : 'border-gray-200 bg-gray-50'
                          }`}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="font-semibold text-gray-900">Basic Access</div>
                              {googleAdsCredentialStatus.apiAccessLevel === 'basic' && (
                                <CheckCircle2 className="w-5 h-5 text-green-600" />
                              )}
                            </div>
                            <div className="text-sm text-gray-600 mb-2">
                              每日调用上限：<span className="font-semibold text-gray-900">15,000 次</span>
                            </div>
                            <div className="text-xs text-gray-500">
                              生产环境推荐
                            </div>
                          </div>
                        </div>

                        {/* 提示信息 */}
                        {googleAdsCredentialStatus.apiAccessLevel === 'test' && (
                          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                              <div className="text-xs text-red-700">
                                <p className="font-medium mb-1">⚠️ 当前为测试权限</p>
                                <p>您的 Developer Token 仅限测试账号使用。访问 <a href="https://ads.google.com/aw/apicenter" target="_blank" rel="noopener noreferrer" className="underline hover:text-red-800">Google Ads API Center</a> 申请升级到 Basic 或 Standard 权限。</p>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <div className="flex items-start gap-2">
                            <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                            <div className="text-xs text-blue-700">
                              <p className="font-medium mb-1">🔍 自动检测说明</p>
                              <p>系统会在验证凭证或API调用时自动检测您的访问级别。如果权限发生变化（如从 Test 升级到 Basic），系统会自动更新。</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
```

### 同时需要删除的代码

在文件中找到并删除以下函数（因为不再需要手动更新API访问级别）：

```typescript
  // 更新 API 访问级别
  const handleUpdateApiAccessLevel = async (level: 'basic' | 'explorer') => {
    // ... 整个函数体
  }
```

以及删除这个状态变量：
```typescript
  const [updatingApiAccessLevel, setUpdatingApiAccessLevel] = useState(false)
```

### 更新接口定义

确保 `GoogleAdsCredentialStatus` 接口包含 `'test'` 类型：

```typescript
interface GoogleAdsCredentialStatus {
  // ... 其他字段
  apiAccessLevel?: 'test' | 'explorer' | 'basic'
  // ... 其他字段
}
```
