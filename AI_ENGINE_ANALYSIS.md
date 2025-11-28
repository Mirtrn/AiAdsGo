# AI引擎配置与选择逻辑分析报告

## 执行总结

系统已实现了**Vertex AI优先、Gemini API降级**的架构，但仍存在以下问题可能导致400错误和AI功能不可用：

### 关键发现
1. ✅ **Vertex AI支持已实现** - 完整的Vertex AI集成代码存在
2. ✅ **AI路由逻辑已实现** - 智能优先级选择已编码
3. ❌ **用户配置缺失** - 没有用户配置Vertex AI或Gemini API
4. ❌ **UI配置界面不完整** - 设置页面可能缺少AI配置选项
5. ⚠️ **错误处理不够明确** - 400错误来自Zod验证，但真实问题可能是AI配置缺失

---

## 1. AI引擎选择逻辑 (综合路由)

### 位置
- **主入口**: `/Users/jason/Documents/Kiro/autobb/src/lib/gemini.ts`
- **Vertex AI实现**: `/Users/jason/Documents/Kiro/autobb/src/lib/gemini-vertex.ts`
- **Gemini API实现**: `/Users/jason/Documents/Kiro/autobb/src/lib/gemini-axios.ts`

### 选择流程 (src/lib/gemini.ts第124-189行)

```typescript
export async function generateContent(
  params: GeminiGenerateParams,
  userId: number
): Promise<string> {
  // 1. 检查Vertex AI配置
  const hasVertexAI = isVertexAIConfigured(userId)
  
  // 2. 检查Gemini API配置
  const hasGeminiAPI = isGeminiAPIConfigured(userId)

  // 3. 路由逻辑
  if (!hasVertexAI && !hasGeminiAPI) {
    // ❌ 都没配置 → 报错
    throw new Error(`AI配置缺失：用户(ID=${userId})尚未配置任何AI服务...`)
  }

  // 4. 优先使用Vertex AI
  if (hasVertexAI) {
    try {
      configureVertexAI(userId)  // 动态配置环境
      return await generateContent(vertexParams)  // 调用Vertex AI
    } catch (error) {
      // 5. Vertex AI失败 → 降级到Gemini API
      if (hasGeminiAPI) {
        return await callDirectAPI(params, userId)
      }
      throw error
    }
  }

  // 6. 只有Gemini API
  return await callDirectAPI(params, userId)
}
```

### Vertex AI配置检查 (第34-58行)

```typescript
function isVertexAIConfigured(userId: number): boolean {
  const useVertexAI = getUserOnlySetting('ai', 'use_vertex_ai', userId)
  const gcpProjectId = getUserOnlySetting('ai', 'gcp_project_id', userId)
  const gcpServiceAccountJson = getUserOnlySetting('ai', 'gcp_service_account_json', userId)

  // 必须三个条件都满足
  return (
    useVertexAI?.value === 'true' &&
    !!gcpProjectId?.value &&
    !!gcpServiceAccountJson?.value
  )
}
```

### Gemini API配置检查 (第64-71行)

```typescript
function isGeminiAPIConfigured(userId: number): boolean {
  const apiKey = getUserOnlySetting('ai', 'gemini_api_key', userId)
  return !!apiKey?.value  // 只需要API密钥
}
```

---

## 2. Vertex AI实现详解

### 位置: `/Users/jason/Documents/Kiro/autobb/src/lib/gemini-vertex.ts`

### 初始化流程 (第33-86行)

```typescript
function getVertexAI(): VertexAI {
  const projectId = process.env.GCP_PROJECT_ID
  const location = process.env.GCP_LOCATION || 'us-central1'
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
    path.join(process.cwd(), 'docs/secrets/gcp_autoads_dev.json')

  // 检查配置变更，需要时重新初始化
  const needsReinit = !vertexAI || configChanged()

  if (needsReinit) {
    vertexAI = new VertexAI({
      project: projectId,
      location: location,
      googleAuthOptions: {
        keyFilename: credentialsPath,
      },
    })
  }

  return vertexAI
}
```

### 调用流程 (第139-252行) - 3次重试 + 自动降级

