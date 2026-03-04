import { describe, expect, it } from 'vitest'
import {
  __testOnly,
  extractYeahPromosPayload,
  extractYeahPromosTransactionsPayload,
  normalizeYeahPromosResultCode,
  parseYeahPromosMerchantCommission,
} from '@/lib/affiliate-products'

describe('normalizeYeahPromosResultCode', () => {
  it('parses success code from number and string', () => {
    expect(normalizeYeahPromosResultCode(100000)).toBe(100000)
    expect(normalizeYeahPromosResultCode('100000')).toBe(100000)
  })

  it('returns null for empty or invalid values', () => {
    expect(normalizeYeahPromosResultCode(undefined)).toBeNull()
    expect(normalizeYeahPromosResultCode(null)).toBeNull()
    expect(normalizeYeahPromosResultCode('')).toBeNull()
    expect(normalizeYeahPromosResultCode('ERR')).toBeNull()
  })

  it('extracts merchants and paging from nested data payload', () => {
    const payload = {
      code: '100000',
      data: {
        PageTotal: 3,
        PageNow: '1',
        Data: [
          {
            mid: 123,
            merchant_name: 'demo',
            tracking_url: 'https://example.com/track',
            advert_status: 1,
          },
        ],
      },
    }

    const extracted = extractYeahPromosPayload(payload)

    expect(extracted.pageTotal).toBe(3)
    expect(extracted.pageNow).toBe(1)
    expect(extracted.merchants).toHaveLength(1)
    expect(extracted.merchants[0]?.mid).toBe(123)
  })

  it('extracts transactions and paging from nested data payload', () => {
    const payload = {
      code: 100000,
      data: {
        PageTotal: '2',
        pageNow: 1,
        Data: [
          {
            advert_id: '123',
            amount: '19.99',
            sale_comm: '2.5',
          },
        ],
      },
    }

    const extracted = extractYeahPromosTransactionsPayload(payload)

    expect(extracted.pageTotal).toBe(2)
    expect(extracted.pageNow).toBe(1)
    expect(extracted.transactions).toHaveLength(1)
    expect(extracted.transactions[0]?.advert_id).toBe('123')
  })

  it('parses merchant commission as amount when payout_unit is currency', () => {
    const parsed = parseYeahPromosMerchantCommission('60.00', '€')
    expect(parsed.mode).toBe('amount')
    expect(parsed.rate).toBeNull()
    expect(parsed.amount).toBe(60)
  })

  it('parses merchant commission as rate when payout_unit is percent', () => {
    const parsed = parseYeahPromosMerchantCommission('12.5', '%')
    expect(parsed.mode).toBe('rate')
    expect(parsed.rate).toBe(12.5)
    expect(parsed.amount).toBeNull()
  })

  it('treats value with percent symbol as rate', () => {
    const parsed = parseYeahPromosMerchantCommission('7.2%', 'USD')
    expect(parsed.mode).toBe('rate')
    expect(parsed.rate).toBe(7.2)
    expect(parsed.amount).toBeNull()
  })
})

describe('isYeahPromosRateLimited', () => {
  it('detects HTTP 429 and common YP rate-limit code', () => {
    expect(__testOnly.isYeahPromosRateLimited(null, '', 429)).toBe(true)
    expect(__testOnly.isYeahPromosRateLimited(429, '')).toBe(true)
  })

  it('detects message-based rate-limit signals', () => {
    expect(__testOnly.isYeahPromosRateLimited(null, 'Too many request')).toBe(true)
    expect(__testOnly.isYeahPromosRateLimited(null, 'rate limit exceeded')).toBe(true)
    expect(__testOnly.isYeahPromosRateLimited(null, 'Request too fast, please request later!')).toBe(true)
    expect(__testOnly.isYeahPromosRateLimited(null, '请求过于频繁，请稍后再试')).toBe(true)
  })

  it('returns false for normal cases', () => {
    expect(__testOnly.isYeahPromosRateLimited(100000, 'success')).toBe(false)
    expect(__testOnly.isYeahPromosRateLimited(100001, 'invalid token')).toBe(false)
  })
})

