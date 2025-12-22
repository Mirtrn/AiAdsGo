# 关键词转化跟踪方案

## 当前问题

系统缺少关键词级别的转化数据，无法实现"基于转化数据持续优化关键词"。

## 解决方案

### 1. 关键词级别性能数据获取

通过Google Ads API查询关键词级别的性能数据：

```sql
SELECT
  campaign.id,
  ad_group.id,
  ad_group_ad.id,
  keyword_ad_group_ad.criterion_id,  -- 关键词ID
  keyword.text,                      -- 关键词文本
  metrics.clicks,
  metrics.impressions,
  metrics.ctr,
  metrics.cost_micros,
  metrics.average_cpc,
  metrics.conversions,               -- 关键词级别转化数
  metrics.conversions_value,         -- 关键词级别转化价值
FROM ad_group_ad
JOIN keyword_ad_group_ad ON ad_group_ad.ad_group_ad = keyword_ad_group_ad.ad_group_ad
JOIN keyword ON keyword_ad_group_ad.criterion = keyword.resource_name
WHERE
  campaign.id = 'xxx'
  AND segments.date DURING LAST_30_DAYS
  AND ad_group_ad.status = 'ENABLED'
```

### 2. 关键词性能数据表设计

```sql
CREATE TABLE keyword_performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  google_ads_account_id INTEGER NOT NULL,
  campaign_id TEXT NOT NULL,
  ad_group_id TEXT NOT NULL,
  keyword_id TEXT NOT NULL,
  keyword_text TEXT NOT NULL,
  date TEXT NOT NULL,               -- YYYY-MM-DD
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions REAL DEFAULT 0,
  cost REAL DEFAULT 0,
  ctr REAL DEFAULT 0,
  cpc REAL DEFAULT 0,
  conversion_rate REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_keyword_performance_user_date ON keyword_performance(user_id, date);
CREATE INDEX idx_keyword_performance_keyword_text ON keyword_performance(keyword_text);
```

### 3. 关键词性能同步服务

```typescript
// keyword-performance-sync.ts
export class KeywordPerformanceSyncService {
  async syncKeywordPerformance(
    campaignId: string,
    userId: string,
    customerId: string,
    refreshToken: string
  ): Promise<KeywordPerformanceResult[]> {
    // 1. 从Google Ads API获取关键词级别数据
    const keywordData = await this.fetchKeywordPerformanceData(
      campaignId, customerId, refreshToken
    )

    // 2. 存储到数据库
    const savedData = await this.saveKeywordPerformanceData(
      userId, keywordData
    )

    // 3. 返回用于优化的数据
    return savedData
  }

  private async fetchKeywordPerformanceData(
    campaignId: string,
    customerId: string,
    refreshToken: string
  ): Promise<KeywordPerformanceData[]> {
    // Google Ads API查询逻辑
    const query = `
      SELECT
        keyword.text,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.cost_micros,
        metrics.average_cpc,
        metrics.conversions,
        metrics.conversions_value
      FROM keyword
      WHERE keyword.status = 'ENABLED'
        AND campaign.id = '${campaignId}'
        AND segments.date DURING LAST_30_DAYS
    `

    const results = await customer.query(query)
    return results.map(row => ({
      keyword: row.keyword.text,
      impressions: row.metrics.impressions || 0,
      clicks: row.metrics.clicks || 0,
      conversions: row.metrics.conversions || 0,
      cost: (row.metrics.cost_micros || 0) / 1000000,
      ctr: row.metrics.ctr || 0,
      cpc: row.metrics.average_cpc || 0,
      conversionRate: row.metrics.conversions && row.metrics.clicks ?
        (row.metrics.conversions / row.metrics.clicks) * 100 : 0
    }))
  }
}
```

### 4. 基于关键词转化的优化

```typescript
// keyword-conversion-optimizer.ts
export class KeywordConversionOptimizer {
  async optimizeKeywordsBasedOnConversions(
    keywords: UnifiedKeywordData[],
    userId: string
  ): Promise<OptimizedKeywords> {
    // 1. 获取关键词转化数据
    const conversionData = await this.getKeywordConversionData(keywords, userId)

    // 2. 计算转化导向的关键词分数
    const optimizedKeywords = keywords.map(kw => {
      const convData = conversionData.get(kw.keyword.toLowerCase())

      let conversionScore = 0
      if (convData && convData.conversions > 0) {
        // 基于转化数据计算分数
        conversionScore = this.calculateConversionScore(convData)
      } else {
        // 无转化数据，使用预估分数
        conversionScore = this.estimateConversionScore(kw)
      }

      return {
        ...kw,
        conversionScore,
        actualConversions: convData?.conversions || 0,
        conversionRate: convData?.conversionRate || 0
      }
    })

    // 3. 按转化分数排序
    optimizedKeywords.sort((a, b) => b.conversionScore - a.conversionScore)

    return {
      optimizedKeywords,
      conversionInsights: this.generateConversionInsights(optimizedKeywords)
    }
  }

  private calculateConversionScore(convData: KeywordConversionData): number {
    let score = 0

    // 转化数量权重 (40%)
    const conversionsWeight = Math.min(convData.conversions * 10, 40)

    // 转化率权重 (35%)
    const conversionRateWeight = Math.min(convData.conversionRate * 2, 35)

    // 转化价值权重 (25%)
    const conversionValueWeight = Math.min(convData.conversionValue / 10, 25)

    score = conversionsWeight + conversionRateWeight + conversionValueWeight

    return Math.min(score, 100)  // 最高100分
  }
}
```

### 5. 实施步骤

#### P0阶段（1-2周）：
1. 创建关键词性能数据表
2. 实现关键词级别数据同步
3. 基础转化数据查询

#### P1阶段（2-3周）：
1. 关键词转化分数计算
2. 基于转化的关键词排序
3. 转化数据可视化

#### P2阶段（3-4周）：
1. 动态转化优化算法
2. A/B测试验证
3. 持续学习机制

## 预期效果

- ✅ **获得关键词级别转化数据**：每个关键词的转化表现
- ✅ **实现转化导向优化**：基于真实转化数据优化关键词
- ✅ **提升关键词质量**：高转化关键词优先
- ✅ **持续改进**：转化数据反馈优化算法

## 注意事项

1. **数据隐私**：确保转化数据安全存储
2. **API限制**：注意Google Ads API的查询限制
3. **数据时效性**：定期更新转化数据
4. **合规性**：确保转化跟踪符合隐私法规
