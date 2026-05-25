/**
 * 代理URL验证结果
 */
export interface ProxyUrlValidation {
  isValid: boolean
  countryCode: string | null  // ISO2 / ROW (e.g. US, UK, CA, IE, NZ, ROW)
  errors: string[]
}

/**
 * 判断是否为 MiyaIP 直连字符串格式
 * 格式: host:port:username:password，其中 host 包含 miyaip.
 *
 * @example
 * isMiyaIPDirectFormat('us.miyaip.online:1111:1s7e3qtzwsrpumiyaip_g-US_f-1001:157632896') // true
 */
function isMiyaIPDirectFormat(proxyUrl: string): boolean {
  return proxyUrl.includes('miyaip.online') || proxyUrl.includes('miyaip.com')
}

/**
 * 验证 MiyaIP 直连格式字符串
 * 格式: {host}:{port}:{username}:{password}
 */
function validateMiyaIPDirectFormat(proxyUrl: string): ProxyUrlValidation {
  const errors: string[] = []
  let countryCode: string | null = null

  // 处理 http:// 格式的 MiyaIP URL
  if (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://')) {
    try {
      const parsed = new URL(proxyUrl)
      if (!parsed.hostname.includes('miyaip.')) {
        errors.push(`主机名必须包含 miyaip.online，实际: ${parsed.hostname}`)
      }
      const port = parseInt(parsed.port)
      if (isNaN(port) || port < 1 || port > 65535) {
        errors.push(`端口号无效: ${parsed.port}`)
      }
      if (!parsed.username) errors.push('缺少用户名')
      if (!parsed.password) errors.push('缺少密码')
      countryCode = _extractMiyaIPCountryCode(
        parsed.hostname,
        decodeURIComponent(parsed.username)
      )
    } catch {
      errors.push('URL 格式无效，请检查是否正确')
    }
    return { isValid: errors.length === 0, countryCode, errors }
  }

  // 直连字符串: host:port:username:password
  const parts = proxyUrl.trim().split(':')
  if (parts.length < 4) {
    errors.push(
      `MiyaIP 直连格式错误，期望 hostname:port:username:password（4 个字段），` +
      `实际 ${parts.length} 个字段。` +
      `示例: us.miyaip.online:1111:1s7e3qtzwsrpumiyaip_g-US_f-1001:157632896`
    )
    return { isValid: false, countryCode: null, errors }
  }

  const [host, portStr, username, ...passwordParts] = parts
  const password = passwordParts.join(':')

  if (!host || !host.includes('miyaip.')) {
    errors.push(`主机名无效，期望包含 miyaip.online，实际: ${host}`)
  }

  const port = parseInt(portStr, 10)
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    errors.push(`端口号无效（有效范围: 1-65535），实际: ${portStr}`)
  }

  if (!username || username.length < 3) {
    errors.push('用户名为空或过短')
  }

  if (!password || password.length < 1) {
    errors.push('密码为空')
  }

  countryCode = _extractMiyaIPCountryCode(host || '', username || '')

  return {
    isValid: errors.length === 0,
    countryCode,
    errors,
  }
}

/**
 * 从 MiyaIP 主机名或用户名中提取国家代码
 */
function _extractMiyaIPCountryCode(host: string, username: string): string | null {
  // 优先从用户名 _g-{CC}_ 中提取
  const usernameMatch = username.match(/_g-([A-Z]{2})_/i)
  if (usernameMatch) return usernameMatch[1].toUpperCase()

  // 从主机名前缀提取（us.miyaip.online → US）
  const prefix = host.split('.')[0]?.toLowerCase()
  if (!prefix) return null

  const prefixMap: Record<string, string> = {
    us: 'US', uk: 'GB', gb: 'GB', ca: 'CA', au: 'AU',
    de: 'DE', fr: 'FR', jp: 'JP', sg: 'SG', nl: 'NL',
    it: 'IT', es: 'ES', br: 'BR', mx: 'MX', in: 'IN',
    nz: 'NZ', ie: 'IE', kr: 'KR',
  }

  if (prefixMap[prefix]) return prefixMap[prefix]
  if (/^[a-z]{2}$/.test(prefix)) return prefix.toUpperCase()

  return null
}

