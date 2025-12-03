import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { ArrowRight, CheckCircle2, Zap, Star, Clock, Wand2 } from "lucide-react";

import { HolidayCountdown } from "@/components/marketing/HolidayCountdown";
import { StatsCounter } from "@/components/marketing/StatsCounter";
import { ValueCards } from "@/components/marketing/ValueCards";
import { WorkflowTimeline } from "@/components/marketing/WorkflowTimeline";
import { ComparisonChart } from "@/components/marketing/ComparisonChart";
import { ScenarioTabs } from "@/components/marketing/ScenarioTabs";

export const metadata = pageMetadata.home;

export default function MarketingHome() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Header */}
      <header className="fixed top-0 w-full bg-white/70 backdrop-blur-xl z-50 border-b border-slate-200/60 supports-[backdrop-filter]:bg-white/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700">
                AutoAds
              </span>
            </div>
            <nav className="hidden md:flex space-x-8">
              <a href="#value" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
                核心价值
              </a>
              <a href="#workflow" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
                使用流程
              </a>
              <a href="#pricing" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
                价格方案
              </a>
              <a href="#testimonials" className="text-sm font-medium text-slate-600 hover:text-blue-600 transition-colors">
                客户案例
              </a>
            </nav>
            <div className="flex items-center gap-4">
              <a href="/login" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
                登录
              </a>
              <a
                href="/login"
                className="px-5 py-2 bg-slate-900 text-white text-sm font-semibold rounded-full hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 hover:shadow-slate-900/30 hover:-translate-y-0.5"
              >
                免费试用
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-16 lg:pt-16">
        {/* Countdown Banner - Full Width */}
        <HolidayCountdown />

        {/* Background Gradients */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-100/50 via-white to-white" />
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-400/10 blur-[100px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-400/10 blur-[100px]" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-16 lg:pb-24">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left: Text Content */}
            <div className="text-center lg:text-left">
              {/* Badge */}
              <div className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50/50 backdrop-blur-sm px-3 py-1 text-sm font-medium text-blue-700 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <span className="flex h-2 w-2 rounded-full bg-blue-600 mr-2 animate-pulse"></span>
                AutoAds 2.0 全新发布
              </div>

              {/* Main Heading */}
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 mb-6 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150">
                <span className="text-blue-600">10分钟</span>搞定
                <br />
                Google Ads 投放
              </h1>

              {/* Subheading */}
              <p className="text-lg md:text-xl text-slate-600 mb-8 leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-700 delay-300">
                告别熬夜写广告、告别高额测试费、告别复杂的操作
                <br className="hidden md:block" />
                <span className="font-semibold text-slate-900">粘贴链接 → AI生成 → 一键发布</span>
              </p>

              {/* Key Benefits */}
              <div className="flex flex-wrap justify-center lg:justify-start gap-4 mb-8 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-400">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200">
                  <Clock className="w-4 h-4 text-emerald-600" />
                  <span className="text-sm font-medium text-emerald-700">省99%时间</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-purple-50 border border-purple-200">
                  <Wand2 className="w-4 h-4 text-purple-600" />
                  <span className="text-sm font-medium text-purple-700">省75%成本</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-orange-50 border border-orange-200">
                  <CheckCircle2 className="w-4 h-4 text-orange-600" />
                  <span className="text-sm font-medium text-orange-700">零门槛</span>
                </div>
              </div>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start animate-in fade-in slide-in-from-bottom-8 duration-700 delay-500">
                <a
                  href="/login"
                  className="group relative px-8 py-4 bg-slate-900 text-white text-lg font-semibold rounded-full hover:bg-slate-800 shadow-xl shadow-slate-900/20 hover:shadow-2xl hover:shadow-slate-900/30 hover:-translate-y-1 transition-all duration-300 flex items-center justify-center"
                >
                  <span>免费试用</span>
                  <ArrowRight className="inline-block ml-2 w-5 h-5 transition-transform group-hover:translate-x-1" />
                </a>
                <a
                  href="#workflow"
                  className="px-8 py-4 bg-white text-slate-900 text-lg font-semibold rounded-full border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all duration-300 shadow-sm hover:shadow-md"
                >
                  看看怎么用
                </a>
              </div>
            </div>

            {/* Right: Visual Demo */}
            <div className="relative animate-in fade-in slide-in-from-right-8 duration-700 delay-300">
              <div className="relative aspect-[4/3] rounded-3xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 shadow-2xl overflow-hidden">
                {/* Mock Dashboard */}
                <div className="absolute inset-4 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20">
                  <div className="p-6">
                    {/* Header Bar */}
                    <div className="flex items-center gap-2 mb-6">
                      <div className="w-3 h-3 rounded-full bg-red-400" />
                      <div className="w-3 h-3 rounded-full bg-yellow-400" />
                      <div className="w-3 h-3 rounded-full bg-green-400" />
                    </div>

                    {/* URL Input */}
                    <div className="bg-white/90 rounded-xl p-4 mb-4 shadow-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                          <Zap className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <div className="text-xs text-slate-500 mb-1">粘贴产品链接</div>
                          <div className="text-sm text-slate-900 font-mono">https://example.com/product...</div>
                        </div>
                      </div>
                    </div>

                    {/* AI Generating Animation */}
                    <div className="bg-white/90 rounded-xl p-4 shadow-lg">
                      <div className="flex items-center gap-3 mb-3">
                        <Wand2 className="w-5 h-5 text-purple-600 animate-pulse" />
                        <span className="text-sm font-semibold text-slate-900">AI 正在生成广告...</span>
                      </div>
                      <div className="space-y-2">
                        <div className="h-2 bg-gradient-to-r from-blue-200 to-purple-200 rounded-full animate-pulse" />
                        <div className="h-2 bg-gradient-to-r from-blue-200 to-purple-200 rounded-full w-4/5 animate-pulse" />
                        <div className="h-2 bg-gradient-to-r from-blue-200 to-purple-200 rounded-full w-3/5 animate-pulse" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Floating Elements */}
                <div className="absolute -right-4 top-1/4 bg-white rounded-2xl shadow-xl p-4 animate-bounce-slow">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span className="text-sm font-semibold text-slate-900">15个标题已生成</span>
                  </div>
                </div>

                <div className="absolute -left-4 bottom-1/4 bg-white rounded-2xl shadow-xl p-4 animate-bounce-slow delay-500">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span className="text-sm font-semibold text-slate-900">20+关键词推荐</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Counter */}
      <StatsCounter />

      {/* Value Cards Section */}
      <section id="value">
        <ValueCards />
      </section>

      {/* Workflow Timeline Section */}
      <section id="workflow">
        <WorkflowTimeline />
      </section>

      {/* Comparison Chart Section */}
      <ComparisonChart />

      {/* Scenario Tabs Section */}
      <ScenarioTabs />

      {/* Testimonials Section */}
      <section id="testimonials" className="py-24 bg-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-blue-100/40 via-transparent to-transparent" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl mb-4">
              深受 1000+ 专业玩家信赖
            </h2>
            <p className="text-xl text-slate-600">
              看看他们如何用 AutoAds 实现效率革命
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                content: "以前周五接单周一要交付，整个周末都在熬夜写广告。现在用 AutoAds，10分钟搞定，周末照样出去玩！",
                author: "Alex Chen",
                role: "资深 Media Buyer",
                initials: "AC",
                gradient: "from-blue-500 to-cyan-500",
                metric: "节省时间 99%"
              },
              {
                content: "同时跟20个Offer不再是梦！批量导入功能太强了，以前一个个测，现在可以同时追10倍的Offer。",
                author: "Sarah Li",
                role: "独立站站长",
                initials: "SL",
                gradient: "from-purple-500 to-pink-500",
                metric: "效率提升 10x"
              },
              {
                content: "完全不懂Google Ads也能用，零门槛上手。AI生成的文案质量很高，通过率比我自己写的还好！",
                author: "Mike Wang",
                role: "新手玩家",
                initials: "MW",
                gradient: "from-orange-500 to-red-500",
                metric: "广告通过率 95%"
              },
            ].map((testimonial, idx) => (
              <div
                key={idx}
                className="bg-slate-50 p-8 rounded-3xl shadow-sm border border-slate-100 hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
              >
                <div className="flex items-center gap-1 mb-4">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className="w-4 h-4 text-yellow-400 fill-current" />
                  ))}
                </div>

                {/* Metric Badge */}
                <div className={`inline-flex items-center px-3 py-1 rounded-full bg-gradient-to-r ${testimonial.gradient} text-white text-xs font-bold mb-4`}>
                  {testimonial.metric}
                </div>

                <p className="text-slate-600 mb-8 leading-relaxed">
                  "{testimonial.content}"
                </p>
                <div className="flex items-center gap-4 border-t border-slate-200 pt-6">
                  <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${testimonial.gradient} flex items-center justify-center text-white font-bold text-sm shadow-md`}>
                    {testimonial.initials}
                  </div>
                  <div>
                    <div className="font-bold text-slate-900">
                      {testimonial.author}
                    </div>
                    <div className="text-sm text-slate-500">
                      {testimonial.role}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl mb-4">
              简单透明的价格方案
            </h2>
            <p className="text-xl text-slate-600">
              所有方案均包含完整功能。选择最适合你的时长
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto items-start">
            {/* Annual Plan */}
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 hover:border-blue-300 transition-all duration-300">
              <h3 className="text-lg font-semibold text-slate-900 mb-2">年度会员</h3>
              <div className="flex items-baseline mb-6">
                <span className="text-4xl font-bold tracking-tight text-slate-900">¥5,999</span>
                <span className="text-slate-500 ml-1">/年</span>
              </div>
              <p className="text-sm text-slate-600 mb-8">适合希望抓住 Q4 旺季的新手玩家</p>
              <ul className="space-y-4 mb-8">
                {["12个月使用权", "完整功能访问", "AI 智能文案", "真实关键词数据"].map((item) => (
                  <li key={item} className="flex items-center text-sm text-slate-700">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 mr-3 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <a href="/login" className="block w-full py-3 px-4 bg-blue-50 text-blue-700 font-semibold rounded-xl text-center hover:bg-blue-100 transition-colors">
                立即开始
              </a>
            </div>

            {/* Lifetime Plan */}
            <div className="relative bg-slate-900 rounded-3xl p-8 shadow-2xl transform md:-translate-y-4 border border-slate-800">
              <div className="absolute top-0 right-0 -mt-4 mr-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide shadow-lg">
                最受欢迎
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">终身会员</h3>
              <div className="flex items-baseline mb-6">
                <span className="text-4xl font-bold tracking-tight text-white">¥10,999</span>
                <span className="text-slate-400 ml-1">/一次性</span>
              </div>
              <p className="text-sm text-slate-400 mb-8">适合致力于长期发展的专业 Affiliate Marketer</p>
              <ul className="space-y-4 mb-8">
                {["终身使用权", "完整功能访问", "AI 智能文案", "真实关键词数据", "优先更新支持"].map((item) => (
                  <li key={item} className="flex items-center text-sm text-slate-300">
                    <CheckCircle2 className="w-5 h-5 text-blue-400 mr-3 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <a href="/login" className="block w-full py-3 px-4 bg-blue-600 text-white font-semibold rounded-xl text-center hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/50">
                获取终身权限
              </a>
            </div>

            {/* Enterprise Plan */}
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-200 hover:border-blue-300 transition-all duration-300">
              <h3 className="text-lg font-semibold text-slate-900 mb-2">私有化部署</h3>
              <div className="flex items-baseline mb-6">
                <span className="text-4xl font-bold tracking-tight text-slate-900">¥29,999</span>
                <span className="text-slate-500 ml-1">/授权</span>
              </div>
              <p className="text-sm text-slate-600 mb-8">适合需要数据隐私和定制功能的独立工作室</p>
              <ul className="space-y-4 mb-8">
                {["私有化部署", "完整功能访问", "1年技术支持", "定制功能开发", "数据完全私有"].map((item) => (
                  <li key={item} className="flex items-center text-sm text-slate-700">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 mr-3 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <a href="/login" className="block w-full py-3 px-4 bg-white text-slate-900 border border-slate-200 font-semibold rounded-xl text-center hover:bg-slate-50 transition-colors">
                联系销售
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0 bg-slate-900">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-900/50 to-purple-900/50" />
        </div>
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-6 sm:text-4xl">
            10分钟后，你的广告就能上线
          </h2>
          <p className="text-xl text-slate-300 mb-4">
            别再熬夜写广告了，让 AI 帮你搞定一切
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-slate-400 mb-10">
            <span>✓ 免费试用</span>
            <span>✓ 无需信用卡</span>
            <span>✓ 随时取消</span>
          </div>
          <a
            href="/login"
            className="inline-flex items-center px-10 py-4 bg-white text-slate-900 text-lg font-semibold rounded-full hover:bg-blue-50 transition-all shadow-xl hover:shadow-2xl hover:-translate-y-1"
          >
            <span>立即免费试用</span>
            <ArrowRight className="ml-2 w-5 h-5" />
          </a>
        </div>
      </section>

      {/* Rich Footer */}
      <footer className="bg-slate-950 text-slate-400 py-16 border-t border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
            {/* Brand Column */}
            <div className="col-span-1 md:col-span-1">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-white">AutoAds</span>
              </div>
              <p className="text-sm leading-relaxed mb-6">
                专为 Affiliate Marketer 打造的 Google Ads
                自动化投放平台。10分钟搞定投放，让每一分预算都发挥最大价值
              </p>
            </div>

            {/* Links Columns */}
            <div>
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">产品</h3>
              <ul className="space-y-3">
                <li><a href="#value" className="text-sm hover:text-white transition-colors">核心价值</a></li>
                <li><a href="#workflow" className="text-sm hover:text-white transition-colors">使用流程</a></li>
                <li><a href="#pricing" className="text-sm hover:text-white transition-colors">价格方案</a></li>
                <li><a href="#" className="text-sm hover:text-white transition-colors">更新日志</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">资源</h3>
              <ul className="space-y-3">
                <li><a href="#" className="text-sm hover:text-white transition-colors">帮助中心</a></li>
                <li><a href="#" className="text-sm hover:text-white transition-colors">投放教程</a></li>
                <li><a href="#testimonials" className="text-sm hover:text-white transition-colors">客户案例</a></li>
                <li><a href="#" className="text-sm hover:text-white transition-colors">社区论坛</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4">公司</h3>
              <ul className="space-y-3">
                <li><a href="#" className="text-sm hover:text-white transition-colors">关于我们</a></li>
                <li><a href="#" className="text-sm hover:text-white transition-colors">联系方式</a></li>
                <li><a href="#" className="text-sm hover:text-white transition-colors">隐私政策</a></li>
                <li><a href="#" className="text-sm hover:text-white transition-colors">服务条款</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-slate-900 text-center md:text-left flex flex-col md:flex-row justify-between items-center">
            <p className="text-sm text-slate-500">
              &copy; {new Date().getFullYear()} AutoAds. All rights reserved.
            </p>
            <div className="mt-4 md:mt-0 flex space-x-6">
              <a href="#" className="text-sm text-slate-500 hover:text-white transition-colors">隐私政策</a>
              <a href="#" className="text-sm text-slate-500 hover:text-white transition-colors">服务条款</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