describe('isYeahPromosTransientError', () => {
  it('detects HTTP 5xx gateway errors', () => {
    const error = new Error('YeahPromos 商品拉取失败 (502): <html><title>502 Bad Gateway</title></html>')
    expect(__testOnly.isYeahPromosTransientError(error)).toBe(true)
  })

  it('detects non-json parse failures from upstream transient responses', () => {
    const error = new SyntaxError(`Unexpected token 'R', \"Request to\"... is not valid JSON`)
    expect(__testOnly.isYeahPromosTransientError(error)).toBe(true)
  })

  it('detects enriched non-json parse failures with response snippet', () => {
    const error = new SyntaxError(
      `YeahPromos 商品拉取失败 (200): Unexpected token 'R', \"Request to\"... is not valid JSON; response=Request too frequent`
    )
    expect(__testOnly.isYeahPromosTransientError(error)).toBe(true)
  })

  it('returns false for normal business errors', () => {
    const error = new Error('YeahPromos 商品拉取失败: 100001')
    expect(__testOnly.isYeahPromosTransientError(error)).toBe(false)
  })
})

describe('parseYeahPromosProductHtmlPage', () => {
  it('parses joined product card with pid link', () => {
    const html = `
      <div class="adv-block">
        <div class="adv-content">
          <div class="status-joined"><i>Access</i></div>
          <div class="adv-main">
            <div class="adv-name" title="Demo Product Name">Demo Product Name</div>
            <div><span>B012345678</span></div>
            <div class="row">
              <div class="col-xs-8"><div class="color-1136">USD 25.99</div></div>
              <div class="col-xs-4"><div>12.5%</div></div>
            </div>
            <div class="row"><div class="col-xs-12"><div class="rating-panel" data-rating="4.8">(12,345)</div></div></div>
            <div class="row" style="margin-top:5px;">
              <div class="col-xs-7"><a>Demo Brand</a></div>
              <div class="col-xs-5">
                <p class="button-primary adv-btn" onclick="ClipboardJS.copy('https://yeahpromos.com/index/index/openurlproduct?track=track_abc&amp;pid=998877');">Copy</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="pageList"><div class="page-num">Page 12</div><ul class="pager"><li><a href="/index/offer/products?page=13">&raquo;</a></li></ul></div>
    `

    const parsed = __testOnly.parseYeahPromosProductHtmlPage(html)
    expect(parsed.items).toHaveLength(1)
    expect(parsed.pageNow).toBe(12)
    expect(parsed.nextPage).toBe(13)

    const item = parsed.items[0]
    expect(item?.platform).toBe('yeahpromos')
    expect(item?.mid).toBe('pid_998877')
    expect(item?.asin).toBe('B012345678')
    expect(item?.brand).toBe('Demo Brand')
    expect(item?.productName).toBe('Demo Product Name')
    expect(item?.promoLink).toContain('pid=998877')
    expect(item?.commissionRate).toBe(12.5)
    expect(item?.priceAmount).toBe(25.99)
    expect(item?.reviewCount).toBe(12345)
    expect(item?.commissionRateMode).toBe('percent')
    expect(item?.isDeepLink).toBeNull()
    expect(item?.isConfirmedInvalid).toBe(false)
  })

  it('parses promo link from ClipboardJS.copy with double quotes', () => {
    const html = `
      <div class="adv-block">
        <div class="adv-content">
          <div class="adv-main">
            <div class="adv-name">Quoted Promo Product</div>
            <div><span>B0QUOTED12</span></div>
            <div class="row">
              <div class="col-xs-8"><div class="color-1136">USD 19.99</div></div>
              <div class="col-xs-4"><div>10%</div></div>
            </div>
            <div class="row"><div class="col-xs-12"><div class="rating-panel">(2,468)</div></div></div>
            <div class="row">
              <div class="col-xs-7"><a>Quote Brand</a></div>
              <div class="col-xs-5">
                <p class="button-primary adv-btn" onclick='ClipboardJS.copy("https://yeahpromos.com/index/index/openurlproduct?track=double_q&amp;pid=556677");'>Copy</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="pageList"><div class="page-num">Page 2</div></div>
    `

    const parsed = __testOnly.parseYeahPromosProductHtmlPage(html)
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]?.mid).toBe('pid_556677')
    expect(parsed.items[0]?.promoLink).toContain('track=double_q')
    expect(parsed.items[0]?.promoLink).toContain('pid=556677')
  })

  it('parses promo link from data-clipboard-text when onclick is missing', () => {
    const html = `
      <div class="adv-block">
        <div class="adv-content">
          <div class="adv-main">
            <div class="adv-name">Data Attr Promo Product</div>
            <div><span>B0DATATEXT1</span></div>
            <div class="row">
              <div class="col-xs-8"><div class="color-1136">USD 89.00</div></div>
              <div class="col-xs-4"><div>13.5%</div></div>
            </div>
            <div class="row"><div class="col-xs-12"><div class="rating-panel">(987)</div></div></div>
            <div class="row">
              <div class="col-xs-7"><a>Data Brand</a></div>
              <div class="col-xs-5">
                <p class="button-primary adv-btn" data-clipboard-text="/index/index/openurlproduct?track=data_attr&amp;pid=889900">Copy</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="pageList"><div class="page-num">Page 3</div></div>
    `

    const parsed = __testOnly.parseYeahPromosProductHtmlPage(html)
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]?.mid).toBe('pid_889900')
    expect(parsed.items[0]?.promoLink).toContain('https://yeahpromos.com/index/index/openurlproduct?')
    expect(parsed.items[0]?.promoLink).toContain('track=data_attr')
    expect(parsed.items[0]?.promoLink).toContain('pid=889900')
  })

  it('parses apply-only card without promo link', () => {
    const html = `
      <div class="adv-block">
        <div class="adv-content">
          <div class="adv-main">
            <div class="adv-name">Apply Product</div>
            <div><span>B0ABCDE123</span></div>
            <div class="row">
              <div class="col-xs-8"><div class="color-1136">USD 49.00</div></div>
              <div class="col-xs-4"><div>9%</div></div>
            </div>
            <div class="row"><div class="col-xs-12"><div class="rating-panel">(1,234)</div></div></div>
            <div class="row" style="margin-top:5px;">
              <div class="col-xs-7"><a>Apply Brand</a></div>
              <div class="col-xs-5"><p class="button-primary apply-product adv-btn" data-product_id="123456">Apply</p></div>
            </div>
          </div>
        </div>
      </div>
      <div id="pageList"><div class="page-num">Page 1</div><ul class="pager"><li class="disabled"><span>&raquo;</span></li></ul></div>
    `

    const parsed = __testOnly.parseYeahPromosProductHtmlPage(html)
    expect(parsed.items).toHaveLength(1)
    expect(parsed.nextPage).toBeNull()

    const item = parsed.items[0]
    expect(item?.mid).toBe('product_123456')
    expect(item?.promoLink).toBeNull()
    expect(item?.asin).toBe('B0ABCDE123')
    expect(item?.commissionRateMode).toBe('percent')
    expect(item?.isConfirmedInvalid).toBe(false)
  })
})

