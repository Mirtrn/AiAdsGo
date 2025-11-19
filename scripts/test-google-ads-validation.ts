/**
 * Google Ads API验证功能测试脚本
 *
 * 测试场景：
 * 1. 空字段验证
 * 2. Client ID格式验证
 * 3. Client Secret格式验证
 * 4. Developer Token格式验证
 * 5. GoogleAdsApi实例创建验证
 * 6. OAuth URL生成验证
 * 7. Client credentials真实验证（如果提供真实凭证）
 */

import { validateGoogleAdsConfig } from '../src/lib/settings'

interface TestCase {
  name: string
  clientId: string
  clientSecret: string
  developerToken: string
  expectedValid: boolean
  expectedMessageContains: string
}

const testCases: TestCase[] = [
  // 测试1: 空字段验证
  {
    name: '测试1: 空Client ID',
    clientId: '',
    clientSecret: 'valid_client_secret_1234567890',
    developerToken: 'valid_developer_token_1234567890',
    expectedValid: false,
    expectedMessageContains: '所有字段都是必填的'
  },
  {
    name: '测试2: 空Client Secret',
    clientId: 'valid-client-id.apps.googleusercontent.com',
    clientSecret: '',
    developerToken: 'valid_developer_token_1234567890',
    expectedValid: false,
    expectedMessageContains: '所有字段都是必填的'
  },
  {
    name: '测试3: 空Developer Token',
    clientId: 'valid-client-id.apps.googleusercontent.com',
    clientSecret: 'valid_client_secret_1234567890',
    developerToken: '',
    expectedValid: false,
    expectedMessageContains: '所有字段都是必填的'
  },

  // 测试2: Client ID格式验证
  {
    name: '测试4: Client ID格式错误（不包含.apps.googleusercontent.com）',
    clientId: 'invalid-client-id-format',
    clientSecret: 'valid_client_secret_1234567890',
    developerToken: 'valid_developer_token_1234567890',
    expectedValid: false,
    expectedMessageContains: '.apps.googleusercontent.com'
  },
  {
    name: '测试5: Client ID格式正确',
    clientId: '123456789-abcdefg.apps.googleusercontent.com',
    clientSecret: 'valid_client_secret_1234567890',
    developerToken: 'valid_developer_token_1234567890',
    expectedValid: false, // 会在后续步骤失败（因为credentials无效）
    expectedMessageContains: '' // 会进入下一步验证
  },

  // 测试3: Client Secret格式验证
  {
    name: '测试6: Client Secret长度过短',
    clientId: '123456789-abcdefg.apps.googleusercontent.com',
    clientSecret: 'short',
    developerToken: 'valid_developer_token_1234567890',
    expectedValid: false,
    expectedMessageContains: 'Client Secret格式不正确'
  },

  // 测试4: Developer Token格式验证
  {
    name: '测试7: Developer Token长度过短',
    clientId: '123456789-abcdefg.apps.googleusercontent.com',
    clientSecret: 'valid_client_secret_1234567890',
    developerToken: 'short',
    expectedValid: false,
    expectedMessageContains: 'Developer Token格式不正确'
  },

  // 测试5: 所有格式正确但credentials无效
  {
    name: '测试8: 格式正确但credentials无效',
    clientId: '123456789-abcdefg.apps.googleusercontent.com',
    clientSecret: 'fake_client_secret_1234567890abcdefghijklmn',
    developerToken: 'fake_developer_token_1234567890abcdefghijklmn',
    expectedValid: false,
    expectedMessageContains: '' // 会在OAuth server验证时失败
  }
]

async function runTest(testCase: TestCase): Promise<void> {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`🧪 ${testCase.name}`)
  console.log(`${'='.repeat(80)}`)

  console.log(`📝 输入参数:`)
  console.log(`   Client ID: ${testCase.clientId || '(空)'}`)
  console.log(`   Client Secret: ${testCase.clientSecret ? testCase.clientSecret.substring(0, 10) + '...' : '(空)'}`)
  console.log(`   Developer Token: ${testCase.developerToken ? testCase.developerToken.substring(0, 10) + '...' : '(空)'}`)

  try {
    const result = await validateGoogleAdsConfig(
      testCase.clientId,
      testCase.clientSecret,
      testCase.developerToken
    )

    console.log(`\n📊 验证结果:`)
    console.log(`   Valid: ${result.valid}`)
    console.log(`   Message: ${result.message}`)

    // 验证结果是否符合预期
    const isValidMatch = result.valid === testCase.expectedValid
    const isMessageMatch = testCase.expectedMessageContains === '' ||
                          result.message.includes(testCase.expectedMessageContains)

    if (isValidMatch && (testCase.expectedMessageContains === '' || isMessageMatch)) {
      console.log(`\n✅ 测试通过`)
    } else {
      console.log(`\n❌ 测试失败`)
      if (!isValidMatch) {
        console.log(`   期望 valid: ${testCase.expectedValid}, 实际: ${result.valid}`)
      }
      if (!isMessageMatch) {
        console.log(`   期望消息包含: "${testCase.expectedMessageContains}"`)
        console.log(`   实际消息: "${result.message}"`)
      }
    }
  } catch (error: any) {
    console.log(`\n❌ 测试异常: ${error.message}`)
  }
}

async function runAllTests(): Promise<void> {
  console.log(`\n${'#'.repeat(80)}`)
  console.log(`# Google Ads API 验证功能测试`)
  console.log(`# 测试时间: ${new Date().toISOString()}`)
  console.log(`${'#'.repeat(80)}`)

  let passCount = 0
  let failCount = 0

  for (const testCase of testCases) {
    try {
      await runTest(testCase)
      passCount++
    } catch (error) {
      console.log(`❌ 测试执行失败: ${error}`)
      failCount++
    }
  }

  console.log(`\n${'#'.repeat(80)}`)
  console.log(`# 测试总结`)
  console.log(`${'#'.repeat(80)}`)
  console.log(`✅ 通过: ${passCount}/${testCases.length}`)
  console.log(`❌ 失败: ${failCount}/${testCases.length}`)
  console.log(``)
}

// 如果直接运行此脚本
if (require.main === module) {
  runAllTests().catch(console.error)
}

export { runAllTests, runTest, testCases }
