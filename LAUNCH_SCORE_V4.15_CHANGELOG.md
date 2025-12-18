# Launch Score v4.15 升级总结

**发布日期**: 2025-12-18
**版本**: v4.14 → v4.15
**状态**: ✅ 已激活

---

## 📋 变更内容

### 1. 评分维度重新分配 (总分仍为100分)

| 维度 | v4.14 | v4.15 | 变化 |
|------|-------|-------|------|
| 投放可行性 | 35 | 40 | +5 |
| 广告质量 | 30 | 30 | - |
| 关键词策略 | 20 | 20 | - |
| 基础配置 | 15 | 10 | -5 |
| **总分** | **100** | **100** | **✅** |

### 2. 投放可行性维度 (40分) 结构变化

**v4.14 结构** (35分):
- 品牌词搜索量: 0-15分
- 利润空间: 0-10分 ❌ **已移除**
- 竞争度: 0-10分

**v4.15 结构** (40分):
- 品牌词搜索量: 0-15分 (unchanged)
- 竞争度: 0-15分 ✅ **增加5分**
- 市场潜力: 0-10分 ✅ **新增**

#### 竞争度得分规则 (0-15分)
```
低竞争 (LOW):     12-15分 (有利可图，易获胜)
中等竞争 (MEDIUM): 7-11分 (正常竞争，需要优化)
高竞争 (HIGH):    0-6分  (激烈竞争，需要大量投入)
```

#### 市场潜力得分规则 (0-10分)
基于品牌搜索量与竞争度的综合评估:
```
高搜索量 + 低竞争:    9-10分 ⭐ 最优市场
高搜索量 + 中竞争:    7-8分  🟢 良好市场
高搜索量 + 高竞争:    5-6分  🟡 需要投入
中搜索量 + 低竞争:    7-8分  🟢 稳定市场
中搜索量 + 中竞争:    5-6分  🟡 正常市场
中搜索量 + 高竞争:    3-4分  🟠 需谨慎
低搜索量 + 任何竞争:  0-3分  🔴 市场小
```

### 3. 基础配置维度 (10分，从15分改为10分) 变化

**v4.14 结构** (15分):
- 国家/语言匹配: 0-5分
- Final URL有效性: 0-5分
- 预算合理性: 0-5分 ❌ **已移除**

**v4.15 结构** (10分):
- 国家/语言匹配: 0-5分 (unchanged)
- Final URL可访问性: 0-5分 ✅ **简化规则**

#### Final URL 评估规则变化

**v4.14** (允许部分分):
- 有效且相关的URL: 4-5分
- 有效但不够优化: 2-3分
- 存在问题: 0-1分

**v4.15** (二元判决):
- URL正常访问(HTTP 200): **5分** ✅ 满分
- URL无法访问: **0分** ❌ 零分

### 4. 已废弃的字段

| 字段 | v4.14 | v4.15 | 说明 |
|------|-------|-------|------|
| profitScore | 0-10 | 0 (always) | 取消利润空间评估 |
| profitMargin | 数值 | 0 (always) | 保留字段但不使用 |
| budgetScore | 0-5 | 0 (always) | 移除预算评分 |

### 5. 新增字段

| 字段 | 范围 | 说明 |
|------|------|------|
| marketPotentialScore | 0-10 | 在launchViability中新增，基于品牌搜索量+竞争度 |

---

## 🔍 技术实现

### 数据库版本管理
- **Prompt ID**: `launch_score`
- **Previous**: v4.14 (inactive)
- **Current**: v4.15 (active)

### 文件变更

#### TypeScript 代码更新
- **src/lib/launch-scores.ts**: 更新ScoreAnalysis接口定义
  - launchViability.score: 0-35 → 0-40
  - launchViability.competitionScore: 0-10 → 0-15
  - launchViability.marketPotentialScore: 新增 (0-10)
  - launchViability.profitScore: 保留但注释为已废弃
  - basicConfig.score: 0-15 → 0-10
  - basicConfig.budgetScore: 保留但注释为已废弃

- **src/lib/scoring.ts**: 更新验证函数
  - validateScoresV4(): 更新范围验证
  - 新增总分=100验证

#### 数据库迁移文件
- **migrations/080_launch_score_v4.15_prompt_activation.sql** (SQLite)
  - 停用v4.14
  - 创建并激活v4.15

