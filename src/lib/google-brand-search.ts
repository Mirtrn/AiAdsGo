/**
 * Google品牌词搜索（独立站增强）
 *
 * 目标：
 * - 使用品牌词（优先用户输入）在Google搜索
 * - 尝试提取：官网（首个自然结果）+ 搜索广告元素（headline/description/callout/sitelink）
 *
 * 约束：
 * - 反爬失败不影响主流程（best-effort）
 * - 解析规则以“稳定优先”为目标，尽量使用语义/结构选择器而非易变class
 */

import type { Page } from 'playwright'
import { getLanguageCodeForCountry } from '@/lib/language-country-codes'
import { createStealthBrowser, configureStealthPage, releaseBrowser } from '@/lib/stealth-scraper/browser-stealth'
import { scrapeUrl } from '@/lib/scraper'
import { extractBrandServices, generateCalloutSuggestions, generateSitelinkSuggestions } from '@/lib/brand-services-extractor'

export interface SerpSitelink {
  text: string
  description?: string
}

export interface SerpAd {
  headlines: string[]
  descriptions: string[]
  callouts: string[]
  sitelinks: SerpSitelink[]
  displayUrl?: string
  landingUrl?: string
}

export interface BrandSearchSupplement {
  query: string
  targetCountry: string
  searchedAt: string
  officialSite?: {
    url: string
    title?: string
    snippet?: string
    metaTitle?: string
    metaDescription?: string
  }
  ads: SerpAd[]
  extracted: {
    headlines: string[]
    descriptions: string[]
    callouts: string[]
    sitelinks: SerpSitelink[]
  }
  errors?: string[]
}

