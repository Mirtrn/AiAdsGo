# Bug Fix: CPC Bid Micros Conversion Error

**Date**: 2026-03-07
**Issue**: Campaign creation failing with "Value must be a multiple of billable unit" error
**Error Code**: `currency_error: 2`

## Root Cause

The CPC bid conversion from dollars to micros was using:
```typescript
const cpcMicros = Math.round(cpcBid * 1000000)
```

This caused floating-point precision issues. For example:
- Input: `4.099999` USD
- Old calculation: `Math.round(4.099999 * 1000000)` = `4099999` micros ❌
- Google Ads requirement: Must be multiple of 10,000 micros ($0.01)

## Solution

Changed to a two-step conversion that ensures proper rounding:
```typescript
const cpcMicros = Math.round(cpcBid * 100) * 10000
```

This approach:
1. First rounds to cents: `Math.round(4.099999 * 100)` = `410`
2. Then converts to micros: `410 * 10000` = `4100000` micros ✅

## Files Modified

1. **src/lib/queue/executors/campaign-publish-executor.ts** (Line 493)
   - Campaign creation CPC bid ceiling
   - Ad Group CPC bid

2. **src/app/api/campaigns/[id]/update-cpc/route.ts** (Lines 542, 576, 621, 669)
   - Manual CPC updates
   - TARGET_SPEND strategy updates
   - MAXIMIZE_CLICKS strategy updates
   - TARGET_CPA strategy updates

3. **src/app/(app)/offers/[id]/launch/steps/Step3CampaignConfig.tsx** (Line 742)
   - Frontend validation

## Test Results

| Input USD | Old Micros | Valid? | New Micros | Valid? |
|-----------|------------|--------|------------|--------|
| 4.099999  | 4,099,999  | ❌     | 4,100,000  | ✅     |
| 1.234567  | 1,234,567  | ❌     | 1,230,000  | ✅     |
| 4.10      | 4,100,000  | ✅     | 4,100,000  | ✅     |
| 0.01      | 10,000     | ✅     | 10,000     | ✅     |

## Impact

- Fixes campaign creation failures
- Fixes CPC update failures
- Ensures all monetary values comply with Google Ads billing unit requirements
- Prevents future `currency_error: 2` errors

## Related Issues

This fix also addresses the same issue in:
- CPA (Cost Per Acquisition) conversions
- All bidding strategy updates
