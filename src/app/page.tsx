import { pageMetadata } from "@/lib/seo";
import { ArrowRight, Zap, BarChart3, Globe2, ShieldCheck, Rocket, Bot } from "lucide-react";
import dynamic from "next/dynamic";

const DashboardMockup = dynamic(
  () => import("@/components/marketing/DashboardMockup"),
  { ssr: false }
);

export const metadata = pageMetadata.home;

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans antialiased">

      {/* ── Header ── */}
      <header className="fixed top-0 w-full z-50 border-b border-gray-100 bg-white/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight text-gray-900">AiAdsGo</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/login" className="text-sm text-gray-500 hover:text-gray-900 transition-colors px-4 py-2">
              登录
            </a>
            <a
              href="/login"
              className="text-sm font-semibold px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              开始使用
            </a>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative pt-32 pb-24 overflow-hidden bg-gray-50">
        <div className="relative max-w-5xl mx-auto px-6 text-center">
          {/* Label */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-200 bg-blue-50 text-blue-600 text-sm font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            AI 驱动的 Google Ads 自动化平台
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6 text-gray-900">
            让广告投放
            <br />
            <span className="text-blue-600">
              真正自动化
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
            输入产品链接，AI 自动分析卖点、生成广告文案、推荐关键词，
            直连 Google Ads API 一键发布，全程无需手动操作。
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/login"
              className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold text-lg text-white transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5"
            >
              免费开始使用
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="#features"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-lg border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 transition-all text-gray-700"
            >
              了解功能
            </a>
          </div>

          {/* Trust badges */}
          <div className="mt-12 flex flex-wrap justify-center gap-6 text-sm text-gray-400">
            <span>✓ 免费试用，无需信用卡</span>
            <span>✓ 5分钟快速上手</span>
            <span>✓ 随时导出数据</span>
          </div>
        </div>
      </section>

      {/* ── Dashboard Mockup (Interactive) ── */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <DashboardMockup />
      </section>

      {/* ── Features ── */}
      <section id="features" className="py-24 border-t border-gray-100 bg-gray-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-gray-900">
              一套工具，覆盖投放全链路
            </h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              从产品分析到广告上线，每个环节都由 AI 自动处理
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: <Bot className="w-5 h-5" />,
                color: "text-blue-600",
                bg: "bg-blue-50 border-blue-100",
                title: "智能内容生成",
                desc: "自动抓取落地页信息，提炼产品核心卖点，生成符合 Google 规范的广告标题与描述。",
              },
              {
                icon: <BarChart3 className="w-5 h-5" />,
                color: "text-cyan-600",
                bg: "bg-cyan-50 border-cyan-100",
                title: "关键词智能规划",
                desc: "基于行业数据和竞品分析，自动推荐高转化关键词，并按意图分组管理。",
              },
              {
                icon: <Rocket className="w-5 h-5" />,
                color: "text-emerald-600",
                bg: "bg-emerald-50 border-emerald-100",
                title: "一键发布广告",
                desc: "直连 Google Ads API，审核通过即刻发布，彻底告别手动复制粘贴。",
              },
              {
                icon: <Globe2 className="w-5 h-5" />,
                color: "text-orange-600",
                bg: "bg-orange-50 border-orange-100",
                title: "多地区多语言",
                desc: "支持 20+ 个国家和地区投放，自动本地化广告文案，覆盖全球流量。",
              },
              {
                icon: <BarChart3 className="w-5 h-5" />,
                color: "text-pink-600",
                bg: "bg-pink-50 border-pink-100",
                title: "实时效果追踪",
                desc: "统一数据看板，展示展现量、点击率、转化成本等核心指标，实时掌握投放表现。",
              },
              {
                icon: <ShieldCheck className="w-5 h-5" />,
                color: "text-indigo-600",
                bg: "bg-indigo-50 border-indigo-100",
                title: "合规安全保障",
                desc: "内置政策合规检测，广告素材发布前自动审查，降低账号被封风险。",
              },
            ].map((f, i) => (
              <div
                key={i}
                className="p-6 rounded-2xl border border-gray-100 bg-white hover:shadow-md transition-shadow group"
              >
                <div className={`w-10 h-10 rounded-xl border ${f.bg} flex items-center justify-center mb-5 ${f.color}`}>
                  {f.icon}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="py-20 border-t border-gray-100 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: "5min", label: "平均上手时间" },
              { value: "95%", label: "广告审核通过率" },
              { value: "20+", label: "支持投放地区" },
              { value: "3x", label: "平均效率提升" },
            ].map((s, i) => (
              <div key={i}>
                <div className="text-3xl sm:text-4xl font-extrabold text-blue-600 mb-2">
                  {s.value}
                </div>
                <div className="text-sm text-gray-400">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 border-t border-gray-100 bg-gray-50">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="px-12 py-12 rounded-2xl border border-gray-200 bg-white shadow-sm">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-gray-900">
              准备好提升投放效率了吗？
            </h2>
            <p className="text-gray-500 text-lg mb-8">
              现在注册，立即获得完整功能免费试用资格
            </p>
            <a
              href="/login"
              className="group inline-flex items-center gap-2 px-10 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg rounded-xl transition-all shadow-md hover:shadow-lg"
            >
              立即免费注册
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-100 py-10 bg-white">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center">
              <Zap className="w-3 h-3 text-white" />
            </div>
            <span className="font-semibold text-gray-600">AiAdsGo</span>
          </div>
          <div className="flex gap-6">
            <a href="/about" className="hover:text-gray-700 transition-colors">关于我们</a>
            <a href="/contact" className="hover:text-gray-700 transition-colors">联系方式</a>
            <a href="/privacy" className="hover:text-gray-700 transition-colors">隐私政策</a>
            <a href="/terms" className="hover:text-gray-700 transition-colors">服务条款</a>
          </div>
          <p>&copy; {new Date().getFullYear()} AiAdsGo. All rights reserved.</p>
        </div>
      </footer>

    </div>
  );
}
