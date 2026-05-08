import type { ProxyProvider } from './base-provider'
import type { ProxyCredentials } from '../types'
import type { ValidationResult } from './base-provider'
import axios from 'axios'

/**
 * Kookeey 代理提供商
 * 官网: https://www.kookeey.com/
 *
 * 使用方式：
 *   1. 登录 Kookeey 控制台 → 动态住宅代理 → 提取动态IP
 *   2. 选择「账密认证模式提取」，配置好国家/地区/协议等参数
 *   3. 点击「生成API提取链接」，复制右侧生成的完整 URL
 *   4. 将该 URL 粘贴到本平台代理URL配置中
 *
 * URL 示例:
 *   https://www.kookeey.com/pickdynamicips?t=2&auth=pwd&format=4&n=1&p=http&gate=global
 *     &g=global&r=5&type=txt&sign=333c47683cbced3a8c517a249170a00a&accessid=7400006
 *     &upf=1,5&dl=\r\n
 *
 * 响应格式（txt，每行一条）:
 *   gate.kookeey.info:端口:用户名:密码\r\n
 *
 * 注意：sign 参数由 Kookeey 控制台预先生成，直接复制 URL 即可，无需手动计算签名。
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
        errors.push('缺少 accessid 参数（请从 Kookeey 控制台生成 API 提取链接后复制完整 URL）')
      }

      if (!params.get('sign')) {
        errors.push('缺少 sign 参数（请从 Kookeey 控制台生成 API 提取链接后复制完整 URL，勿手动修改）')
      }

      // 提取国家/地区参数 g 作为 countryCode（Kookeey 用 global/country code 格式）
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
        errors: ['URL格式无效，请从 Kookeey 控制台生成 API 提取链接后复制完整 URL'],
      }
    }
  }

  async extractCredentials(url: string): Promise<ProxyCredentials> {
    const validation = this.validate(url)
    if (!validation.isValid) {
      throw new Error(`Kookeey URL验证失败:\n${validation.errors.join('\n')}`)
    }

    const u = new URL(url)
    const params = new URLSearchParams(u.search)
    const accessid = params.get('accessid') || 'unknown'
    const g = params.get('g') || 'global'

    console.log(`[Kookeey] 请求代理IP (accessid=${accessid}, g=${g})`)

    const resp = await axios.get(url, {
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

    const body = typeof resp.data === 'string' ? resp.data : String(resp.data ?? '')

    // 尝试解析 JSON 错误响应（如: {"code": -1, "msg": "签名错误"}）
    const trimmed = body.trim()
    if (trimmed.startsWith('{')) {
      try {
        const json = JSON.parse(trimmed)
        const code = json.code ?? json.status
        if (code !== undefined && code !== 0 && code !== 200) {
          const msg = json.msg || json.message || 'Unknown Kookeey API error'
          throw new Error(`[Kookeey] API错误 code=${code}: ${msg}`)
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('[Kookeey]')) throw e
      }
    }

    // 响应格式：host:port:username:password（支持 \r\n 和 \n 分隔）
    const firstLine = trimmed.split(/\r?\n/)[0]?.trim()
    if (!firstLine) {
      throw new Error('[Kookeey] 响应为空，请检查 accessid / sign 是否有效，或账户余量是否充足')
    }

    const parts = firstLine.split(':')
    if (parts.length < 4) {
      console.error(`[Kookeey] 响应格式异常: ${firstLine}`)
      throw new Error(`[Kookeey] 代理格式错误，期望 host:port:user:pass，实际: ${firstLine}`)
    }

    const [host, portStr, username, password] = parts
    const port = parseInt(portStr, 10)

    if (!host || host.length < 4) throw new Error(`[Kookeey] 主机无效: ${host}`)
    if (Number.isNaN(port) || port < 1 || port > 65535) throw new Error(`[Kookeey] 端口无效: ${portStr}`)
    if (!username) throw new Error('[Kookeey] 用户名为空')
    if (!password) throw new Error('[Kookeey] 密码为空')

    console.log(`✅ [Kookeey] 获取代理成功: ${host}:${port}`)
    return { host, port, username, password, fullAddress: `${host}:${port}` }
  }
}
