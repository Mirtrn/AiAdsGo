import type { ProxyProvider } from './base-provider'
import type { ProxyCredentials } from '../types'
import type { ValidationResult } from './base-provider'

/**
 * MiyaIP 动态住宅代理提供商
 * 官网: https://miyaip.com/
 *
 * 使用方式（直连格式 · 无需调用 API）：
 *   1. 登录 MiyaIP 控制台 → 动态住宅代理
 *   2. 选择「生成类型 = http(s)」、生成格式 = hostname:port:username:password
 *   3. 点击「生成代理IP」，复制下方生成的完整字符串
 *   4. 将该字符串粘贴到本平台代理URL配置中
 *
 * 直连字符串示例:
 *   us.miyaip.online:1111:1s7e3qtzwsrpumiyaip_g-US_f-1001:157632896
 *
 * 格式说明:
 *   {region}.miyaip.online:{port}:{username}:{password}
 *
 * 国家代码提取:
 *   - 从主机前缀提取（us → US，uk → GB 等）
 *   - 或从用户名中提取 _g-{CC}_ 部分
 *
 * 注意：此格式直接包含代理凭证，无需调用额外 API。
 */
export class MiyaIPProvider implements ProxyProvider {
  name = 'MiyaIP'

  canHandle(url: string): boolean {
    // 支持两种形式：
    // 1. 直连字符串: us.miyaip.online:1111:user:pass
    // 2. URL 形式: http://user:pass@us.miyaip.online:1111（以防用户转换格式）
    return url.includes('miyaip.online') || url.includes('miyaip.com')
  }

  validate(url: string): ValidationResult {
    const errors: string[] = []

    // 处理 URL 形式
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return this._validateUrlFormat(url)
    }

    // 处理直连字符串形式: host:port:username:password
    const parts = url.trim().split(':')
    if (parts.length < 4) {
      errors.push(
        `格式错误，期望 hostname:port:username:password（4 个字段），实际 ${parts.length} 个字段。` +
        `示例: us.miyaip.online:1111:1s7e3qtzwsrpumiyaip_g-US_f-1001:157632896`
      )
      return { isValid: false, countryCode: null, errors }
    }

    const [host, portStr, username, ...passwordParts] = parts
    const password = passwordParts.join(':') // 密码本身不含冒号，但防御性处理

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

    const countryCode = this._extractCountryCode(host, username)

    return {
      isValid: errors.length === 0,
      countryCode,
      errors,
    }
  }

  private _validateUrlFormat(url: string): ValidationResult {
    const errors: string[] = []
    try {
      const parsed = new URL(url)

      if (!parsed.hostname.includes('miyaip.')) {
        errors.push(`主机名必须包含 miyaip.online，实际: ${parsed.hostname}`)
      }

      const port = parseInt(parsed.port)
      if (isNaN(port) || port < 1 || port > 65535) {
        errors.push(`端口号无效: ${parsed.port}`)
      }

      if (!parsed.username) {
        errors.push('缺少用户名')
      }

      if (!parsed.password) {
        errors.push('缺少密码')
      }

      const countryCode = this._extractCountryCode(
        parsed.hostname,
        decodeURIComponent(parsed.username)
      )

      return {
        isValid: errors.length === 0,
        countryCode,
        errors,
      }
    } catch {
      return {
        isValid: false,
        countryCode: null,
        errors: ['URL 格式无效，请检查 URL 是否正确'],
      }
    }
  }

  /**
   * 从主机名前缀或用户名中提取国家代码
   *
   * 示例:
   *   host: us.miyaip.online → US
   *   username: 1s7e3qtzwsrpumiyaip_g-US_f-1001 → US
   */
  private _extractCountryCode(host: string, username: string): string | null {
    // 1. 优先从用户名中提取 _g-{CC}_ 模式（最准确）
    const usernameMatch = username.match(/_g-([A-Z]{2})_/i)
    if (usernameMatch) {
      return usernameMatch[1].toUpperCase()
    }

    // 2. 从主机名前缀提取（如 us.miyaip.online → US）
    const hostParts = host.split('.')
    const prefix = hostParts[0]?.toLowerCase()

    // 特殊映射
    const prefixMap: Record<string, string> = {
      us: 'US',
      uk: 'GB',
      gb: 'GB',
      ca: 'CA',
      au: 'AU',
      de: 'DE',
      fr: 'FR',
      jp: 'JP',
      sg: 'SG',
      nl: 'NL',
      it: 'IT',
      es: 'ES',
      br: 'BR',
      mx: 'MX',
      in: 'IN',
      nz: 'NZ',
      ie: 'IE',
      kr: 'KR',
    }

    if (prefix && prefixMap[prefix]) {
      return prefixMap[prefix]
    }

    // 3. 如果前缀是两字母，当作国家代码
    if (prefix && /^[a-z]{2}$/.test(prefix)) {
      return prefix.toUpperCase()
    }

    return null
  }

  async extractCredentials(url: string): Promise<ProxyCredentials> {
    // 处理 URL 形式
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return this._extractFromUrl(url)
    }

    // 处理直连字符串形式: host:port:username:password
    const validation = this.validate(url)
    if (!validation.isValid) {
      throw new Error(`MiyaIP 代理格式验证失败:\n${validation.errors.join('\n')}`)
    }

    const parts = url.trim().split(':')
    const [host, portStr, username, ...passwordParts] = parts
    const password = passwordParts.join(':')
    const port = parseInt(portStr, 10)

    const credentials: ProxyCredentials = {
      host,
      port,
      username,
      password,
      fullAddress: `${host}:${port}`,
    }

    const countryCode = this._extractCountryCode(host, username)
    console.log(
      `✅ [MiyaIP] 直连凭证解析成功: ${credentials.fullAddress}` +
      (countryCode ? ` (${countryCode})` : '')
    )

    return credentials
  }

  private async _extractFromUrl(url: string): Promise<ProxyCredentials> {
    const validation = this._validateUrlFormat(url)
    if (!validation.isValid) {
      throw new Error(`MiyaIP URL 验证失败:\n${validation.errors.join('\n')}`)
    }

    const parsed = new URL(url)
    const credentials: ProxyCredentials = {
      host: parsed.hostname,
      port: parseInt(parsed.port),
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      fullAddress: `${parsed.hostname}:${parsed.port}`,
    }

    const countryCode = this._extractCountryCode(
      parsed.hostname,
      credentials.username
    )
    console.log(
      `✅ [MiyaIP] URL 凭证解析成功: ${credentials.fullAddress}` +
      (countryCode ? ` (${countryCode})` : '')
    )

    return credentials
  }
}
