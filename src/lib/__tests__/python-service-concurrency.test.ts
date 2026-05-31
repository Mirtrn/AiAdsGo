import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('python Google Ads service concurrency', () => {
  it('keeps blocking Google Ads endpoints as sync handlers so FastAPI runs them in a threadpool', () => {
    const source = readFileSync(join(process.cwd(), 'python-service', 'main.py'), 'utf8')
    const blockingHandlers = [
      'get_keyword_historical_metrics',
      'get_keyword_ideas',
      'list_accessible_customers',
      'execute_gaql_query',
      'get_identity_verification',
      'create_campaign_budget',
      'create_campaign',
      'create_ad_group',
      'create_keywords',
      'create_responsive_search_ad',
      'update_campaign_status',
      'remove_campaign',
      'update_campaign',
      'update_ad_group',
      'update_campaign_budget',
      'update_campaign_final_url_suffix',
      'create_callout_extensions',
      'create_sitelink_extensions',
      'ensure_conversion_goal',
    ]

    for (const handler of blockingHandlers) {
      expect(source).toMatch(new RegExp(`\\ndef ${handler}\\(`))
      expect(source).not.toMatch(new RegExp(`\\nasync def ${handler}\\(`))
    }
  })
})
