-- 072: 添加综合创意桶类型 'S' (Synthetic)
-- 用于第4个综合广告创意，包含所有品牌词+高搜索量非品牌词
--
-- SQLite不支持ALTER TABLE修改CHECK约束，需要重建表
-- 步骤：1.创建新表 2.复制数据 3.删除旧表 4.重命名新表 5.重建索引

-- 1. 创建新表（包含更新后的CHECK约束）
CREATE TABLE ad_creatives_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  headlines TEXT NOT NULL,
  descriptions TEXT NOT NULL,
  keywords TEXT NOT NULL,
  keywords_with_volume TEXT,
  negative_keywords TEXT,
  callouts TEXT,
  sitelinks TEXT,
  final_url TEXT,
  final_url_suffix TEXT,
  theme TEXT,
  explanation TEXT,
  score REAL DEFAULT 0,
  score_breakdown TEXT,
  generation_round INTEGER DEFAULT 1,
  ai_model TEXT,
  is_selected INTEGER DEFAULT 0,
  google_ad_id TEXT,
  google_campaign_id TEXT,
  google_ad_group_id TEXT,
  sync_status TEXT DEFAULT 'pending',
  last_sync_at TEXT DEFAULT NULL,
  ad_strength_data TEXT DEFAULT NULL,
  path1 TEXT DEFAULT NULL,
  path2 TEXT DEFAULT NULL,
  keyword_bucket TEXT CHECK(keyword_bucket IN ('A', 'B', 'C', 'S')),
  keyword_pool_id INTEGER REFERENCES offer_keyword_pools(id),
  bucket_intent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- 2. 复制数据
INSERT INTO ad_creatives_new SELECT * FROM ad_creatives;

-- 3. 删除旧表
DROP TABLE ad_creatives;

-- 4. 重命名新表
ALTER TABLE ad_creatives_new RENAME TO ad_creatives;

-- 5. 重建索引
CREATE INDEX idx_ad_creatives_user_id ON ad_creatives(user_id);
CREATE INDEX idx_ad_creatives_offer_id ON ad_creatives(offer_id);
CREATE INDEX idx_ad_creatives_is_selected ON ad_creatives(is_selected);
CREATE INDEX idx_ad_creatives_keyword_bucket ON ad_creatives(keyword_bucket);
