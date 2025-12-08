/**
 * Stealth Scraper Module - Unified Exports
 *
 * This module provides stealth browser-based scraping capabilities for:
 * - Amazon product pages
 * - Amazon store pages
 * - Independent e-commerce stores (Shopify, WooCommerce, etc.)
 *
 * All scrapers use:
 * - Playwright connection pooling for performance
 * - Browser fingerprint spoofing for anti-bot bypass
 * - Proxy rotation with automatic retry on failure
 * - Smart wait strategies for optimal page loading
 */

// Types
export type {
  ProxyCredentials,
  StealthBrowserResult,
  ScrapeUrlResult,
  AffiliateLinkResult,
  AmazonProductData,
  AmazonStoreData,
  IndependentStoreData,
} from './types'

// Proxy utilities
export {
  isProxyConnectionError,
  withProxyRetry,
  retryWithBackoff,
} from './proxy-utils'

// Browser stealth utilities
export {
  createStealthBrowser,
  releaseBrowser,
  configureStealthPage,
  getRandomUserAgent,
  randomDelay,
  getDynamicTimeout,
} from './browser-stealth'

// Core scraping functions
export {
  scrapeUrlWithBrowser,
  resolveAffiliateLink,
} from './core'

// Amazon product scraping
export {
  scrapeAmazonProduct,
} from './amazon-product'

// Amazon store scraping
export {
  scrapeAmazonStore,
  scrapeAmazonStoreDeep,
} from './amazon-store'

// Independent store scraping
export {
  scrapeIndependentStore,
} from './independent-store'