```typescript
export async function generateContent(params: {
  model?: string  // 'gemini-2.5-pro' | 'gemini-2.5-flash'
  prompt: string
  temperature?: number
  maxOutputTokens?: number
}): Promise<string> {
  const maxRetries = 3
  let lastError: Error | null = null

  // 尝试主模型
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await generativeModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens },
      })

      // 检查finishReason诊断截断
      if (candidate.finishReason !== 'STOP') {
        console.warn(`⚠️ 输出被截断: ${candidate.finishReason}`)
      }

      return extractText(result)
    } catch (error: any) {
      lastError = error
      // 检查可重试错误
      if (isRetryable(error) && attempt < maxRetries) {
        await delay(Math.pow(2, attempt) * 1000)  // 指数退避
        continue
      }
      break
    }
  }

  // 主模型失败 → 降级到gemini-2.5-flash
  if (model.includes('pro')) {
    try {
      return await generateContent({ ...params, model: 'gemini-2.5-flash' })
    } catch (fallbackError) {
      throw new Error(`主模型(${model})失败...降级模型(gemini-2.5-flash)失败...`)
    }
  }

  throw new Error(`Vertex AI调用失败: ${lastError?.message}`)
}
```

### 支持的模型
- ✅ gemini-2.5-pro (推荐，稳定版)
- ✅ gemini-2.5-flash (备选，快速版)
- ✅ gemini-2.5-flash-lite (轻量版)
- ✅ gemini-3-pro-preview-11-2025 (预览版)

---

## 3. Gemini API (直连)实现

### 位置: `/Users/jason/Documents/Kiro/autobb/src/lib/gemini-axios.ts`

### 特点
- **直接连接Google API** - 不使用代理
- **用户级密钥** - 从system_settings表读取用户的API密钥
- **自动降级** - 503错误自动降级到gemini-2.5-flash

### 调用流程 (第79-192行)

```typescript
export async function generateContent(params: {
  model?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
}, userId: number): Promise<string> {
  // 1. 从用户配置获取API密钥
  const apiKey = getUserOnlySetting('ai', 'gemini_api_key', userId)?.value
  if (!apiKey) {
    throw new Error(`用户(ID=${userId})未配置 Gemini API 密钥...`)
  }

  // 2. 创建axios客户端（直连）
  const client = createGeminiAxiosClient()

  // 3. 构建请求
  const request: GeminiRequest = {
    contents: [{ parts: [{ text: prompt }], role: 'user' }],
    generationConfig: { temperature, maxOutputTokens },
  }

  // 4. 调用主模型
  try {
    const response = await client.post(
      `/v1beta/models/${model}:generateContent`,
      request,
      { params: { key: apiKey } }
    )
    return response.data.candidates[0].content.parts[0].text
  } catch (error: any) {
    // 5. 检测503/过载错误
    const isOverloaded = error.response?.status === 503 || 
                         error.message?.includes('overload')

    // 6. 自动降级到gemini-2.5-flash
    if (isOverloaded && model === 'gemini-2.5-pro') {
      try {
        return await fallbackToFlash(request, apiKey)
      } catch (fallbackError) {
        throw new Error(`主模型失败...降级失败...`)
      }
    }

    throw new Error(`Gemini API调用失败: ${error.message}`)
  }
}
```

---

## 4. 用户配置管理 (数据库层)

### 位置: `/Users/jason/Documents/Kiro/autobb/src/lib/settings.ts`

### 关键函数: `getUserOnlySetting()`

```typescript
/**
 * 获取用户级配置（只返回用户自己的配置，不会回退到全局配置）
 * 用于AI配置的严格用户隔离
 */
export function getUserOnlySetting(
  category: string,
  key: string,
  userId: number
): SettingValue | null {
  const db = getSQLiteDatabase()
  
  // 只查询user_id等于该用户的记录（不包含全局配置）
  const query = `
    SELECT * FROM system_settings 
    WHERE category = ? AND config_key = ? AND user_id = ? 
    LIMIT 1
  `
  
  const setting = db.prepare(query).get(category, key, userId)
  
  if (!setting) return null
  
  return {
    category: setting.category,
    key: setting.config_key,
    value: setting.is_sensitive && setting.encrypted_value
      ? decrypt(setting.encrypted_value)
      : setting.config_value,
    ...
  }
}
```

### 必需的system_settings表记录

#### Vertex AI配置 (user_id = 该用户)
| category | config_key | config_value | description |
|----------|-----------|--------------|-------------|
| ai | use_vertex_ai | "true" | 启用Vertex AI标志 |
| ai | gcp_project_id | "your-project-id" | GCP项目ID |
| ai | gcp_location | "us-central1" | GCP区域（可选，默认us-central1）|
| ai | gcp_service_account_json | {json} | Service Account凭证JSON（加密）|

#### Gemini API配置 (user_id = 该用户)
| category | config_key | config_value | description |
|----------|-----------|--------------|-------------|
| ai | gemini_api_key | "AIza..." | Gemini API密钥（加密）|

---

## 5. AI调用链路

