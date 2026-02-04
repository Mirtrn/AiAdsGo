# Google Ads Account Disabled Error Messaging Design

## Goal
Provide a clearer, user-friendly error message in the publish results (and other Google Ads flows) when the Ads API indicates the customer account is not enabled or has been deactivated.

## Scope
- Map the Google Ads API error message "The customer account can't be accessed because it is not yet enabled or has been deactivated." (and closely related signals such as CUSTOMER_NOT_ENABLED) to a single user-facing message.
- Apply the mapping at the shared formatter layer so both synchronous API responses and async queue failures use the same copy.
- Keep policy violation messaging intact and higher priority than this mapping.

## Proposed Message (B)
"账号状态异常（未启用/已停用），请联系管理员或在 Google Ads 中恢复后重试。"

## Architecture
- Update `src/lib/google-ads-api-error.ts` in `formatGoogleAdsApiError`.
- Add a detection helper that scans error messages and error_code values for account-not-enabled signals.
- Place the new branch after policy violations/policy findings and before generic message aggregation so policy-specific output is preserved.
- Preserve RequestId suffix when available.

## Data Flow
- Publish flow: `/api/campaigns/publish` -> `queryActiveCampaigns` -> `listGoogleAdsCampaigns` -> Google Ads API error.
- Queue flow: `campaign-publish-executor` -> `formatGoogleAdsApiError` -> `creation_error` -> front-end poll.
- Both routes converge on `formatGoogleAdsApiError`, so a single mapping covers the publish results UI and any other Ads-dependent features.

## Error Handling
- Only match explicit signals: "not yet enabled", "deactivated", and error_code values containing `CUSTOMER_NOT_ENABLED`.
- Do not change policy violation formatting or other error strings.
- If matched, return the friendly message + RequestId.

## Testing
- Add a unit test in `src/lib/__tests__/google-ads-api-error.test.ts` with the real error message and expect the friendly output plus RequestId.
- Confirm policy-violation tests remain unchanged (regression safety).
