/**
 * 代理URL验证结果
 */
export interface ProxyUrlValidation {
  isValid: boolean
  countryCode: string | null  // UK | CA | ROW
  errors: string[]
}

/**
 * 验证Proxy URL格式是否正确
 *
 * 必需参数:
 * - cc: 国家代码 (UK | CA | ROW)
 * - ips: IP数量 (整数)
 * - proxyType: 代理类型 (必须是http)
 * - responseType: 响应格式 (必须是txt)
 *
 * @param proxyUrl - 代理服务商提供的API URL
 * @returns 验证结果
 *
 * @example
 * const validation = validateProxyUrl('https://api.iprocket.io/api?username=user&password=pass&cc=ROW&ips=1&proxyType=http&responseType=txt')
 * // { isValid: true, countryCode: 'ROW', errors: [] }
 */
export function validateProxyUrl(proxyUrl: string): ProxyUrlValidation {
  const errors: string[] = []
  let countryCode: string | null = null

  try {
    const url = new URL(proxyUrl)
    const params = new URLSearchParams(url.search)

    // 1. 验证 cc 参数（国家代码）
    const cc = params.get('cc')
    if (!cc) {
      errors.push('缺少国家代码参数 (cc)，请确认URL包含 cc=UK、cc=CA 或 cc=ROW')
    } else {
      const ccUpper = cc.toUpperCase()
      if (!['UK', 'CA', 'ROW'].includes(ccUpper)) {
        errors.push(`国家代码 "${cc}" 无效，仅支持 UK（英国）、CA（加拿大）、ROW（美国）`)
      } else {
        countryCode = ccUpper
      }
    }

    // 2. 验证 ips 参数（IP数量）
    const ips = params.get('ips')
    if (!ips) {
      errors.push('缺少IP数量参数 (ips)，请确认URL包含 ips=1')
    } else {
      const ipsNum = parseInt(ips)
      if (isNaN(ipsNum) || ipsNum < 1) {
        errors.push(`IP数量必须是大于0的整数，当前为: ${ips}`)
      }
    }

    // 3. 验证 proxyType 参数（代理类型）
    const proxyType = params.get('proxyType')
    if (!proxyType) {
      errors.push('缺少代理类型参数 (proxyType)，请确认URL包含 proxyType=http')
    } else if (proxyType.toLowerCase() !== 'http') {
      errors.push(`代理类型必须为HTTP，当前为: ${proxyType}`)
    }

    // 4. 验证 responseType 参数（响应格式）
    const responseType = params.get('responseType')
    if (!responseType) {
      errors.push('缺少响应格式参数 (responseType)，请确认URL包含 responseType=txt')
    } else if (responseType.toLowerCase() !== 'txt') {
      errors.push(`响应格式必须为文本（txt），当前为: ${responseType}`)
    }

    // 5. 验证URL协议
    if (!['http:', 'https:'].includes(url.protocol)) {
      errors.push('URL必须使用HTTP或HTTPS协议')
    }

    // 6. 验证必需的认证参数（username和password）
    const username = params.get('username')
    const password = params.get('password')

    if (!username) {
      errors.push('缺少认证用户名参数 (username)')
    }

    if (!password) {
      errors.push('缺少认证密码参数 (password)')
    }
  } catch (error) {
    errors.push('URL格式无效，请检查URL是否正确')
  }

  return {
    isValid: errors.length === 0,
    countryCode,
    errors,
  }
}

/**
 * 获取国家代码的友好名称
 *
 * @param countryCode - 国家代码 (UK | CA | ROW)
 * @returns 国家名称
 */
export function getCountryName(countryCode: string): string {
  const countryNames: Record<string, string> = {
    UK: '英国 (United Kingdom)',
    CA: '加拿大 (Canada)',
    ROW: '美国 (United States)',
  }

  return countryNames[countryCode.toUpperCase()] || countryCode
}

/**
 * 脱敏代理URL（用于日志记录）
 * 隐藏认证信息，只保留国家代码
 *
 * @param proxyUrl - 原始代理URL
 * @returns 脱敏后的URL
 *
 * @example
 * maskProxyUrl('https://api.iprocket.io/api?username=user&password=pass&cc=ROW&ips=1&proxyType=http&responseType=txt')
 * // 'https://api.iprocket.io/api?cc=ROW&...'
 */
export function maskProxyUrl(proxyUrl: string): string {
  try {
    const url = new URL(proxyUrl)
    const params = new URLSearchParams(url.search)
    const cc = params.get('cc')

    return `${url.origin}${url.pathname}?cc=${cc || 'UNKNOWN'}&...`
  } catch (error) {
    return '[INVALID_URL]'
  }
}
