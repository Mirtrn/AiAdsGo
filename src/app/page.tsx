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
    <div className="min-h-screen bg-[#0a0f1e] text-white font-sans antialiased">

      {/* ── Header ── */}
      <header className="fixed top-0 w-full z-50 border-b border-white/10 bg-[#0a0f1e]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">AiAdsGo</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/login" className="text-sm text-white/60 hover:text-white transition-colors px-4 py-2">
              登录
            </a>
            <a
              href="/login"
              className="text-sm font-semibold px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 transition-colors"
            >
              开始使用
            </a>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative pt-32 pb-24 overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-violet-600/20 rounded-full blur-[120px] pointer-events-none" />

        <div className="relative max-w-5xl mx-auto px-6 text-center">
          {/* Label */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 text-sm font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            AI 驱动的 Google Ads 自动化平台
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.1] mb-6">
            让广告投放
            <br />
            <span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-cyan-400 bg-clip-text text-transparent">
              真正自动化
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed">
            输入产品链接，AI 自动分析卖点、生成广告文案、推荐关键词，
            直连 Google Ads API 一键发布，全程无需手动操作。
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/login"
              className="group inline-flex items-center justify-center gap-2 px-8 py-4 bg-violet-600 hover:bg-violet-500 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:-translate-y-0.5"
            >
              免费开始使用
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="#features"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-lg border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 transition-all text-white/80"
            >
              了解功能
            </a>
          </div>

          {/* Trust badges */}
          <div className="mt-12 flex flex-wrap justify-center gap-6 text-sm text-white/40">
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
      <section id="features" className="py-24 border-t border-white/5">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              一套工具，覆盖投放全链路
            </h2>
            <p className="text-white/50 text-lg max-w-xl mx-auto">
              从产品分析到广告上线，每个环节都由 AI 自动处理
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: <Bot className="w-5 h-5" />,
                color: "text-violet-400",
                bg: "bg-violet-500/10 border-violet-500/20",
                title: "智能内容生成",
                desc: "自动抓取落地页信息，提炼产品核心卖点，生成符合 Google 规范的广告标题与描述。",
              },
              {
                icon: <BarChart3 className="w-5 h-5" />,
                color: "text-cyan-400",
                bg: "bg-cyan-500/10 border-cyan-500/20",
                title: "关键词智能规划",
                desc: "基于行业数据和竞品分析，自动推荐高转化关键词，并按意图分组管理。",
              },
              {
                icon: <Rocket className="w-5 h-5" />,
                color: "text-emerald-400",
                bg: "bg-emerald-500/10 border-emerald-500/20",
                title: "一键发布广告",
                desc: "直连 Google Ads API，审核通过即刻发布，彻底告别手动复制粘贴。",
              },
              {
                icon: <Globe2 className="w-5 h-5" />,
                color: "text-orange-400",
                bg: "bg-orange-500/10 border-orange-500/20",
                title: "多地区多语言",
                desc: "支持 20+ 个国家和地区投放，自动本地化广告文案，覆盖全球流量。",
              },
              {
                icon: <BarChart3 className="w-5 h-5" />,
                color: "text-pink-400",
                bg: "bg-pink-500/10 border-pink-500/20",
                title: "实时效果追踪",
                desc: "统一数据看板，展示展现量、点击率、转化成本等核心指标，实时掌握投放表现。",
              },
              {
                icon: <ShieldCheck className="w-5 h-5" />,
                color: "text-indigo-400",
                bg: "bg-indigo-500/10 border-indigo-500/20",
                title: "合规安全保障",
                desc: "内置政策合规检测，广告素材发布前自动审查，降低账号被封风险。",
              },
            ].map((f, i) => (
              <div
                key={i}
                className="p-6 rounded-2xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.06] transition-colors group"
              >
                <div className={`w-10 h-10 rounded-xl border ${f.bg} flex items-center justify-center mb-5 ${f.color}`}>
                  {f.icon}
                </div>
                <h3 className="font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-white/45 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="py-20 border-t border-white/5">
        <div className="max-w-4xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: "5min", label: "平均上手时间" },
              { value: "95%", label: "广告审核通过率" },
              { value: "20+", label: "支持投放地区" },
              { value: "3x", label: "平均效率提升" },
            ].map((s, i) => (
              <div key={i}>
                <div className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent mb-2">
                  {s.value}
                </div>
                <div className="text-sm text-white/40">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 border-t border-white/5">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="relative inline-block mb-8">
            <div className="absolute inset-0 bg-gradient-to-r from-violet-600 to-indigo-600 rounded-2xl blur-2xl opacity-40" />
            <div className="relative px-12 py-12 rounded-2xl border border-white/10 bg-gradient-to-br from-violet-600/20 to-indigo-600/20">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                准备好提升投放效率了吗？
              </h2>
              <p className="text-white/50 text-lg mb-8">
                现在注册，立即获得完整功能免费试用资格
              </p>
              <a
                href="/login"
                className="group inline-flex items-center gap-2 px-10 py-4 bg-white text-[#0a0f1e] font-bold text-lg rounded-xl hover:bg-violet-100 transition-all shadow-xl"
              >
                立即免费注册
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-white/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Zap className="w-3 h-3 text-white" />
            </div>
            <span className="font-semibold text-white/60">AiAdsGo</span>
          </div>
          <div className="flex gap-6">
            <a href="/about" className="hover:text-white transition-colors">关于我们</a>
            <a href="/contact" className="hover:text-white transition-colors">联系方式</a>
            <a href="/privacy" className="hover:text-white transition-colors">隐私政策</a>
            <a href="/terms" className="hover:text-white transition-colors">服务条款</a>
          </div>
          <p>&copy; {new Date().getFullYear()} AiAdsGo. All rights reserved.</p>
        </div>
      </footer>

    </div>
  );
}