/**
 * 验证Proxy URL格式是否正确
 *
 * 支持以下格式：
 *
 * 1. MiyaIP 直连格式（直连 · 无需调用 API）：
 *    {host}:{port}:{username}:{password}
 *    示例: us.miyaip.online:1111:1s7e3qtzwsrpumiyaip_g-US_f-1001:157632896
 *
 * 2. API 获取格式（如 IPRocket 等），必需参数：
 *    - cc: 国家代码 (如 US/UK/CA/IE/NZ/ROW 等)
 *    - ips: IP数量 (整数)
 *    - proxyType: 代理类型 (必须是http)
 *    - responseType: 响应格式 (必须是txt)
 *
 * @param proxyUrl - 代理服务商提供的 URL 或直连字符串
 * @returns 验证结果
 *
 * @example
 * // MiyaIP 直连格式
 * validateProxyUrl('us.miyaip.online:1111:1s7e3qtzwsrpumiyaip_g-US_f-1001:157632896')
 * // { isValid: true, countryCode: 'US', errors: [] }
 *
 * // IPRocket API 格式
 * validateProxyUrl('https://api.iprocket.io/api?username=user&password=pass&cc=ROW&ips=1&proxyType=http&responseType=txt')
 * // { isValid: true, countryCode: 'ROW', errors: [] }
 */
