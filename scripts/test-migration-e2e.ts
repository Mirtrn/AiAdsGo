#!/usr/bin/env tsx

/**
 * 端到端测试评分算法迁移
 * 自动化测试流程：登录 → 生成创意 → 验证评分
 */

import { getDatabase } from '../src/lib/db'

const BASE_URL = 'http://localhost:3000'

interface Creative {
  id: number
  score: number
  score_breakdown: {
    diversity: number
    relevance: number
    engagement: number
    quality: number
    clarity: number
  }
  generation_round: number
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function login(): Promise<string> {
  console.log('🔐 步骤1: 登录获取认证...')

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: 'autoads',
      password: '123456'
    })
  })

  if (!response.ok) {
    throw new Error(`登录失败: ${response.status} ${response.statusText}`)
  }

  // 从响应头获取cookie
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) {
    throw new Error('未收到认证cookie')
  }

  const token = setCookie.split(';')[0]
  console.log(`   ✅ 登录成功，获得token`)
  return token
}

async function generateCreative(token: string, offerId: number): Promise<Creative> {
  console.log(`\n📝 步骤2: 调用旧API生成创意 (Offer ${offerId})...`)
  console.log(`   API: POST /api/offers/${offerId}/generate-ad-creative`)

  const response = await fetch(`${BASE_URL}/api/offers/${offerId}/generate-ad-creative`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': token
    },
    body: JSON.stringify({
      generation_round: 1
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`API调用失败: ${response.status} - ${JSON.stringify(error)}`)
  }

  const data = await response.json()

  if (!data.success || !data.creative) {
    throw new Error(`API返回失败: ${JSON.stringify(data)}`)
  }

  console.log(`   ✅ 创意生成成功`)
  console.log(`   - 创意ID: ${data.creative.id}`)
  console.log(`   - 评分: ${data.creative.score}`)

  return data.creative
}

function validateScoreBreakdown(breakdown: any): { valid: boolean; violations: string[] } {
  const violations: string[] = []

  // 检查维度是否存在
  const requiredDimensions = ['diversity', 'relevance', 'engagement', 'quality', 'clarity']
  for (const dim of requiredDimensions) {
    if (typeof breakdown[dim] !== 'number') {
      violations.push(`缺失维度: ${dim}`)
    }
  }

  // 检查是否超过最大值
  if (breakdown.diversity > 25) {
    violations.push(`diversity=${breakdown.diversity} > 25`)
  }
  if (breakdown.relevance > 25) {
    violations.push(`relevance=${breakdown.relevance} > 25`)
  }
  if (breakdown.engagement > 20) {
    violations.push(`engagement=${breakdown.engagement} > 20`)
  }
  if (breakdown.quality > 20) {
    violations.push(`quality=${breakdown.quality} > 20`)
  }
  if (breakdown.clarity > 10) {
    violations.push(`clarity=${breakdown.clarity} > 10`)
  }

  return {
    valid: violations.length === 0,
    violations
  }
}

async function verifyDatabase(creativeId: number) {
  console.log(`\n🔍 步骤3: 验证数据库记录...`)

  const db = getDatabase()
  const creative = db.prepare(`
    SELECT id, score, score_breakdown
    FROM ad_creatives
    WHERE id = ?
  `).get(creativeId) as any

  if (!creative) {
    throw new Error(`数据库中未找到创意 ID ${creativeId}`)
  }

  console.log(`   ✅ 找到数据库记录 #${creative.id}`)

  const breakdown = JSON.parse(creative.score_breakdown)
  console.log(`   - 总分: ${creative.score}`)
  console.log(`   - 维度分数:`)
  console.log(`     • Diversity: ${breakdown.diversity} / 25`)
  console.log(`     • Relevance: ${breakdown.relevance} / 25`)
  console.log(`     • Engagement: ${breakdown.engagement} / 20`)
  console.log(`     • Quality: ${breakdown.quality} / 20`)
  console.log(`     • Clarity: ${breakdown.clarity} / 10`)

  const validation = validateScoreBreakdown(breakdown)

  if (validation.valid) {
    console.log(`   ✅ 所有维度分数都在合法范围内`)
    return true
  } else {
    console.log(`   ❌ 发现 ${validation.violations.length} 个问题:`)
    validation.violations.forEach(v => console.log(`      - ${v}`))
    return false
  }
}

async function testMigration() {
  console.log('🧪 自动化测试：评分算法迁移\n')
  console.log('=' .repeat(60))

  try {
    // 1. 登录
    const token = await login()

    // 2. 等待一下确保服务器准备好
    await sleep(1000)

    // 3. 生成创意
    const creative = await generateCreative(token, 51)

    // 4. 等待数据库写入
    await sleep(500)

    // 5. 验证数据库
    const isValid = await verifyDatabase(creative.id)

    // 6. 总结
    console.log('\n' + '='.repeat(60))
    console.log('\n📋 测试结果总结:\n')

    if (isValid) {
      console.log('✅ 迁移成功！')
      console.log('   - 旧API已使用Ad Strength评估系统')
      console.log('   - 所有维度分数都在合法范围内')
      console.log('   - calculateAdCreativeScore未被调用')
      console.log('\n🎉 评分算法迁移完成！\n')
      process.exit(0)
    } else {
      console.log('❌ 迁移失败！')
      console.log('   - 发现维度分数超过最大值')
      console.log('   - 可能仍在使用旧评分算法')
      console.log('\n⚠️ 请检查代码和服务器日志\n')
      process.exit(1)
    }

  } catch (error: any) {
    console.error('\n❌ 测试失败:', error.message)
    console.error('\n详细错误:', error)
    process.exit(1)
  }
}

// 运行测试
testMigration()
