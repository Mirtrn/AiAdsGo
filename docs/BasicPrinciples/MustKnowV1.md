# 基本原则和项目信息
1. 使用中文进行沟通和文档输出
2. 遵循KISS原则，在确保实现业务需求的情况下，简化代码实现，提高可维护性
3. 不要为了简化，而破坏业务核心功能和逻辑，简化不是无脑删除，而是在保持业务价值的前提下提升代码质量和可维护性
4. 不要模拟测试，而是使用真实的数据进行测试
5. 始终先验证当前实际使用的文件和配置，不要基于假设进行分析，也不要重复造轮子
6. 先验证，再修复 - 假设是调试之敌，实际检查是解决之基
7. 修复前必先全面检查依赖关系，增量修复优于整体重写，确保所有现有功能完整保留
8. 分析数据流问题时，必须逆向检查所有fallback和默认值逻辑，因为异常路径往往比正常路径更容易隐藏真正的问题根源
9. 修复特定问题时，必须严格限制修改范围，只触碰与问题直接相关的代码，并在修改后立即验证所有核心功能是否正常
10. secrets目录和其下的所有文件都不能上传Github，也不能打包进入镜像
11. 切记不要上传任何敏感信息到Github
12. 每次更新后，都自动提交git commit，便于后续回滚恢复
13. 301跳转实现：使用Cloudflare CDN配置域名重定向（autoads.dev → www.autoads.dev），避免在应用层实现，遵循单一职责原则
14. 不同环境的域名
- 测试环境域名：localhost
- 生成环境域名：autoads.dev
15. 代码结构是Monorepo，构建单容器部署的架构，利用supervisord管理所有服务和定时任务，对外只暴露80端口
16. 阅读 docs/MONOREPO_BUILD_BEST_PRACTICES.md 文档，了解Monorepo构建最佳实践
17. 代码分支和部署流程（Github Actions）
- 代码推送到main分支，触发镜像构建，标签: `prod-latest` 和 `prod-{commitid}`
- 版本标签(如v3.0.0)，触发镜像构建，标签: `prod-{version}` 和 `prod-{commitid}`
- 除了main分支外，不要创建额外的分支
**部署方式A - ClawCloud（手动）：**
- 从GHCR拉取镜像: `ghcr.io/xxrenzhe/autobb:prod-latest`
- 手动部署到ClawCloud服务器
**部署方式B - GCP Cloud Run（自动）：**
- 镜像自动推送到Artifact Registry并部署到Cloud Run
- 环境变量从Secret Manager注入
- 需配置GitHub Secret: `GCP_SA_KEY`
18.测试时，严禁在没有明确指令的情况下，擅自修改数据库中的信息，包括用户密码等
19.修改关键组件时，必须分析对整个系统的连锁影响，不能只做局部优化
20.若遇到浏览器访问网页问题，可以参考 docs/troubleshooting/AMAZON_SCRAPING_EMPTY_PAGE_FIX.md
21.每次在代码中使用新的数据库字段时，必须同时创建migration文件
22.应该有CI/CD检查确保schema与代码类型定义一致
23.开发时不应手动修改数据库schema，而应通过migration文件
24.批量更新Prompt并生成全局的数据库迁移文件：./scripts/update-prompt.sh
25.单个文件不要超过500行，避免修改困难
26.开发环境使用SQLite数据库，生产环境使用PostgreSQL数据库，所以SQL查询语句需要同时兼容SQLite和PostgreSQL
27.本地开发环境构建详见 DEVELOPMENT_SETUP.md
28.架构设计和功能实现，严格遵循KISS原则，避免不需要的复杂性
29.API字段命名统一使用camelCase的格式，且前端使用和API字段必须匹配
30.GCP访问：使用 secrets/gcp_autoads_dev.json 密钥文件
- GCP服务账号：codex-dev@gen-lang-client-0944935873.iam.gserviceaccount.com
- GCP Project ID：gen-lang-client-0944935873
- 部署区域：asia-northeast1
- Artifact Registry仓库：autobb
31.system_settings表严格遵循"模板+实例"双层架构：
   a)全局模板记录(user_id=NULL, value=NULL)：定义配置项元数据(类型、描述、是否敏感等)，必须存在且唯一
   b)用户配置记录(user_id=用户ID, value=JSON)：存储用户实际配置值，可有多个用户配置
   c)添加新配置项：必须插入全局模板记录作为"注册表"，同时可在需要时创建用户配置记录
   d)迁移文件编写：
      - SQLite: INSERT OR IGNORE (幂等插入)，布尔值使用0/1
      - PostgreSQL: INSERT ... WHERE NOT EXISTS (幂等插入)，布尔值使用false/true
      - 必须同时创建.sql和.pg.sql两个版本
   e)严禁执行的操作：
      - 严禁删除value为NULL或空字符串的记录(会删除全局模板)
      - 严禁在清理重复记录时忽略user_id字段(必须区分全局模板和用户配置)
      - 严禁使用统一的唯一性约束覆盖全局模板和用户配置
   f)唯一性约束设计：
      - 全局模板唯一：CREATE UNIQUE INDEX ... WHERE user_id IS NULL AND value IS NULL
      - 用户配置唯一：CREATE UNIQUE INDEX ... WHERE user_id IS NOT NULL AND value IS NOT NULL
      - 允许全局模板和用户配置共存，因为它们的约束条件不同
32.Prompt版本规范：name和category必须使用中文，如"广告创意生成v4.18"、分类用"广告创意生成"，禁止使用英文
33.Google Ads API访问架构：
   - OAuth模式：Node.js → google-ads-api (官方库) → Google Ads API
   - 服务账号模式：Node.js → Python FastAPI → google-ads-python → Google Ads API
   - 查询类操作(customer.query)通过Python代理对象自动路由
   - 创建/更新类操作通过authType参数显式路由到Python服务
   - 所有核心业务场景已支持双认证模式，@htdangkhoa/google-ads已废弃
   - 功能对等状态：
     * ✅ 完全支持双认证：Campaign/AdGroup/Keyword/Ad创建、性能查询、预算管理
     * ⚠️ 仅OAuth支持：setCampaignMarketingObjective（低频操作，后续版本补充）
