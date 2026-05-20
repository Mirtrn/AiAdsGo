import React from "react";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { Target, Zap, Users, TrendingUp } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const dynamic = 'force-dynamic';
export const metadata = pageMetadata.about;

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white font-sans">
      <MarketingHeader />

      {/* Hero Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-violet-950 to-slate-900 pt-32 pb-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-violet-400 text-sm font-medium mb-4 tracking-wider uppercase">About Us</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-5">关于 AiAdsGo</h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto leading-relaxed">
            我们致力于让 Google Ads 投放变得简单、高效、智能
          </p>
        </div>
      </div>

      <main className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Mission */}
          <section className="mb-20">
            <div className="flex items-center gap-3 mb-8">
              <span className="w-1 h-6 bg-violet-500 rounded-full" />
              <h2 className="text-2xl font-bold text-slate-900">我们的使命</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-4 text-slate-600 leading-relaxed">
                <p>
                  AiAdsGo 诞生于一个简单的想法：<strong className="text-slate-900">让每一位 Affiliate Marketer 都能轻松驾驭 Google Ads</strong>。
                </p>
                <p>
                  我们深知，传统的广告投放流程繁琐、耗时，需要大量的专业知识和经验。
                  很多优秀的产品因为缺乏有效的推广而被埋没，很多有潜力的营销人员因为技术门槛而望而却步。
                </p>
                <p>
                  AiAdsGo 的目标是打破这些壁垒，通过 AI 技术和自动化流程，
                  让广告投放从"技术活"变成"简单事"，让每一分预算都能发挥最大价值。
                </p>
              </div>
              <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-2xl p-6 border border-violet-100 flex flex-col justify-center">
                <div className="text-4xl font-black text-violet-600 mb-2">10min</div>
                <div className="text-slate-600 text-sm">从链接到广告上线<br />全程不超过10分钟</div>
              </div>
            </div>
          </section>

          {/* Values */}
          <section className="mb-20">
            <div className="flex items-center gap-3 mb-8">
              <span className="w-1 h-6 bg-violet-500 rounded-full" />
              <h2 className="text-2xl font-bold text-slate-900">核心价值观</h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {[
                {
                  icon: Target,
                  title: "效率至上",
                  description: "将原本需要数小时的工作压缩到10分钟内完成。",
                  color: "violet"
                },
                {
                  icon: Zap,
                  title: "智能驱动",
                  description: "AI 自动生成高质量广告文案，智能优化投放策略。",
                  color: "indigo"
                },
                {
                  icon: Users,
                  title: "用户为本",
                  description: "每个功能都以用户需求为出发点，追求极致体验。",
                  color: "violet"
                },
                {
                  icon: TrendingUp,
                  title: "持续创新",
                  description: "紧跟行业趋势，不断迭代，提供最前沿的工具。",
                  color: "indigo"
                }
              ].map((value, idx) => (
                <div key={idx} className="group border border-slate-200 rounded-2xl p-6 hover:border-violet-300 hover:shadow-lg hover:shadow-violet-500/10 transition-all">
                  <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center mb-4 group-hover:bg-violet-600 transition-colors">
                    <value.icon className="w-5 h-5 text-violet-600 group-hover:text-white transition-colors" />
                  </div>
                  <h3 className="font-bold text-slate-900 mb-2">{value.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{value.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Team */}
          <section className="mb-20">
            <div className="flex items-center gap-3 mb-8">
              <span className="w-1 h-6 bg-violet-500 rounded-full" />
              <h2 className="text-2xl font-bold text-slate-900">我们的团队</h2>
            </div>
            <div className="bg-slate-900 rounded-2xl p-8 md:p-12 text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-violet-600/20 rounded-full blur-[80px] pointer-events-none" />
              <div className="relative space-y-4 text-slate-300 leading-relaxed">
                <p>
                  AiAdsGo 团队由一群热爱技术、深耕数字营销领域的专业人士组成。
                  我们拥有丰富的 Google Ads 投放经验和 AI 技术背景，
                  深刻理解 Affiliate Marketer 的痛点和需求。
                </p>
                <p>
                  我们不仅是产品的开发者，更是产品的使用者。
                  我们用自己的实战经验打磨每一个功能，确保 AiAdsGo 真正解决实际问题。
                </p>
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="text-center py-12 border-t border-slate-100">
            <h2 className="text-2xl font-bold text-slate-900 mb-3">准备好开始了吗？</h2>
            <p className="text-slate-500 mb-8">加入专业玩家，体验 AI 驱动的广告投放</p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-full transition-all shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 hover:-translate-y-0.5"
            >
              开始使用
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </section>

        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
