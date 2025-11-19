import Image from "next/image";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo"; // P2-1: SEO优化

// P2-1: 首页SEO metadata
export const metadata = pageMetadata.home;

export default function MarketingHome() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-gray-50 font-sans">
      {/* Header */}
      <header className="fixed top-0 w-full bg-white/80 backdrop-blur-md z-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              {/* Logo: Adjusted to auto width to prevent compression, removed duplicate text */}
              <Image
                src="/logo.png"
                alt="AutoAds Logo"
                width={0}
                height={0}
                sizes="100vw"
                className="h-8 w-auto"
              />
            </div>
            <nav className="hidden md:flex space-x-8">
              <a
                href="#features"
                className="text-gray-600 hover:text-blue-600 transition-colors font-medium"
              >
                功能特性
              </a>
              <a
                href="#pricing"
                className="text-gray-600 hover:text-blue-600 transition-colors font-medium"
              >
                价格方案
              </a>
              <a
                href="#testimonials"
                className="text-gray-600 hover:text-blue-600 transition-colors font-medium"
              >
                客户案例
              </a>
            </nav>
            <div className="flex items-center gap-4">
              <Link
                href="/login"
                className="text-gray-600 hover:text-gray-900 font-medium"
              >
                登录
              </Link>
              <Link
                href="/login"
                className="px-5 py-2 bg-gray-900 text-white text-sm font-semibold rounded-full hover:bg-gray-800 transition-all shadow-md hover:shadow-lg"
              >
                免费试用
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-24 pb-16 lg:pt-32 lg:pb-24">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full z-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/10 blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px]" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Badge */}
          <div className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-800 mb-6 animate-fade-in-up">
            <span className="flex h-2 w-2 rounded-full bg-blue-600 mr-2"></span>
            AutoAds 2.0 全新发布
          </div>

          {/* Main Heading: Scaled down for better hierarchy */}
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-gray-900 mb-6 animate-fade-in-up [animation-delay:200ms]">
            Google Ads <br className="hidden md:block" />
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              极速测试与智能优化平台
            </span>
          </h1>

          {/* Subheading: Increased max-width and adjusted font size */}
          <p className="mt-6 text-lg text-gray-600 max-w-4xl mx-auto mb-10 leading-relaxed animate-fade-in-up [animation-delay:400ms]">
            全生命周期自动化管理：
            <span className="font-semibold text-gray-900">Offer筛选</span> →
            <span className="font-semibold text-gray-900"> 广告投放</span> →
            <span className="font-semibold text-gray-900"> 效果优化</span>
            <br />
            打造属于你自己的"印钞机"系统
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center animate-fade-in-up [animation-delay:600ms]">
            <Link
              href="/login"
              className="group relative px-8 py-3 bg-gray-900 text-white text-lg font-semibold rounded-full hover:bg-gray-800 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
            >
              立即开始
              <span className="ml-2 inline-block transition-transform group-hover:translate-x-1">
                →
              </span>
            </Link>
            <a
              href="#pricing"
              className="px-8 py-3 bg-white text-gray-900 text-lg font-semibold rounded-full border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all duration-300"
            >
              查看价格
            </a>
          </div>

          {/* Trust Indicators */}
          <div className="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-4 text-sm font-medium text-gray-500 animate-fade-in-up [animation-delay:800ms]">
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                ></path>
              </svg>
              <span>AI 智能文案</span>
            </div>
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                ></path>
              </svg>
              <span>真实关键词数据</span>
            </div>
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                ></path>
              </svg>
              <span>数据驱动增长</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl mb-4">
              为什么选择 AutoAds?
            </h2>
            <p className="text-lg text-gray-600">
              四大核心能力，助你构建高效的 Google Ads 投放体系
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                icon: "🤖",
                title: "AI 智能文案",
                desc: "自动生成并评分高质量广告文案（标题、描述），确保只有最佳广告上线",
                color: "blue",
              },
              {
                icon: "📊",
                title: "真实数据源",
                desc: "直接接入 Google Keyword Planner 真实搜索量数据，告别第三方数据噪音",
                color: "green",
              },
              {
                icon: "🔄",
                title: "自动优化",
                desc: "AI 分析投放数据，持续优化文案策略，提升 CTR 并降低 CPC",
                color: "purple",
              },
              {
                icon: "💰",
                title: "增长飞轮",
                desc: "实现 'Offer筛选 → 广告投放 → 效果优化' 闭环，打造你的收益引擎",
                color: "orange",
              },
            ].map((feature, idx) => (
              <div
                key={idx}
                className={`group relative p-8 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1`}
              >
                <div
                  className={`absolute inset-0 bg-gradient-to-br from-${feature.color}-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl`}
                />
                <div className="relative z-10">
                  <div className="text-4xl mb-6 transform group-hover:scale-110 transition-transform duration-300">
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3">
                    {feature.title}
                  </h3>
                  <p className="text-gray-600 leading-relaxed text-sm">
                    {feature.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl mb-4">
              深受顶尖 Affiliate Marketer 信赖
            </h2>
            <p className="text-lg text-gray-600">
              看看他们如何使用 AutoAds 实现 ROI 翻倍
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                content:
                  "AutoAds 的 AI 文案生成简直是神技！以前我需要花几个小时写广告语，现在几秒钟就能搞定，而且 CTR 提升了 30% 以上",
                author: "Alex Chen",
                role: "资深 Media Buyer",
                avatar: "AC",
              },
              {
                content:
                  "真实关键词数据功能帮我避开了无数个坑。能够直接看到 Google 官方的数据，让我对投放策略充满了信心",
                author: "Sarah Li",
                role: "独立站站长",
                avatar: "SL",
              },
              {
                content:
                  "从 Offer 筛选到广告投放的闭环流程非常顺滑。这是我用过的最高效的 Affiliate Marketing 工具，没有之一",
                author: "Mike Wang",
                role: "工作室负责人",
                avatar: "MW",
              },
            ].map((testimonial, idx) => (
              <div
                key={idx}
                className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-1 mb-4 text-yellow-400">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <svg
                      key={star}
                      className="w-5 h-5 fill-current"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path>
                    </svg>
                  ))}
                </div>
                <p className="text-gray-600 mb-6 leading-relaxed">
                  "{testimonial.content}"
                </p>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
                    {testimonial.avatar}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">
                      {testimonial.author}
                    </div>
                    <div className="text-sm text-gray-500">
                      {testimonial.role}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl mb-4">
              简单透明的价格方案
            </h2>
            <p className="text-lg text-gray-600">
              所有方案均包含完整功能。选择最适合你的时长
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Annual Plan */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 hover:border-blue-300 transition-all duration-300">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                年度会员
              </h3>
              <div className="flex items-baseline mb-6">
                <span className="text-4xl font-bold tracking-tight text-gray-900">
                  ¥5,999
                </span>
                <span className="text-gray-500 ml-1">/年</span>
              </div>
              <p className="text-sm text-gray-600 mb-8">
                适合希望抓住 Q4 旺季的新手玩家
              </p>
              <ul className="space-y-4 mb-8">
                {[
                  "12个月使用权",
                  "完整功能访问",
                  "AI 智能文案",
                  "真实关键词数据",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-center text-sm text-gray-700"
                  >
                    <svg
                      className="w-5 h-5 text-green-500 mr-3 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M5 13l4 4L19 7"
                      ></path>
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className="block w-full py-3 px-4 bg-blue-50 text-blue-700 font-semibold rounded-lg text-center hover:bg-blue-100 transition-colors"
              >
                立即开始
              </Link>
            </div>

            {/* Lifetime Plan */}
            <div className="relative bg-gray-900 rounded-2xl p-8 shadow-xl transform md:-translate-y-4">
              <div className="absolute top-0 right-0 -mt-4 mr-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide shadow-lg">
                最受欢迎
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                终身会员
              </h3>
              <div className="flex items-baseline mb-6">
                <span className="text-4xl font-bold tracking-tight text-white">
                  ¥10,999
                </span>
                <span className="text-gray-400 ml-1">/一次性</span>
              </div>
              <p className="text-sm text-gray-400 mb-8">
                适合致力于长期发展的专业 Affiliate Marketer
              </p>
              <ul className="space-y-4 mb-8">
                {[
                  "终身使用权",
                  "完整功能访问",
                  "AI 智能文案",
                  "真实关键词数据",
                  "优先更新支持",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-center text-sm text-gray-300"
                  >
                    <svg
                      className="w-5 h-5 text-blue-400 mr-3 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M5 13l4 4L19 7"
                      ></path>
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className="block w-full py-3 px-4 bg-blue-600 text-white font-semibold rounded-lg text-center hover:bg-blue-500 transition-colors shadow-lg"
              >
                获取终身权限
              </Link>
            </div>

            {/* Enterprise Plan */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 hover:border-blue-300 transition-all duration-300">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                私有化部署
              </h3>
              <div className="flex items-baseline mb-6">
                <span className="text-4xl font-bold tracking-tight text-gray-900">
                  ¥29,999
                </span>
                <span className="text-gray-500 ml-1">/授权</span>
              </div>
              <p className="text-sm text-gray-600 mb-8">
                适合需要数据隐私和定制功能的独立工作室
              </p>
              <ul className="space-y-4 mb-8">
                {[
                  "私有化部署",
                  "完整功能访问",
                  "1年技术支持",
                  "定制功能开发",
                  "数据完全私有",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-center text-sm text-gray-700"
                  >
                    <svg
                      className="w-5 h-5 text-green-500 mr-3 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M5 13l4 4L19 7"
                      ></path>
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className="block w-full py-3 px-4 bg-white text-gray-900 border border-gray-200 font-semibold rounded-lg text-center hover:bg-gray-50 transition-colors"
              >
                联系销售
              </Link>
            </div>
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
        <Link
          href="/login"
          className="inline-block px-10 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition shadow-lg"
        >
          立即开始
        </Link>
      </section>

      {/* Rich Footer */}
      <footer className="bg-gray-900 text-gray-300 py-16 border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
            {/* Brand Column */}
            <div className="col-span-1 md:col-span-1">
              <div className="flex items-center gap-2 mb-6">
                <Image
                  src="/logo.png"
                  alt="AutoAds Logo"
                  width={0}
                  height={0}
                  sizes="100vw"
                  className="h-8 w-auto brightness-0 invert"
                />
              </div>
              <p className="text-sm text-gray-400 leading-relaxed mb-6">
                专为 Affiliate Marketer 打造的 Google Ads
                自动化投放与优化平台。让每一分预算都发挥最大价值
              </p>
              <div className="flex space-x-4">
                <a
                  href="#"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <Image
                    src="/twitter.webp"
                    alt="Twitter"
                    width={20}
                    height={20}
                    className="w-5 h-5 opacity-75 hover:opacity-100"
                  />
                </a>
                <a
                  href="#"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <Image
                    src="/facebook.webp"
                    alt="Facebook"
                    width={20}
                    height={20}
                    className="w-5 h-5 opacity-75 hover:opacity-100"
                  />
                </a>
                <a
                  href="#"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <Image
                    src="/github.webp"
                    alt="GitHub"
                    width={20}
                    height={20}
                    className="w-5 h-5 opacity-75 hover:opacity-100"
                  />
                </a>
              </div>
            </div>

            {/* Links Columns */}
            <div>
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
                产品
              </h3>
              <ul className="space-y-3">
                <li>
                  <a
                    href="#features"
                    className="text-sm hover:text-white transition-colors"
                  >
                    功能特性
                  </a>
                </li>
                <li>
                  <a
                    href="#pricing"
                    className="text-sm hover:text-white transition-colors"
                  >
                    价格方案
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-sm hover:text-white transition-colors"
                  >
                    更新日志
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-sm hover:text-white transition-colors"
                  >
                    API 文档
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
                资源
              </h3>
              <ul className="space-y-3">
                <li>
                  <a
                    href="#"
                    className="text-sm hover:text-white transition-colors"
                  >
                    帮助中心
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-sm hover:text-white transition-colors"
                  >
                    投放教程
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-sm hover:text-white transition-colors"
                  >
                    案例分析
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-sm hover:text-white transition-colors"
                  >
                    社区论坛
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">
                公司
              </h3>
              <ul className="space-y-3">
                <li>
                  <a
                    href="#"
                    className="text-sm hover:text-white transition-colors"
                  >
                    关于我们
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-sm hover:text-white transition-colors"
                  >
                    联系方式
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-sm hover:text-white transition-colors"
                  >
                    隐私政策
                  </a>
                </li>
                <li>
                  <a
                    href="#"
                    className="text-sm hover:text-white transition-colors"
                  >
                    服务条款
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-gray-800 text-center md:text-left flex flex-col md:flex-row justify-between items-center">
            <p className="text-sm text-gray-500">
              &copy; {new Date().getFullYear()} AutoAds. All rights reserved.
            </p>
            <div className="mt-4 md:mt-0 flex space-x-6">
              <a
                href="#"
                className="text-sm text-gray-500 hover:text-white transition-colors"
              >
                隐私政策
              </a>
              <a
                href="#"
                className="text-sm text-gray-500 hover:text-white transition-colors"
              >
                服务条款
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
