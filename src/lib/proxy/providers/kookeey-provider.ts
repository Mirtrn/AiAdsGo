import type { ProxyProvider } from './base-provider'
import type { ProxyCredentials } from '../types'
import type { ValidationResult } from './base-provider'
import axios from 'axios'
import { createHmac } from 'crypto'

/**
 * Kookeey 代理提供商
 * 官网: https://www.kookeey.com/
 * 认证方式: HMAC-SHA1 签名
 *
 * URL格式（用户在设置页填写）:
 *   https://www.kookeey.com/clientapi/?accessid=YOUR_ID&token=YOUR_DEV_TOKEN&g=433&type=1&num=1
 *
 * 其中:
 *   - accessid: 账户 Access ID
 *   - token: 开发者 Token（用于签名，不直接出现在发出的请求中）
 *   - g: 代理地区/套餐组 ID（如 433 表示某国家流量池）
 *   - type: 代理类型（1=HTTP, 2=HTTPS, 3=SOCKS5）
 *   - num: 每次获取的 IP 数量，建议设置为 1
 *
 * 签名算法:
 *   1. 将所有参数（不含 token/signature）按 key 字典序排列
 *   2. 拼接为 "key1=val1&key2=val2&..."
 *   3. signature = Base64( HMAC-SHA1( developer_token, UTF-8(param_string) ) )
 *
 * 示例响应（txt 格式）:
 *   ip:port:username:password
 */
export class KookeeyProvider implements ProxyProvider {
  name = 'Kookeey'

  canHandle(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname.includes('kookeey.com')
    } catch {
      return false
    }
  }

  validate(url: string): ValidationResult {
    const errors: string[] = []

    try {
      const u = new URL(url)
      const params = new URLSearchParams(u.search)

      if (!u.hostname.includes('kookeey.com')) {
        errors.push('主机名必须包含 kookeey.com')
      }

      if (!params.get('accessid')) {
        errors.push('缺少 accessid 参数（您的 Kookeey 账户 Access ID）')
      }

      if (!params.get('token')) {
        errors.push('缺少 token 参数（您的 Kookeey 开发者 Token，用于签名）')
      }

      if (!params.get('g')) {
        errors.push('缺少 g 参数（代理地区/套餐组 ID，如 433）')
      }

      // type 可选，默认 1（HTTP）
      const typeVal = params.get('type')
      if (typeVal && !['1', '2', '3'].includes(typeVal)) {
        errors.push('type 参数无效（1=HTTP, 2=HTTPS, 3=SOCKS5）')
      }

      // 提取 g 参数作为"国家代码"用于 ValidationResult
      const g = params.get('g') || null

      return {
        isValid: errors.length === 0,
        countryCode: g,
        errors,
      }
    } catch {
      return {
        isValid: false,
        countryCode: null,
        errors: ['URL格式无效，请检查是否符合 https://www.kookeey.com/clientapi/?accessid=...&token=... 格式'],
      }
    }
  }

  /**
   * 生成 Kookeey HMAC-SHA1 签名
   *
   * @param devToken - 开发者 Token
   * @param paramString - 排好序的参数字符串（不含 token 和 signature）
   * @returns Base64 编码的签名
   */
  private buildSignature(devToken: string, paramString: string): string {
    const hmac = createHmac('sha1', devToken)
    hmac.update(paramString, 'utf8')
    return hmac.digest('base64')
  }

  /**
   * 构造签名参数字符串（按 key 字典序，排除 token/signature）
   */
  private buildParamString(params: Record<string, string>): string {
    return Object.keys(params)
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&')
  }

  async extractCredentials(url: string): Promise<ProxyCredentials> {
    const validation = this.validate(url)
    if (!validation.isValid) {
      throw new Error(`Kookeey URL验证失败:\n${validation.errors.join('\n')}`)
    }

    const u = new URL(url)
    const inputParams = new URLSearchParams(u.search)

    const accessid = inputParams.get('accessid')!
    const devToken = inputParams.get('token')!
    const g = inputParams.get('g')!
    const proxyType = inputParams.get('type') || '1'
    const num = inputParams.get('num') || '1'
    const ts = String(Math.floor(Date.now() / 1000))

    // 组装请求参数（不含 token/signature）
    const reqParams: Record<string, string> = {
      accessid,
      g,
      num,
      ts,
      type: proxyType,
    }

    // 生成签名
    const paramString = this.buildParamString(reqParams)
    const signature = this.buildSignature(devToken, paramString)

    // 构造最终请求 URL
    const apiUrl = new URL(`https://www.kookeey.com/clientapi/`)
    Object.entries(reqParams).forEach(([k, v]) => apiUrl.searchParams.set(k, v))
    apiUrl.searchParams.set('signature', signature)

    console.log(`[Kookeey] 请求代理IP (accessid=${accessid}, g=${g}, ts=${ts})`)

    const resp = await axios.get(apiUrl.toString(), {
      timeout: 15000,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept': 'text/plain,*/*',
      },
      validateStatus: () => true,
    })

    if (resp.status !== 200) {
      throw new Error(`[Kookeey] HTTP ${resp.status}: ${String(resp.data).substring(0, 200)}`)
    }

    const body = typeof resp.data === 'string' ? resp.data.trim() : String(resp.data ?? '').trim()

    // 尝试解析 JSON 错误响应（如: {"code": -1, "msg": "签名错误"}）
    if (body.startsWith('{')) {
      try {
        const json = JSON.parse(body)
        const code = json.code ?? json.status
        if (code !== undefined && code !== 0 && code !== 200) {
          const msg = json.msg || json.message || 'Unknown Kookeey API error'
          throw new Error(`[Kookeey] API错误 code=${code}: ${msg}`)
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('[Kookeey]')) throw e
        // JSON 解析失败但不像是代理地址，继续往下走
      }
    }

    // 期望格式：ip:port:username:password（每行一条，取第一行）
    const firstLine = body.split('\n')[0]?.trim()
    if (!firstLine) {
      throw new Error('[Kookeey] 响应为空，请检查 accessid / g 参数是否正确')
    }

    const parts = firstLine.split(':')
    if (parts.length < 4) {
      console.error(`[Kookeey] 响应格式异常: ${firstLine}`)
      throw new Error(`[Kookeey] 代理格式错误，期望 ip:port:user:pass，实际: ${firstLine}`)
    }

    const [host, portStr, username, password] = parts
    const port = parseInt(portStr, 10)

    if (!host || host.length < 7) throw new Error(`[Kookeey] 主机无效: ${host}`)
    if (Number.isNaN(port) || port < 1 || port > 65535) throw new Error(`[Kookeey] 端口无效: ${portStr}`)
    if (!username) throw new Error('[Kookeey] 用户名为空')
    if (!password) throw new Error('[Kookeey] 密码为空')

    console.log(`✅ [Kookeey] 获取代理成功: ${host}:${port}`)
    return { host, port, username, password, fullAddress: `${host}:${port}` }
  }
}