### 调用流程图

```
CreateOfferModalV2 (UI)
    ↓
useOfferExtraction Hook
    ↓
startExtraction() → POST /api/offers/extract/stream
    ↓
extractOffer() (SSE流程)
    ↓
Step 6: AI产品分析
    ├→ analyzeProductPage()
    │   ├→ import('./gemini')
    │   ├→ generateContent(params, userId)
    │   │   ├→ isVertexAIConfigured(userId)? → YES
    │   │   │   ├→ configureVertexAI(userId)
    │   │   │   ├→ import('./gemini-vertex')
    │   │   │   └→ generateContent(vertexParams)
    │   │   │
    │   │   └→ isVertexAIConfigured(userId)? → NO
    │   │       ├→ isGeminiAPIConfigured(userId)? → YES
    │   │       ├→ callDirectAPI(params, userId)
    │   │       │   ├→ import('./gemini-axios')
    │   │       │   └→ generateContent(params, userId)
    │   │       │
    │   │       └→ 都未配置 → ERROR: "AI配置缺失"
    │   │
    │   └→ Zod解析JSON响应
    │
    └→ SSE推送进度
    
    ↓
POST /api/offers (创建Offer)
    ↓
Response: { success: true, offer: {...} }
```

---

## 6. 为什么可能没有使用Vertex AI

### 根本原因
**用户尚未配置Vertex AI或Gemini API**

### 诊断步骤

#### 步骤1: 检查system_settings表
```sql
-- 查看用户是否有AI配置
SELECT * FROM system_settings 
WHERE user_id = {当前用户ID}
AND category = 'ai';
```

#### 步骤2: 检查配置值
```typescript
// 在代码中添加调试日志
function isVertexAIConfigured(userId: number): boolean {
  const useVertexAI = getUserOnlySetting('ai', 'use_vertex_ai', userId)
  const gcpProjectId = getUserOnlySetting('ai', 'gcp_project_id', userId)
  const gcpServiceAccountJson = getUserOnlySetting('ai', 'gcp_service_account_json', userId)

  console.log(`🔍 Vertex AI配置检查 (用户ID: ${userId}):`)
  console.log(`   use_vertex_ai: ${useVertexAI?.value} ← 必须是 'true'`)
  console.log(`   gcp_project_id: ${gcpProjectId?.value ? '已配置' : '❌ 未配置'}`)
  console.log(`   gcp_service_account_json: ${gcpServiceAccountJson?.value ? '已配置' : '❌ 未配置'}`)

  return (
    useVertexAI?.value === 'true' &&  // 字符串'true'，不是布尔值!
    !!gcpProjectId?.value &&
    !!gcpServiceAccountJson?.value
  )
}
```

#### 步骤3: 检查gemini.ts的日志输出
当`analyzeProductPage()`调用时：

```
❌ "AI配置缺失：用户(ID=1)尚未配置任何AI服务"
   → 说明: use_vertex_ai ≠ 'true' 且 gemini_api_key 为空

✓ "🚀 使用用户(ID=1)的 Vertex AI 配置"
  "Project: your-project-id"
  "Location: us-central1"
   → 说明: Vertex AI已配置，正在使用

✓ "🌐 使用用户(ID=1)的 Gemini 直接 API 配置"
   → 说明: Vertex AI未配置或失败，已降级到Gemini API
```

---

## 7. 400错误分析

### 可能的400错误来源

#### 源1: 创建Offer API验证 (src/app/api/offers/route.ts第41-49行)

```typescript
const createOfferSchema = z.object({
  url: z.string().url('无效的URL格式'),  // ← 可能失败
  brand: z.string().min(1, '品牌名称不能为空').optional(),
  target_country: z.string().min(2, '目标国家代码至少2个字符'),
  final_url: z.string().url('无效的Final URL格式').optional(),
  // ... 其他字段
})

if (!validationResult.success) {
  return NextResponse.json(
    {
      error: validationResult.error.errors[0].message,
      details: validationResult.error.errors,
    },
    { status: 400 }  // ← 这是400错误
  )
}
```

#### 错误消息示例
- ❌ `"无效的URL格式"` - url字段不是有效URL
- ❌ `"品牌名称不能为空"` - brand为空或null
- ❌ `"目标国家代码至少2个字符"` - target_country太短
- ❌ `"无效的Final URL格式"` - final_url不是有效URL

### 为什么CreateOfferModalV2会得到400

