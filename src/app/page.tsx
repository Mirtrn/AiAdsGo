export default function MarketingHome() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-gray-50">
      {/* Hero Section - P0-3 优化版 */}
      <section className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20">
        <div className="text-center">
          {/* Logo/Brand */}
          <div className="mb-6">
            <h1 className="text-6xl md:text-7xl font-extrabold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              AutoAds
            </h1>
            <div className="h-1 w-32 bg-gradient-to-r from-blue-600 to-indigo-600 mx-auto rounded-full"></div>
          </div>

          {/* Value Proposition */}
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
            Google Ads 快速测试和一键优化营销平台
          </h2>
          <p className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto mb-8 leading-relaxed">
            自动化 <span className="font-semibold text-blue-600">Offer管理</span> →
            {' '}<span className="font-semibold text-blue-600">广告投放</span> →
            {' '}<span className="font-semibold text-blue-600">效果优化</span> 全链路
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a
              href="/login"
              className="group relative px-10 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-lg font-bold rounded-xl hover:shadow-2xl hover:scale-105 transition-all duration-300"
            >
              <span className="relative z-10">立即开始 →</span>
              <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-20 rounded-xl transition-opacity"></div>
            </a>
            <a
              href="#pricing"
              className="px-10 py-4 bg-white text-blue-600 text-lg font-semibold rounded-xl border-2 border-blue-600 hover:bg-blue-50 transition-all duration-300"
            >
              查看定价
            </a>
          </div>

          {/* Trust Indicators */}
          <div className="mt-12 flex flex-wrap justify-center gap-8 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <span className="text-green-500 text-xl">✓</span>
              <span>AI自动生成高质量文案</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-500 text-xl">✓</span>
              <span>真实Google Keyword Planner数据</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-500 text-xl">✓</span>
              <span>数据驱动持续优化</span>
            </div>
          </div>
        </div>
      </section>

      {/* 核心特性 - P0-3 优化版（4个关键卖点）*/}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 bg-white">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            为什么选择 AutoAds？
          </h2>
          <p className="text-xl text-gray-600">
            四大核心能力，助你构建高效的Google Ads投放体系
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* 特性1: AI广告文案 */}
          <div className="group bg-gradient-to-br from-blue-50 to-indigo-50 p-8 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-105 transition-all duration-300 border border-blue-100">
            <div className="text-5xl mb-6 group-hover:scale-110 transition-transform">🤖</div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">
              AI自动生成高质量广告文案
            </h3>
            <p className="text-gray-700 leading-relaxed">
              充分利用AI，自动完成广告文案（标题/描述/摘录/链接）的生成和评分，提前确保只投放高质量的广告文案
            </p>
          </div>

          {/* 特性2: 真实数据 */}
          <div className="group bg-gradient-to-br from-green-50 to-emerald-50 p-8 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-105 transition-all duration-300 border border-green-100">
            <div className="text-5xl mb-6 group-hover:scale-110 transition-transform">📊</div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">
              真实Keyword Planner数据
            </h3>
            <p className="text-gray-700 leading-relaxed">
              利用Google Ads的Keyword Planner获取最真实的关键词自然搜索量，不再受到其他第三方平台的数据干扰
            </p>
          </div>

          {/* 特性3: 数据驱动优化 */}
          <div className="group bg-gradient-to-br from-purple-50 to-pink-50 p-8 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-105 transition-all duration-300 border border-purple-100">
            <div className="text-5xl mb-6 group-hover:scale-110 transition-transform">🔄</div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">
              数据驱动自动优化
            </h3>
            <p className="text-gray-700 leading-relaxed">
              基于真实投放数据，AI自动分析高表现创意特征，持续优化文案生成策略，提高CTR并降低CPC
            </p>
          </div>

          {/* 特性4: 增长飞轮 */}
          <div className="group bg-gradient-to-br from-orange-50 to-amber-50 p-8 rounded-2xl shadow-lg hover:shadow-2xl hover:scale-105 transition-all duration-300 border border-orange-100">
            <div className="text-5xl mb-6 group-hover:scale-110 transition-transform">💰</div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">
              提高ROI的增长飞轮
            </h3>
            <p className="text-gray-700 leading-relaxed">
              实现"Offer筛选 → 广告投放 → 效果优化"的增长飞轮，构建属于自己的"印钞机"组合
            </p>
          </div>
        </div>
      </section>

      {/* 产品特点 */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 bg-gray-50 rounded-lg my-16">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
          产品特点
        </h2>
        <div className="space-y-8">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl">
              1
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                自动化全链路
              </h3>
              <p className="text-gray-600">
                自动化Offer管理、广告投放、效果优化全链路，最大化提高广告投放和优化效率
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl">
              2
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                AI广告文案生成
              </h3>
              <p className="text-gray-600">
                充分利用AI，自动完成广告文案（标题/描述/摘录/链接）的生成和评分，提前确保只投放高质量的广告文案
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl">
              3
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                真实关键词数据
              </h3>
              <p className="text-gray-600">
                利用Google Ads的Keyword Planner获取最真实的关键词自然搜索量，不再受到其他第三方平台的数据干扰
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xl">
              4
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                增长飞轮
              </h3>
              <p className="text-gray-600">
                实现"Offer筛选-广告投放-效果优化"的增长飞轮，构建属于自己的"印钞机"组合
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 套餐定价 - P0-3 优化版 */}
      <section id="pricing" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            选择适合你的套餐
          </h2>
          <p className="text-xl text-gray-600">
            所有套餐功能完全相同，仅使用期限不同
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {/* 年卡 */}
          <div className="bg-white border-2 border-gray-200 rounded-lg p-8 hover:border-blue-500 transition">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">年卡</h3>
            <div className="text-4xl font-bold text-blue-600 mb-4">
              ¥5,999
            </div>
            <p className="text-gray-600 mb-6">
              适合BB新人，期望在25年Q4促销季大赚一笔的个人
            </p>
            <ul className="space-y-3 mb-8">
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                12个月使用期限
              </li>
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                全部功能不限制
              </li>
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                AI广告文案生成
              </li>
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                真实关键词数据
              </li>
            </ul>
          </div>

          {/* 终身买断 */}
          <div className="bg-white border-4 border-blue-500 rounded-lg p-8 relative transform scale-105">
            <div className="absolute top-0 right-0 bg-blue-500 text-white px-4 py-1 rounded-bl-lg rounded-tr-lg text-sm font-semibold">
              推荐
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">终身买断</h3>
            <div className="text-4xl font-bold text-blue-600 mb-4">
              ¥10,999
            </div>
            <p className="text-gray-600 mb-6">
              适合热爱BB并持续投入的个人，外加相信大师兄能力的粉丝
            </p>
            <ul className="space-y-3 mb-8">
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                永久使用期限
              </li>
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                全部功能不限制
              </li>
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                AI广告文案生成
              </li>
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                真实关键词数据
              </li>
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                持续产品更新
              </li>
            </ul>
          </div>

          {/* 私有化部署 */}
          <div className="bg-white border-2 border-gray-200 rounded-lg p-8 hover:border-blue-500 transition">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">私有化部署</h3>
            <div className="text-4xl font-bold text-blue-600 mb-4">
              ¥29,999
            </div>
            <p className="text-gray-600 mb-6">
              适合独立工作室，包含1年技术支持和有限功能定制
            </p>
            <ul className="space-y-3 mb-8">
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                独立服务器部署
              </li>
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                全部功能不限制
              </li>
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                1年技术支持
              </li>
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                有限功能定制
              </li>
              <li className="flex items-center text-gray-700">
                <span className="text-green-500 mr-2">✓</span>
                数据完全私有
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          开始构建你的"印钞机"组合
        </h2>
        <p className="text-xl text-gray-600 mb-8">
          Offer筛选 → 广告投放 → 效果优化 → 持续增长
        </p>
        <a
          href="/login"
          className="inline-block px-10 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition shadow-lg"
        >
          立即开始
        </a>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p>&copy; 2025 AutoAds. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