describe('yeahpromos template and proxy helpers', () => {
  it('only mutates page parameter when building paged url', () => {
    const templateUrl = 'https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.fr&sort=5&min_price=0&max_price=501&page=2'
    const page10 = __testOnly.buildYeahPromosProductsPageUrl(templateUrl, 10)
    const parsed = new URL(page10)

    expect(parsed.searchParams.get('page')).toBe('10')
    expect(parsed.searchParams.get('site_id')).toBe('11767')
    expect(parsed.searchParams.get('market_place')).toBe('amazon.fr')
    expect(parsed.searchParams.get('sort')).toBe('5')
  })

  it('maps marketplace templates and resolves strict country proxies with UK/GB alias', () => {
    const templates = __testOnly.resolveYeahPromosMarketplaceTemplates(
      JSON.stringify([
        {
          marketplace: 'amazon.co.uk',
          country: 'GB',
          url: 'https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.co.uk&sort=5&min_price=0&max_price=501&page=2',
        },
      ])
    )
    expect(templates).toHaveLength(1)
    expect(templates[0]?.scope).toBe('amazon.co.uk')

    const proxyMap = __testOnly.parseYeahPromosProxyCountryUrlMap(
      JSON.stringify([
        { country: 'UK', url: 'https://proxy.example/uk' },
        { country: 'US', url: 'https://proxy.example/us' },
      ])
    )
    expect(__testOnly.resolveYeahPromosProxyProviderUrl(proxyMap, 'GB')).toBe('https://proxy.example/uk')
    expect(__testOnly.resolveYeahPromosProxyProviderUrl(proxyMap, 'FR')).toBeNull()
  })

  it('detects html intercept signals for fallback decisions', () => {
    expect(__testOnly.detectYeahPromosHttpIntercept({
      status: 403,
      html: '<html>forbidden</html>',
    }).blocked).toBe(true)

    expect(__testOnly.detectYeahPromosHttpIntercept({
      status: 200,
      html: '<html><body>Request too fast, please request later!</body></html>',
    }).blocked).toBe(true)

    expect(__testOnly.detectYeahPromosHttpIntercept({
      status: 200,
      html: '<div class=\"adv-content\"></div><div id=\"pageList\"></div>',
    }).blocked).toBe(false)
  })
})
