import {
  generateCampaignName,
  generateAdGroupName,
  generateAdName,
  parseCampaignName,
  validateCampaignName,
  generateSmartOptimizationCampaignName,
  generateNamingScheme,
  NAMING_CONFIG
} from '../naming-convention'

describe('Google Ads Naming Convention', () => {
  describe('generateCampaignName', () => {
    it('should generate standard campaign name with all parameters', () => {
      const name = generateCampaignName({
        brand: 'Eufy',
        country: 'IT',
        category: 'Electronics',
        budgetAmount: 50,
        budgetType: 'DAILY',
        biddingStrategy: 'TARGET_CPA',
        offerId: 215,
        date: new Date('2025-11-27T00:00:00')
      })

      // 验证名称格式: Brand_Country_Category_BudgetType_Strategy_DateTime_OfferId
      expect(name).toMatch(/^Eufy_IT_Electronics_50D_TCPA_20251127\d{6}_O215$/)
    })

    it('should handle missing category', () => {
      const name = generateCampaignName({
        brand: 'Eufy',
        country: 'IT',
        budgetAmount: 100,
        budgetType: 'TOTAL',
        biddingStrategy: 'MAXIMIZE_CONVERSIONS',
        offerId: 216
      })

      expect(name).toContain('_General_')
      expect(name).toContain('100T')
      expect(name).toContain('MAXCONV')
      expect(name).toContain('O216')
    })

    it('should sanitize special characters in brand name', () => {
      const name = generateCampaignName({
        brand: 'Brand-Name & Co.',
        country: 'US',
        budgetAmount: 25,
        budgetType: 'DAILY',
        biddingStrategy: 'MANUAL_CPC',
        offerId: 100
      })

      expect(name).toMatch(/^BrandName/)
      expect(name).not.toContain('&')
      expect(name).not.toContain('.')
    })

    it('should truncate long names to max length', () => {
      const name = generateCampaignName({
        brand: 'VeryLongBrandNameThatExceedsNormalLength',
        country: 'IT',
        category: 'ElectronicsAndGadgets',
        budgetAmount: 999,
        budgetType: 'DAILY',
        biddingStrategy: 'TARGET_ROAS',
        offerId: 12345
      })

      expect(name.length).toBeLessThanOrEqual(NAMING_CONFIG.MAX_LENGTH.CAMPAIGN)
    })

    it('should handle unknown bidding strategy', () => {
      const name = generateCampaignName({
        brand: 'Test',
        country: 'US',
        budgetAmount: 10,
        budgetType: 'DAILY',
        biddingStrategy: 'CUSTOM_STRATEGY_XYZ',
        offerId: 1
      })

      expect(name).toContain('CUSTOM')
    })
  })

  describe('generateAdGroupName', () => {
    it('should generate standard ad group name', () => {
      const name = generateAdGroupName({
        brand: 'Eufy',
        country: 'IT',
        theme: 'Cleaning',
        maxCpcBid: 2.5
      })

      expect(name).toBe('Eufy_IT_Cleaning_2.5CPC')
    })

    it('should handle missing theme and CPC', () => {
      const name = generateAdGroupName({
        brand: 'Eufy',
        country: 'IT'
      })

      expect(name).toBe('Eufy_IT_Default')
    })

    it('should include ad group ID if provided', () => {
      const name = generateAdGroupName({
        brand: 'Eufy',
        country: 'IT',
        theme: 'Security',
        maxCpcBid: 1.8,
        adGroupId: '12345'
      })

      expect(name).toBe('Eufy_IT_Security_1.8CPC_AG12345')
    })
  })

  describe('generateAdName', () => {
    it('should generate standard ad name', () => {
      const name = generateAdName({
        theme: 'Cleaning',
        creativeId: 121
      })

      expect(name).toBe('RSA_Cleaning_C121')
    })

    it('should include variant index for smart optimization', () => {
      const name = generateAdName({
        theme: 'Security',
        creativeId: 122,
        variantIndex: 2
      })

      expect(name).toBe('RSA_Security_C122_V2')
    })

    it('should truncate long themes', () => {
      const name = generateAdName({
        theme: 'VeryLongThemeNameThatNeedsToBeShortened',
        creativeId: 123
      })

      expect(name).toContain('RSA_')
      expect(name).toContain('C123')
      expect(name.length).toBeLessThanOrEqual(NAMING_CONFIG.MAX_LENGTH.AD)
    })
  })

  describe('parseCampaignName', () => {
    it('should parse valid campaign name correctly', () => {
      const parsed = parseCampaignName('Eufy_IT_Electronics_50D_TCPA_20251127_O215')

      expect(parsed).toEqual({
        brand: 'Eufy',
        country: 'IT',
        category: 'Electronics',
        budget: 50,
        budgetType: 'DAILY',
        strategy: 'TCPA',
        date: '20251127',
        offerId: 215
      })
    })

    it('should parse campaign with TOTAL budget', () => {
      const parsed = parseCampaignName('Brand_US_General_100T_MAXCONV_20251127_O100')

      expect(parsed?.budgetType).toBe('TOTAL')
      expect(parsed?.budget).toBe(100)
    })

    it('should return null for invalid format', () => {
      const parsed = parseCampaignName('Invalid Campaign Name')
      expect(parsed).toBeNull()
    })

    it('should return null for incomplete parts', () => {
      const parsed = parseCampaignName('Brand_IT_Category')
      expect(parsed).toBeNull()
    })
  })

  describe('validateCampaignName', () => {
    it('should validate correct campaign name', () => {
      expect(validateCampaignName('Eufy_IT_Electronics_50D_TCPA_20251127_O215')).toBe(true)
    })

    it('should reject invalid campaign name', () => {
      expect(validateCampaignName('Random Name')).toBe(false)
      expect(validateCampaignName('Brand_IT')).toBe(false)
    })
  })

  describe('generateSmartOptimizationCampaignName', () => {
    it('should add variant suffix', () => {
      const name = generateSmartOptimizationCampaignName(
        {
          brand: 'Eufy',
          country: 'IT',
          category: 'Electronics',
          budgetAmount: 50,
          budgetType: 'DAILY',
          biddingStrategy: 'TARGET_CPA',
          offerId: 215
        },
        2,
        3
      )

      expect(name).toContain('_V2of3')
      expect(name).toContain('Eufy_IT')
    })

    it('should respect max length with variant suffix', () => {
      const name = generateSmartOptimizationCampaignName(
        {
          brand: 'VeryLongBrandNameThatExceedsNormalLength',
          country: 'IT',
          category: 'ElectronicsAndGadgets',
          budgetAmount: 999,
          budgetType: 'DAILY',
          biddingStrategy: 'TARGET_ROAS',
          offerId: 12345
        },
        5,
        5
      )

      expect(name.length).toBeLessThanOrEqual(NAMING_CONFIG.MAX_LENGTH.CAMPAIGN)
      expect(name).toContain('_V5of5')
    })
  })

  describe('generateNamingScheme', () => {
    it('should generate complete naming scheme for single creative', () => {
      const scheme = generateNamingScheme({
        offer: {
          id: 215,
          brand: 'Eufy',
          category: 'Electronics'
        },
        config: {
          targetCountry: 'IT',
          budgetAmount: 50,
          budgetType: 'DAILY',
          biddingStrategy: 'TARGET_CPA',
          maxCpcBid: 2.5
        },
        creative: {
          id: 121,
          theme: 'Cleaning'
        }
      })

      expect(scheme.campaignName).toContain('Eufy_IT_Electronics')
      expect(scheme.adGroupName).toContain('Eufy_IT_Cleaning_2.5CPC')
      expect(scheme.adName).toBe('RSA_Cleaning_C121')
    })

    it('should generate smart optimization naming scheme', () => {
      const scheme = generateNamingScheme({
        offer: {
          id: 216,
          brand: 'Eufy',
          category: 'Security'
        },
        config: {
          targetCountry: 'IT',
          budgetAmount: 100,
          budgetType: 'TOTAL',
          biddingStrategy: 'MAXIMIZE_CONVERSIONS',
          maxCpcBid: 1.8
        },
        creative: {
          id: 122,
          theme: 'Safety'
        },
        smartOptimization: {
          enabled: true,
          variantIndex: 1,
          totalVariants: 3
        }
      })

      expect(scheme.campaignName).toContain('_V1of3')
      expect(scheme.adGroupName).toContain('Eufy_IT_Safety')
      expect(scheme.adName).toContain('RSA_Safety_C122_V1')
    })

    it('should handle missing creative', () => {
      const scheme = generateNamingScheme({
        offer: {
          id: 215,
          brand: 'Eufy'
        },
        config: {
          targetCountry: 'IT',
          budgetAmount: 50,
          budgetType: 'DAILY',
          biddingStrategy: 'MANUAL_CPC'
        }
      })

      expect(scheme.campaignName).toBeDefined()
      expect(scheme.adGroupName).toBeDefined()
      expect(scheme.adName).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle zero budget', () => {
      const name = generateCampaignName({
        brand: 'Test',
        country: 'US',
        budgetAmount: 0,
        budgetType: 'DAILY',
        biddingStrategy: 'MANUAL_CPC',
        offerId: 1
      })

      expect(name).toContain('0D')
    })

    it('should handle decimal budget amounts', () => {
      const name = generateCampaignName({
        brand: 'Test',
        country: 'US',
        budgetAmount: 25.99,
        budgetType: 'DAILY',
        biddingStrategy: 'MANUAL_CPC',
        offerId: 1
      })

      expect(name).toContain('26D') // Should round
    })

    it('should handle lowercase country codes', () => {
      const name = generateCampaignName({
        brand: 'Test',
        country: 'us',
        budgetAmount: 10,
        budgetType: 'DAILY',
        biddingStrategy: 'MANUAL_CPC',
        offerId: 1
      })

      expect(name).toContain('_US_')
    })
  })
})
