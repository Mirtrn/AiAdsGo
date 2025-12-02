/**
 * Cloudflare Turnstile CAPTCHA 验证模块
 *
 * 功能：
 * - 验证Turnstile CAPTCHA token
 * - 判断是否需要CAPTCHA验证（3次失败后）
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY

/**
 * 验证Cloudflare Turnstile CAPTCHA token
 *
 * @param token - 前端Turnstile widget返回的token
 * @param remoteIp - 用户IP地址（可选，但推荐提供）
 * @returns Promise<boolean> - 验证成功返回true，失败返回false
 */
export async function verifyCaptcha(
  token: string,
  remoteIp?: string
): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) {
    console.error('❌ TURNSTILE_SECRET_KEY 环境变量未设置')
    return false
  }

  if (!token || token.trim() === '') {
    console.warn('⚠️ CAPTCHA token为空')
    return false
  }

  try {
    const formData = new URLSearchParams()
    formData.append('secret', TURNSTILE_SECRET_KEY)
    formData.append('response', token)

    if (remoteIp) {
      formData.append('remoteip', remoteIp)
    }

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (!response.ok) {
      console.error(`❌ Turnstile API响应异常: ${response.status} ${response.statusText}`)
      return false
    }

    const data = await response.json()

    if (data.success) {
      console.log('✅ CAPTCHA验证成功')
      return true
    } else {
      console.warn(`⚠️ CAPTCHA验证失败: ${JSON.stringify(data['error-codes'] || [])}`)
      return false
    }
  } catch (error: any) {
    console.error('❌ CAPTCHA验证异常:', error.message)
    return false
  }
}

/**
 * 判断是否需要CAPTCHA验证
 *
 * @param failedLoginCount - 失败登录次数
 * @returns boolean - 失败次数>=3时返回true
 */
export function shouldRequireCaptcha(failedLoginCount: number): boolean {
  return failedLoginCount >= 3
}
