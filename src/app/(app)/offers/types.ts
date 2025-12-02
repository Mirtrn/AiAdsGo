/**
 * Offer列表页相关类型定义
 */

export interface OfferListItem {
  id: number
  url: string
  brand: string
  category: string | null
  targetCountry: string
  affiliateLink: string | null
  brandDescription: string | null
  scrape_status: string
  isActive: boolean
  createdAt: string
  offerName: string | null
  targetLanguage: string | null
  productPrice?: string | null
  commissionPayout?: string | null
  // P1-11: 关联的Google Ads账号信息（只显示非MCC账号）
  linkedAccounts?: Array<{
    account_id: number
    customer_id: string
  }>
}

export type SortField = 'brand' | 'targetCountry' | 'scrape_status' | 'createdAt' | ''
export type SortOrder = 'asc' | 'desc'

export interface OfferFilters {
  searchQuery: string
  countryFilter: string
  statusFilter: string
  sortBy: SortField
  sortOrder: SortOrder
}

export interface UnlinkTarget {
  offer: OfferListItem
  accountId: number
  accountName: string
}