export function validateProxyUrl(proxyUrl: string): ProxyUrlValidation {
  // MiyaIP 直连格式（host:port:user:pass 或 http://user:pass@host:port）
  if (isMiyaIPDirectFormat(proxyUrl)) {
    return validateMiyaIPDirectFormat(proxyUrl)
  }

  // ─── API 获取格式（IPRocket、Kookeey 等）─────────────────────────
  const errors: string[] = []
  let countryCode: string | null = null

  try {
    const url = new URL(proxyUrl)
    const params = new URLSearchParams(url.search)

    // Kookeey 格式单独处理（无 cc/ips/proxyType 参数）
    if (url.hostname.includes('kookeey.com')) {
      if (!params.get('accessid')) {
        errors.push('缺少 accessid 参数（Kookeey）')
      }
      if (!params.get('sign')) {
        errors.push('缺少 sign 参数（Kookeey）')
      }
      const g = params.get('g') || null
      return { isValid: errors.length === 0, countryCode: g, errors }
    }

    // 1. 验证 cc 参数（国家代码）
    const cc = params.get('cc')
    if (!cc) {
      errors.push('缺少国家代码参数 (cc)，请确认URL包含 cc=US/UK/CA/IE/NZ/ROW 等')
    } else {
      const ccUpper = cc.toUpperCase()
      // 允许任意 ISO 3166-1 alpha-2（两位字母）+ ROW（其他地区）
      const isIso2 = /^[A-Z]{2}$/.test(ccUpper)
      if (ccUpper !== 'ROW' && !isIso2) {
        errors.push(`国家代码 "${cc}" 无效，期望为两位字母(如 US/GB/IE/NZ) 或 ROW`)
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
    IE: '爱尔兰 (Ireland)',
    CA: '加拿大 (Canada)',
    US: '美国 (United States)',
    ROW: '美国 (United States)',
    DE: '德国 (Germany)',
    FR: '法国 (France)',
    AU: '澳大利亚 (Australia)',
    NZ: '新西兰 (New Zealand)',
    JP: '日本 (Japan)',
    ES: '西班牙 (Spain)',
    IT: '意大利 (Italy)',
    NL: '荷兰 (Netherlands)',
    BR: '巴西 (Brazil)',
    MX: '墨西哥 (Mexico)',
    IN: '印度 (India)',
    SG: '新加坡 (Singapore)',
  }

  return countryNames[countryCode.toUpperCase()] || countryCode
}

/**
 * 脱敏代理URL（用于日志记录）
 * 隐藏认证信息，只保留国家代码和主机信息
 *
 * @param proxyUrl - 原始代理URL 或 MiyaIP 直连字符串
 * @returns 脱敏后的URL
 *
 * @example
 * maskProxyUrl('https://api.iprocket.io/api?username=user&password=pass&cc=ROW&ips=1&proxyType=http&responseType=txt')
 * // 'https://api.iprocket.io/api?cc=ROW&...'
 * maskProxyUrl('https://customer-xxrenzhe_pQhay-cc-fr:password@pr.oxylabs.io:7777')
 * // 'https://pr.oxylabs.io:7777 (cc-fr)'
 * maskProxyUrl('us.miyaip.online:1111:1s7e3qtzwsrpumiyaip_g-US_f-1001:157632896')
 * // 'us.miyaip.online:1111 (US)'
 */
export function maskProxyUrl(proxyUrl: string): string {
  // MiyaIP 直连字符串格式: host:port:username:password（非 http:// 开头）
  if (
    (proxyUrl.includes('miyaip.online') || proxyUrl.includes('miyaip.com')) &&
    !proxyUrl.startsWith('http://') &&
    !proxyUrl.startsWith('https://')
  ) {
    const parts = proxyUrl.trim().split(':')
    const host = parts[0] || 'unknown'
    const port = parts[1] || '?'
    const username = parts[2] || ''
    const ccMatch = username.match(/_g-([A-Z]{2})_/i)
    const cc = ccMatch ? ccMatch[1].toUpperCase() : null
    return cc ? `${host}:${port} (${cc})` : `${host}:${port}`
  }

  try {
    const url = new URL(proxyUrl)

    // MiyaIP URL 格式: http://user:pass@us.miyaip.online:1111
    if (url.hostname.includes('miyaip.')) {
      const username = decodeURIComponent(url.username)
      const ccMatch = username.match(/_g-([A-Z]{2})_/i)
      const hostPrefix = url.hostname.split('.')[0]?.toLowerCase()
      const prefixMap: Record<string, string> = {
        us: 'US', uk: 'GB', gb: 'GB', ca: 'CA', au: 'AU',
        de: 'DE', fr: 'FR', jp: 'JP', sg: 'SG', nl: 'NL',
      }
      const cc = ccMatch
        ? ccMatch[1].toUpperCase()
        : (hostPrefix && prefixMap[hostPrefix]) || null
      return cc
        ? `${url.protocol}//${url.hostname}:${url.port} (${cc})`
        : `${url.protocol}//${url.hostname}:${url.port}`
    }

    // Oxylabs格式：从username中提取cc代码
    if (url.hostname.includes('oxylabs.io')) {
      const ccMatch = url.username.match(/cc-([a-z]{2})/i)
      const cc = ccMatch ? ccMatch[1].toUpperCase() : null
      return cc ? `${url.protocol}//${url.hostname}:${url.port} (cc-${cc})` : `${url.protocol}//${url.hostname}:${url.port}`
    }

    // Kookeey格式：只保留 accessid 和 g 参数，隐藏 token
    if (url.hostname.includes('kookeey.com')) {
      const params = new URLSearchParams(url.search)
      const accessid = params.get('accessid') || 'UNKNOWN'
      const g = params.get('g') || 'UNKNOWN'
      return `${url.origin}${url.pathname}?accessid=${accessid}&g=${g}&...`
    }

    // IPRocket格式：从查询参数提取cc
    const params = new URLSearchParams(url.search)
    const cc = params.get('cc')
    return `${url.origin}${url.pathname}?cc=${cc || 'UNKNOWN'}&...`
  } catch (error) {
    return '[INVALID_URL]'
  }
}