#### 问题1: null值通过Zod验证
```typescript
// 前端代码 (CreateOfferModalV2.tsx第172-184行)
body: JSON.stringify({
  affiliate_link: affiliateLink,
  brand: brandName.trim(),
  target_country: targetCountry,
  url: extractedData.finalUrl,  // ← 可能是null
  final_url: extractedData.finalUrl,  // ← 可能是null
  final_url_suffix: extractedData.finalUrlSuffix || undefined,  // ← undefined也会导致400
  product_price: productPrice || undefined,  // ← undefined
  commission_payout: commissionPayout || undefined,  // ← undefined
  // ...
})
```

#### 问题2: extractedData可能为null
```typescript
if (!extractedData) {
  throw new Error('缺少提取的数据')
}

// 但是提取可能失败（包括AI配置缺失）
if (extractionError) {
  setError(extractionError)  // ← 用户看到此错误
  setCurrentStep('input')
}
```

---

## 8. Gemini API调用的具体实现

### 步骤1: 获取用户API密钥
```typescript
// src/lib/gemini-axios.ts第93-97行
const apiKeySetting = getUserOnlySetting('ai', 'gemini_api_key', userId)
const apiKey = apiKeySetting?.value
if (!apiKey) {
  throw new Error(`用户(ID=${userId})未配置 Gemini API 密钥...`)
}
```

### 步骤2: 创建HTTP客户端
```typescript
// 第53-61行
export function createGeminiAxiosClient(): AxiosInstance {
  return axios.create({
    baseURL: 'https://generativelanguage.googleapis.com',
    timeout: 60000,  // 60秒
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
```

### 步骤3: 构建请求体
```typescript
// 第104-115行
const request: GeminiRequest = {
  contents: [
    {
      parts: [{ text: prompt }],
      role: 'user',
    },
  ],
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 8192,
  },
}
```

### 步骤4: 发送HTTP POST请求
```typescript
// 第121-129行
const response = await client.post<GeminiResponse>(
  `/v1beta/models/${model}:generateContent`,  // 例: /v1beta/models/gemini-2.5-pro:generateContent
  request,
  {
    params: {
      key: apiKey,  // ← 在URL参数中传递API密钥
    },
  }
)
```

### 步骤5: 解析响应
```typescript
// 第132-144行
if (
  !response.data.candidates ||
  response.data.candidates.length === 0 ||
  !response.data.candidates[0].content.parts ||
  response.data.candidates[0].content.parts.length === 0
) {
  throw new Error('Gemini API 返回了空响应')
}

const text = response.data.candidates[0].content.parts[0].text
console.log(`✓ Gemini API 调用成功，返回 ${text.length} 字符`)

return text
```

### 完整HTTP请求示例
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=AIza...

Request Body:
{
  "contents": [
    {
      "parts": [
        {
          "text": "分析产品页面..."
        }
      ],
      "role": "user"
    }
  ],
  "generationConfig": {
    "temperature": 0.7,
    "maxOutputTokens": 8192
  }
}

Response:
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "text": "{\"brandDescription\": \"...\", ...}"
          }
        ],
        "role": "model"
      },
      "finishReason": "STOP"
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 1234,
    "candidatesTokenCount": 567,
    "totalTokenCount": 1801
  }
}
```

---

## 9. 关键的失败点和日志

### 在提取流程中 (src/app/api/offers/extract/stream/route.ts)

```typescript
// 第105-216行：AI产品分析步骤

try {
  // 导入AI分析函数
  const { analyzeProductPage } = await import('@/lib/ai');

  // 调用AI分析
  console.log(`🤖 开始AI产品分析 (页面类型: ${pageType})...`);
  aiProductInfo = await analyzeProductPage(
    {
      url: finalUrl,
      brand: brandName || 'Unknown',
      title: pageData.title,
      description: pageData.description,
      text: pageData.text,
      targetCountry: target_country,
      pageType,
    },
    userIdNum
  );

  aiAnalysisSuccess = true;
  console.log('✅ AI产品分析完成');
} catch (aiError: any) {
  // ⚠️ AI分析失败不影响主流程
  console.error('⚠️ AI产品分析失败（不影响流程）:', aiError.message);
  // 继续处理，不中断
}
```

### 预期的日志输出

#### 成功场景
```
🤖 开始AI产品分析 (页面类型: product)...
🔍 Vertex AI配置检查 (用户ID: 1):
   use_vertex_ai: true (类型: string)
   gcp_project_id: 已配置
   gcp_service_account_json: 已配置
   → Vertex AI已配置: true
🚀 使用用户(ID=1)的 Vertex AI 配置
   Project: my-gcp-project
   Location: us-central1
   Credentials: /tmp/gcp-sa-user-1.json