- **pg-migrations/080_launch_score_v4.15_prompt_activation.pg.sql** (PostgreSQL)
  - PostgreSQL兼容的版本
  - 使用 `boolean` 类型而非 `integer`

---

## ✅ 验证清单

### 数据库层面
```sql
-- 确认v4.15已激活
SELECT version, is_active FROM prompt_versions
WHERE prompt_id = 'launch_score'
ORDER BY created_at DESC LIMIT 5;

-- 预期输出:
-- v4.15 | 1 (or true for PostgreSQL)
-- v4.14 | 0 (or false for PostgreSQL)
```

### 应用层面
- [ ] NPM依赖未变更
- [ ] TypeScript 编译成功 (`npm run type-check`)
- [ ] 新的Prompt能够正确加载
- [ ] AI评分系统能返回新格式JSON
- [ ] 前端正确显示新的评分维度

### 功能测试
- [ ] 创建广告活动时调用Launch Score
- [ ] 验证总分恒为100分
- [ ] 验证竞争度得分范围 0-15
- [ ] 验证市场潜力得分正确计算
- [ ] 验证Final URL仅返回0或5分

---

## 📊 评分示例对比

### 案例：Reolink摄像机广告

**v4.14评分**:
```
投放可行性: 22/35
  - 品牌词: 15/15
  - 利润空间: 1/10 ❌ (问题来源)
  - 竞争度: 6/10

广告质量: 30/30
基关键词策略: 17/20
基础配置: 9/15 ❌ (预算低)

总分: 78/100
```

**v4.15评分**:
```
投放可行性: 30/40
  - 品牌词: 15/15
  - 竞争度: 10/15
  - 市场潜力: 5/10 ✅ 新指标

广告质量: 30/30
关键词策略: 17/20
基础配置: 10/10 ✅ (Final URL满分)

总分: 87/100 ⬆️ +9分改进
```

---

## 🚀 迁移影响

### 向后兼容性
- ✅ 所有旧的Launch Score记录仍可读
- ✅ 新创建的评分使用v4.15规则
- ⚠️ 无法直接比较v4.14和v4.15的分数

### 性能影响
- ✅ 无数据库查询性能变化
- ✅ Prompt加载机制无变化
- ✅ 评分逻辑复杂度无明显增加

---

## 📝 变更日志

| 时间 | 操作 | 状态 |
|------|------|------|
| 2025-12-18 | 创建v4.15 Prompt | ✅ 完成 |
| 2025-12-18 | 更新TypeScript定义 | ✅ 完成 |
| 2025-12-18 | 创建迁移文件 | ✅ 完成 |
| 2025-12-18 | 激活v4.15 | ✅ 完成 |

---

## 🔗 相关文件

- Prompt文本: `/tmp/launch_score_v4.15.txt`
- 数据库迁移:
  - `migrations/080_launch_score_v4.15_prompt_activation.sql`
  - `pg-migrations/080_launch_score_v4.15_prompt_activation.pg.sql`
- TypeScript定义: `src/lib/launch-scores.ts`
- 验证函数: `src/lib/scoring.ts` (validateScoresV4)

---

## ❓ FAQ

### Q: 为什么移除利润空间得分?
A: 利润空间需要产品定价信息，但该信息经常缺失或不准确。为了系统更稳定，决定将重点转向市场可行性(品牌搜索量+竞争度)。

### Q: 为什么增加竞争度权重?
A: 竞争度是投放决策的关键因素。提升其权重(10→15分)反映了竞争环境对Campaign成功的重要影响。

### Q: Final URL为什么改为二元判决?
A: 简化规则：URL能访问就是好的，不能访问就是坏的。不需要中间的"部分有效"状态。

### Q: 如何升级现有系统?
A:
1. 运行迁移文件 (SQLite或PostgreSQL)
2. 运行 `npm run type-check` 验证TypeScript
3. 重新部署应用
4. 新创建的Campaign会自动使用v4.15

### Q: 旧评分会被更新吗?
A: 不会。旧的v4.14评分保持不变。只有新创建的Campaign会使用v4.15。

---

## 📞 支持

如有问题，请查看:
- 完整的Prompt定义：数据库 `prompt_versions` 表中 `v4.15`
- 前端展示：查看Campaign详情页中的得分分解
- 调试日志：服务器启用 `console.log` 输出中的 `[LaunchScore]` 前缀
