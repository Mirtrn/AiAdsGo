import type { ProxyProvider } from './base-provider'
import { IPRocketProvider } from './iprocket-provider'
import { OxylabsProvider } from './oxylabs-provider'
import { AbcproxyProvider } from './abcproxy-provider'
import { GenericProxyProvider } from './generic-proxy-provider'

/**
 * 代理提供商注册表
 * 自动检测URL格式并选择合适的Provider
 */
export class ProxyProviderRegistry {
  private static providers: ProxyProvider[] = [
    new IPRocketProvider(),
    new OxylabsProvider(),
    new AbcproxyProvider(),
    new GenericProxyProvider(),
  ]

  /**
   * 注册新的Provider
   * @param provider - 代理提供商实例
   */
  static register(provider: ProxyProvider): void {
    this.providers.push(provider)
    console.log(`✅ 已注册代理Provider: ${provider.name}`)
  }

  /**
   * 根据URL获取合适的Provider
   * @param url - 代理URL
   * @returns 匹配的Provider实例
   * @throws 如果没有找到匹配的Provider
   */
  static getProvider(url: string): ProxyProvider {
    const provider = this.providers.find(p => p.canHandle(url))

    if (!provider) {
      const supportedFormats = this.providers.map(p => p.name).join(', ')
      throw new Error(
        `不支持的代理URL格式。支持的格式: ${supportedFormats}\n` +
        `URL: ${url}`
      )
    }

    return provider
  }

  /**
   * 获取所有已注册的Provider
   * @returns Provider列表
   */
  static getAllProviders(): ProxyProvider[] {
    return [...this.providers]
  }

  /**
   * 检查URL是否被支持
   * @param url - 代理URL
   * @returns true if URL format is supported
   */
  static isSupported(url: string): boolean {
    return this.providers.some(p => p.canHandle(url))
  }
}
