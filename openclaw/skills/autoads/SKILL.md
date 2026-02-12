---
name: autoads
description: Call AutoAds APIs via the OpenClaw proxy (user-scoped).
metadata: { "openclaw": { "emoji": "🧭" } }
---

# AutoAds (OpenClaw Proxy)

Use the AutoAds OpenClaw proxy to call every AutoAds API **as a specific user**.

## Authentication

AutoAds requires a user-scoped OpenClaw token. Generate it in the AutoAds UI:

1. Open `OpenClaw -> 配置中心 -> OpenClaw Access Tokens`
2. Click **生成新Token**

Then call the proxy with `Authorization: Bearer <token>`.

## Proxy endpoint

```
POST /api/openclaw/proxy
```

Body:

```json
{
  "method": "POST",
  "path": "/api/offers",
  "query": {},
  "body": {
    "url": "https://example.com/product",
    "brand": "Example",
    "target_country": "US"
  }
}
```

Notes:
- `path` must start with `/api/`
- Admin/cron/test endpoints are blocked

## Full API list

See `docs/openclaw-integration/AutoAds_API.md` for the complete AutoAds API routes and parameters.

## Example: create Offer

```bash
curl -sS http://<autoads-host>/api/openclaw/proxy \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "POST",
    "path": "/api/offers",
    "body": {
      "url": "https://example.com/product",
      "brand": "Example",
      "target_country": "US"
    }
  }'
```

## Example: generate creatives

```bash
curl -sS http://<autoads-host>/api/openclaw/proxy \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "POST",
    "path": "/api/offers/123/generate-creatives-queue",
    "body": { "targetRating": "EXCELLENT" }
  }'
```

## Example: publish campaign

```bash
curl -sS http://<autoads-host>/api/openclaw/proxy \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "POST",
    "path": "/api/campaigns/publish",
    "body": {
      "offerId": 123,
      "adCreativeId": 456,
      "googleAdsAccountId": 789,
      "campaignConfig": {
        "campaignName": "Brand_US_Search",
        "adGroupName": "Brand_Group_1",
        "budgetAmount": 50,
        "budgetType": "DAILY",
        "targetCountry": "US",
        "targetLanguage": "en",
        "biddingStrategy": "MAXIMIZE_CONVERSIONS",
        "finalUrlSuffix": "",
        "maxCpcBid": 1.2,
        "keywords": ["keyword1", "keyword2"],
        "negativeKeywords": ["free"]
      },
      "pauseOldCampaigns": true,
      "enableCampaignImmediately": false,
      "enableSmartOptimization": false
    }
  }'
```
