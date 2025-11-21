#!/usr/bin/env tsx
/**
 * Google Ads API Configuration Verification Script
 *
 * Usage:
 *   npm run verify:google-ads
 *   OR
 *   npx tsx scripts/verify-google-ads-config.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message: string) {
  log(`✅ ${message}`, 'green');
}

function error(message: string) {
  log(`❌ ${message}`, 'red');
}

function warning(message: string) {
  log(`⚠️  ${message}`, 'yellow');
}

function info(message: string) {
  log(`ℹ️  ${message}`, 'cyan');
}

interface ConfigCheck {
  name: string;
  value: string | undefined;
  required: boolean;
  validate?: (value: string) => boolean | string;
}

const configChecks: ConfigCheck[] = [
  {
    name: 'GOOGLE_ADS_CLIENT_ID',
    value: process.env.GOOGLE_ADS_CLIENT_ID,
    required: true,
    validate: (value) => {
      if (!value.includes('.apps.googleusercontent.com')) {
        return 'Client ID should end with .apps.googleusercontent.com';
      }
      return true;
    },
  },
  {
    name: 'GOOGLE_ADS_CLIENT_SECRET',
    value: process.env.GOOGLE_ADS_CLIENT_SECRET,
    required: true,
    validate: (value) => {
      if (!value.startsWith('GOCSPX-')) {
        return 'Client Secret should start with GOCSPX-';
      }
      return true;
    },
  },
  {
    name: 'GOOGLE_ADS_DEVELOPER_TOKEN',
    value: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    required: true,
    validate: (value) => {
      if (value.length < 10) {
        return 'Developer Token format is invalid';
      }
      return true;
    },
  },
  {
    name: 'GOOGLE_ADS_REFRESH_TOKEN',
    value: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    required: true,
    validate: (value) => {
      if (value.length < 20) {
        return 'Refresh Token format is invalid';
      }
      return true;
    },
  },
  {
    name: 'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
    value: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    required: false,
    validate: (value) => {
      if (!/^\d{10}$/.test(value)) {
        return 'Login Customer ID should be 10 digits without hyphens';
      }
      return true;
    },
  },
  {
    name: 'GOOGLE_ADS_CUSTOMER_IDS',
    value: process.env.GOOGLE_ADS_CUSTOMER_IDS,
    required: false,
    validate: (value) => {
      const ids = value.split(',').map(id => id.trim());
      for (const id of ids) {
        if (!/^\d{10}$/.test(id)) {
          return `Customer ID "${id}" should be 10 digits without hyphens`;
        }
      }
      return true;
    },
  },
  {
    name: 'GOOGLE_ADS_API_VERSION',
    value: process.env.GOOGLE_ADS_API_VERSION || 'v16',
    required: false,
    validate: (value) => {
      if (!/^v\d{1,2}$/.test(value)) {
        return 'API version should be in format vXX (e.g., v16)';
      }
      return true;
    },
  },
];

async function testAccessToken(): Promise<boolean> {
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    warning('Cannot test Access Token: Missing required configuration');
    return false;
  }

  try {
    info('Testing Access Token refresh...');

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      error(`Failed to refresh Access Token: ${errorText}`);
      return false;
    }

    const data = await response.json();

    if (data.access_token) {
      success('Successfully refreshed Access Token');
      info(`Access Token: ${data.access_token.substring(0, 20)}...`);
      info(`Expires in: ${data.expires_in} seconds`);
      return true;
    } else {
      error('No Access Token in response');
      return false;
    }
  } catch (err) {
    error(`Error testing Access Token: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function testGoogleAdsAPI(): Promise<boolean> {
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  if (!refreshToken || !clientId || !clientSecret || !developerToken) {
    warning('Cannot test Google Ads API: Missing required configuration');
    return false;
  }

  try {
    info('Testing Google Ads API connection...');

    // Get access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenResponse.ok) {
      error('Failed to get Access Token');
      return false;
    }

    const tokenData = await tokenResponse.json();

    // Call Google Ads API - list accessible customers
    const apiResponse = await fetch(
      'https://googleads.googleapis.com/v16/customers:listAccessibleCustomers',
      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'developer-token': developerToken,
        },
      }
    );

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      error(`Google Ads API call failed: ${errorText}`);
      return false;
    }

    const apiData = await apiResponse.json();

    if (apiData.resourceNames && apiData.resourceNames.length > 0) {
      success('Successfully connected to Google Ads API');
      info(`Accessible accounts: ${apiData.resourceNames.length}`);

      const customerIds = apiData.resourceNames.map((name: string) => {
        const match = name.match(/customers\/(\d+)/);
        return match ? match[1] : null;
      }).filter(Boolean);

      info('Customer IDs:');
      customerIds.forEach((id: string) => {
        console.log(`  - ${id}`);
      });

      return true;
    } else {
      warning('API call successful but no accessible accounts found');
      return false;
    }
  } catch (err) {
    error(`Error testing Google Ads API: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function main() {
  log('\n' + '='.repeat(60), 'bright');
  log('Google Ads API Configuration Verification', 'bright');
  log('='.repeat(60) + '\n', 'bright');

  let hasErrors = false;
  let hasWarnings = false;

  // 1. Check configuration items
  log('📋 Checking configuration items:', 'blue');
  console.log();

  for (const check of configChecks) {
    const { name, value, required, validate } = check;

    if (!value || value.trim() === '') {
      if (required) {
        error(`${name}: Required configuration is missing`);
        hasErrors = true;
      } else {
        warning(`${name}: Optional configuration is missing`);
        hasWarnings = true;
      }
      continue;
    }

    // Validate format
    if (validate) {
      const result = validate(value);
      if (result === true) {
        success(`${name}: ${value.substring(0, 30)}${value.length > 30 ? '...' : ''}`);
      } else {
        error(`${name}: ${result}`);
        hasErrors = true;
      }
    } else {
      success(`${name}: ${value.substring(0, 30)}${value.length > 30 ? '...' : ''}`);
    }
  }

  console.log();

  // 2. Test Access Token
  log('🔑 Testing OAuth Token:', 'blue');
  console.log();

  const tokenTestPassed = await testAccessToken();
  console.log();

  // 3. Test Google Ads API connection
  log('🌐 Testing Google Ads API:', 'blue');
  console.log();

  const apiTestPassed = await testGoogleAdsAPI();
  console.log();

  // Summary
  log('='.repeat(60), 'bright');
  log('Verification Results Summary', 'bright');
  log('='.repeat(60), 'bright');

  if (hasErrors) {
    error('Configuration check failed: Missing required configuration');
  } else {
    success('Configuration check passed');
  }

  if (hasWarnings) {
    warning('Some optional configuration items are missing');
  }

  if (tokenTestPassed) {
    success('OAuth Token test passed');
  } else {
    warning('OAuth Token test failed');
  }

  if (apiTestPassed) {
    success('Google Ads API connection test passed');
  } else {
    warning('Google Ads API connection test failed');
  }

  console.log();

  if (hasErrors || !tokenTestPassed || !apiTestPassed) {
    log('⚠️ Troubleshooting Steps:', 'yellow');
    console.log();

    if (hasErrors) {
      console.log('  1. Check .env file and ensure all required configuration items are filled correctly');
    }

    if (!process.env.GOOGLE_ADS_REFRESH_TOKEN) {
      console.log('  2. Get Refresh Token through OAuth flow:');
      console.log('     Visit: http://localhost:3000/api/google-ads/oauth/start');
    }

    if (!tokenTestPassed) {
      console.log('  3. Check if OAuth configuration (Client ID, Client Secret, Refresh Token) is correct');
    }

    if (!apiTestPassed) {
      console.log('  4. Check if Developer Token is active');
      console.log('  5. Ensure Google Ads account has API access permissions');
    }

    console.log();
    process.exit(1);
  } else {
    log('✨ All checks passed! Google Ads API configuration is complete and valid.', 'green');
    console.log();
    process.exit(0);
  }
}

// Run verification
main().catch((err) => {
  error(`Verification script failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error(err);
  process.exit(1);
});