🤖 调用 Vertex AI: gemini-2.5-pro (尝试 1/3)
✓ Vertex AI 调用成功，返回 1250 字符
✓ Vertex AI 调用成功
✅ AI产品分析完成
```

#### 失败场景（无AI配置）
```
🤖 开始AI产品分析 (页面类型: product)...
🔍 Vertex AI配置检查 (用户ID: 1):
   use_vertex_ai: undefined (类型: undefined)
   gcp_project_id: 未配置
   gcp_service_account_json: 未配置
   → Vertex AI已配置: false
🌐 使用用户(ID=1)的 Gemini 直接 API 配置
⚠️ AI产品分析失败（不影响流程）: 用户(ID=1)未配置 Gemini API 密钥...
```

---

## 10. 配置检查清单

### 管理员配置 (全局设置)
- [ ] database初始化时是否创建了system_settings表?
- [ ] 表结构是否包含: user_id, category, config_key, encrypted_value等字段?

### 用户配置 (每个用户需要)

#### 选项A: 使用Vertex AI (推荐)
```sql
-- 必须为每个用户创建这些记录
INSERT INTO system_settings (user_id, category, config_key, config_value, is_sensitive) VALUES
  (1, 'ai', 'use_vertex_ai', 'true', 0),
  (1, 'ai', 'gcp_project_id', 'my-gcp-project-id', 0),
  (1, 'ai', 'gcp_service_account_json', '{"type":"service_account",...}', 1);

-- is_sensitive=1 时 config_value应为NULL，encrypted_value应包含加密的JSON
```

#### 选项B: 使用Gemini API直连
```sql
INSERT INTO system_settings (user_id, category, config_key, encrypted_value, is_sensitive) VALUES
  (1, 'ai', 'gemini_api_key', '<encrypted_API_KEY>', 1);
```

### UI配置流程 (需要实现)
1. [ ] 用户进入Settings页面
2. [ ] 用户选择AI模式 (Vertex AI 或 Gemini API)
3. [ ] 用户输入相应的凭证
4. [ ] 系统验证配置 (调用validateGeminiConfig或validateVertexAIConfig)
5. [ ] 保存到system_settings表 (使用updateSetting函数)

### 验证函数 (src/lib/settings.ts)
```typescript
// 验证Gemini API配置
export async function validateGeminiConfig(
  apiKey: string,
  model: string = 'gemini-2.5-pro',
  userId: number
): Promise<{ valid: boolean; message: string }>

// 验证Vertex AI配置  
export async function validateVertexAIConfig(
  gcpProjectId: string,
  gcpLocation: string,
  gcpServiceAccountJson: string
): Promise<{ valid: boolean; message: string }>
```

---

## 总结表

| 方面 | 状态 | 说明 |
|------|------|------|
| **Vertex AI代码** | ✅ 完整 | `gemini-vertex.ts` 完整实现，包含重试和降级 |
| **Gemini API代码** | ✅ 完整 | `gemini-axios.ts` 完整实现，直连Google API |
| **AI路由逻辑** | ✅ 完整 | `gemini.ts` 的generateContent智能选择 |
| **配置管理** | ✅ 完整 | `settings.ts`的getUserOnlySetting用户隔离 |
| **SSE集成** | ✅ 完整 | `extract/stream/route.ts`中的Step 6 AI分析 |
| **用户配置** | ❌ 缺失 | 用户未在system_settings中配置AI凭证 |
| **UI配置界面** | ⚠️ 未知 | 可能settings/page.tsx缺少AI配置选项 |
| **400错误来源** | ⚠️ Zod验证 | 从api/offers/route.ts的schema验证 |
| **根本原因** | ❌ 配置缺失 | 用户未配置Vertex AI或Gemini API |

---

## 推荐的修复步骤

1. **确认数据库状态**
   ```sql
   SELECT * FROM system_settings WHERE category = 'ai' LIMIT 20;
   ```

2. **为测试用户添加Gemini API配置**
   ```sql
   INSERT INTO system_settings (...) VALUES (1, 'ai', 'gemini_api_key', ...);
   ```

3. **测试AI功能**
   - 观察日志：`🌐 使用用户(ID=1)的 Gemini 直接 API 配置`
   - 观察成功完成：`✅ AI产品分析完成`

4. **完成Settings UI页面**
   - 添加AI配置选项
   - 实现Vertex AI配置表单
   - 实现Gemini API密钥输入
   - 调用validateGeminiConfig/validateVertexAIConfig

5. **添加Vertex AI支持** (可选)
   - 获取GCP Service Account JSON
   - 在Settings中上传/配置
   - 测试Vertex AI调用