function uniqStrings(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const normalized = item.trim()
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function uniqSitelinks(items: SerpSitelink[]): SerpSitelink[] {
  const seen = new Set<string>()
  const out: SerpSitelink[] = []
  for (const item of items) {
    const text = item?.text?.trim()
    if (!text) continue
    const key = `${text}__${(item.description || '').trim()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ text, description: item.description?.trim() || undefined })
  }
  return out
}

async function maybeAcceptGoogleConsent(page: Page): Promise<void> {
  try {
    const candidates = [
      'button:has-text("Accept all")',
      'button:has-text("I agree")',
      'button:has-text("同意")',
      'button:has-text("接受全部")',
    ]
    for (const selector of candidates) {
      const btn = page.locator(selector).first()
      if (await btn.count()) {
        await btn.click({ timeout: 2000 }).catch(() => {})
        await page.waitForTimeout(800).catch(() => {})
        return
      }
    }
  } catch {
    // best-effort
  }
}

export async function fetchBrandSearchSupplement(options: {
  brandName: string
  targetCountry: string
  proxyApiUrl: string
}): Promise<BrandSearchSupplement | null> {
  const query = options.brandName.trim()
  if (!query) return null

  const lang = getLanguageCodeForCountry(options.targetCountry) || 'en'
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(lang)}&gl=${encodeURIComponent(options.targetCountry)}&num=10`

  const browserResult = await createStealthBrowser(options.proxyApiUrl, options.targetCountry)
  const errors: string[] = []

  try {
    const page = await browserResult.context.newPage()
    await configureStealthPage(page, options.targetCountry)

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await maybeAcceptGoogleConsent(page)

    // 简单反爬检测：出现验证码/异常流量提示时直接返回空（不抛错）
    const maybeBlocked = await page.locator('text=/unusual traffic|not a robot|验证|captcha/i').first().count().catch(() => 0)
    if (maybeBlocked) {
      errors.push('Google SERP疑似触发反爬（unusual traffic / captcha）')
      return {
        query,
        targetCountry: options.targetCountry,
        searchedAt: new Date().toISOString(),
        ads: [],
        extracted: { headlines: [], descriptions: [], callouts: [], sitelinks: [] },
        errors,
      }
    }

    const raw = await page.evaluate(() => {
      const normalize = (s: string) => (s || '').replace(/\s+/g, ' ').trim()

      const organic: Array<{ url: string; title?: string; snippet?: string }> = []
      const organicNodes = Array.from(document.querySelectorAll('#search a h3'))
      for (const h3 of organicNodes) {
        const a = h3.closest('a') as HTMLAnchorElement | null
        if (!a?.href) continue
        const url = a.href
        if (!/^https?:\/\//i.test(url)) continue
        if (url.includes('google.com/')) continue
        const container = h3.closest('div')
        const snippet = container ? normalize(container.textContent || '') : ''
        organic.push({
          url,
          title: normalize(h3.textContent || ''),
          snippet: snippet || undefined,
        })
        if (organic.length >= 3) break
      }

      const adContainers = [
        ...Array.from(document.querySelectorAll('#tads [data-text-ad], #tads .uEierd, [data-text-ad]')),
      ] as HTMLElement[]

      const ads = adContainers.slice(0, 8).map((container) => {
        const text = normalize(container.innerText || '')
        const lines = text.split('\n').map(normalize).filter(Boolean)

        const headlineEls = Array.from(container.querySelectorAll('div[role="heading"], span[role="heading"], h3'))
        const headlines = headlineEls.map(el => normalize(el.textContent || '')).filter(Boolean)

        const linkEls = Array.from(container.querySelectorAll('a[href]')) as HTMLAnchorElement[]
        const landingUrl = linkEls.find(a => /^https?:\/\//i.test(a.href))?.href

        const displayUrl = lines.find(l => /\b(www\.)?[\w-]+\.[a-z]{2,}\b/i.test(l) && l.length <= 80)

        // descriptions：去掉headlines/展示URL后，保留较长行
        const headlineSet = new Set(headlines.map(h => h.toLowerCase()))
        const descriptions = lines
          .filter(l => l.length >= 30 && l.length <= 180)
          .filter(l => !headlineSet.has(l.toLowerCase()))
          .filter(l => displayUrl ? l !== displayUrl : true)

        // callouts：短句（<=25），排除“Sponsored/Ad”
        const callouts = lines
          .filter(l => l.length >= 4 && l.length <= 25)
          .filter(l => !/^(ad|ads|sponsored|赞助内容)$/i.test(l))
          .filter(l => !headlineSet.has(l.toLowerCase()))

        // sitelinks：短文本链接（<=25），尽量从a元素文本提取
        const sitelinks: Array<{ text: string; description?: string }> = []
        for (const a of linkEls) {
          const t = normalize(a.textContent || '')
          if (!t) continue
          if (t.length > 25) continue
          if (/^(ad|ads|sponsored)$/i.test(t)) continue
          if (headlineSet.has(t.toLowerCase())) continue
          sitelinks.push({ text: t })
          if (sitelinks.length >= 8) break
        }

        return {
          headlines,
          descriptions,
          callouts,
          sitelinks,
          displayUrl,
          landingUrl,
        }
      })

      return {
        officialSite: organic[0],
        ads,
      }
    })

    // 🔥 额外抓取官网页面信息（best-effort）：补充meta title/description + 真实callout/sitelink建议
    let officialMetaTitle: string | undefined
    let officialMetaDescription: string | undefined
    let officialCallouts: string[] = []
    let officialSitelinks: SerpSitelink[] = []

    const officialUrl = raw.officialSite?.url
    if (officialUrl) {
      try {
        const pageData = await scrapeUrl(officialUrl, options.proxyApiUrl, lang)
        officialMetaTitle = pageData.title?.trim() || undefined
        officialMetaDescription = pageData.description?.trim() || undefined

        const services = await extractBrandServices(officialUrl, options.targetCountry, options.proxyApiUrl)
        officialCallouts = generateCalloutSuggestions(services)
        officialSitelinks = generateSitelinkSuggestions(services, query).map(s => ({
          text: s.title,
          description: s.description,
        }))
      } catch (e: any) {
        errors.push(`官网补充抓取失败: ${e?.message || String(e)}`)
      }
    }

    const ads: SerpAd[] = (raw.ads || []).map((a: any) => ({
      headlines: uniqStrings(Array.isArray(a.headlines) ? a.headlines : []),
      descriptions: uniqStrings(Array.isArray(a.descriptions) ? a.descriptions : []),
      callouts: uniqStrings(Array.isArray(a.callouts) ? a.callouts : []),
      sitelinks: uniqSitelinks(Array.isArray(a.sitelinks) ? a.sitelinks : []),
      displayUrl: typeof a.displayUrl === 'string' ? a.displayUrl : undefined,
      landingUrl: typeof a.landingUrl === 'string' ? a.landingUrl : undefined,
    }))

    const extractedHeadlines = uniqStrings([
      ...(officialMetaTitle ? [officialMetaTitle] : []),
      ...ads.flatMap(a => a.headlines),
    ]).slice(0, 30)

    const extractedDescriptions = uniqStrings([
      ...(officialMetaDescription ? [officialMetaDescription] : []),
      ...ads.flatMap(a => a.descriptions),
    ]).slice(0, 20)

    const extractedCallouts = uniqStrings([
      ...officialCallouts,
      ...ads.flatMap(a => a.callouts),
    ]).slice(0, 20)

    const extractedSitelinks = uniqSitelinks([
      ...officialSitelinks,
      ...ads.flatMap(a => a.sitelinks),
    ]).slice(0, 12)

    return {
      query,
      targetCountry: options.targetCountry,
      searchedAt: new Date().toISOString(),
      officialSite: raw.officialSite?.url ? {
        ...raw.officialSite,
        metaTitle: officialMetaTitle,
        metaDescription: officialMetaDescription,
      } : undefined,
      ads,
      extracted: {
        headlines: extractedHeadlines,
        descriptions: extractedDescriptions,
        callouts: extractedCallouts,
        sitelinks: extractedSitelinks,
      },
      errors: errors.length > 0 ? errors : undefined,
    }
  } catch (error: any) {
    errors.push(error?.message || String(error))
    return {
      query,
      targetCountry: options.targetCountry,
      searchedAt: new Date().toISOString(),
      ads: [],
      extracted: { headlines: [], descriptions: [], callouts: [], sitelinks: [] },
      errors,
    }
  } finally {
    await releaseBrowser(browserResult)
  }
}
