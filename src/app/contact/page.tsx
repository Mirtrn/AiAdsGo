import React from "react";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { Mail, MessageCircle, Clock, MapPin } from "lucide-react";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const dynamic = 'force-dynamic';
export const metadata = pageMetadata.contact;

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white font-sans">
      <MarketingHeader />

      {/* Hero Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-violet-950 to-slate-900 pt-32 pb-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-violet-400 text-sm font-medium mb-4 tracking-wider uppercase">Contact</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-5">联系我们</h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            有任何问题或建议？我们随时准备为您提供帮助
          </p>
        </div>
      </div>

      <main className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Contact Cards */}
          <section className="mb-20">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {[
                {
                  icon: Mail,
                  title: "邮件咨询",
                  desc: "发送邮件，我们将在 24 小时内回复",
                  value: "support@aiadsgo.com",
                  href: "mailto:support@aiadsgo.com",
                  isLink: true,
                },
                {
                  icon: MessageCircle,
                  title: "微信客服",
                  desc: "添加微信，获取一对一快速支持",
                  value: "目前无微信号",
                  isLink: false,
                },
                {
                  icon: Clock,
                  title: "服务时间",
                  desc: "客服团队在线时间",
                  value: "周一至周五 09:00–18:00",
                  isLink: false,
                },
                {
                  icon: MapPin,
                  title: "公司地址",
                  desc: "欢迎来访，请提前预约",
                  value: "中国 · 江苏",
                  isLink: false,
                },
              ].map((item, idx) => (
                <div key={idx} className="group border border-slate-200 rounded-2xl p-6 hover:border-violet-300 hover:shadow-lg hover:shadow-violet-500/10 transition-all">
                  <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center mb-4 group-hover:bg-violet-600 transition-colors">
                    <item.icon className="w-5 h-5 text-violet-600 group-hover:text-white transition-colors" />
                  </div>
                  <h3 className="font-bold text-slate-900 mb-1">{item.title}</h3>
                  <p className="text-slate-400 text-xs mb-3">{item.desc}</p>
                  {item.isLink ? (
                    <a href={item.href} className="text-violet-600 hover:text-violet-700 font-medium text-sm transition-colors">
                      {item.value}
                    </a>
                  ) : (
                    <span className="text-slate-700 font-medium text-sm">{item.value}</span>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section className="mb-20">
            <div className="flex items-center gap-3 mb-8">
              <span className="w-1 h-6 bg-violet-500 rounded-full" />
              <h2 className="text-2xl font-bold text-slate-900">常见问题</h2>
            </div>
            <div className="space-y-4">
              {[
                {
                  q: "如何开始使用 AiAdsGo？",
                  a: "联系管理员开通账号后，您可以立即开始使用。只需粘贴您的推广链接，AI 将自动生成广告文案。"
                },
                {
                  q: "如何获取技术支持？",
                  a: "您可以通过邮件联系我们的客服团队，我们将在 24 小时内为您提供帮助。"
                },
                {
                  q: "数据安全如何保障？",
                  a: "我们采用行业标准的加密技术保护您的数据，所有传输均通过 SSL/TLS 加密，数据存储经过严格的安全审计。"
                },
                {
                  q: "是否支持团队协作？",
                  a: "目前每个账号独立使用。如需多人协作方案，请联系我们进行定制化配置。"
                }
              ].map((faq, idx) => (
                <div key={idx} className="border border-slate-200 rounded-2xl p-6 hover:border-violet-200 transition-colors">
                  <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center text-xs font-bold shrink-0">Q</span>
                    {faq.q}
                  </h3>
                  <p className="text-slate-500 text-sm leading-relaxed pl-9">{faq.a}</p>
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="bg-slate-900 rounded-2xl p-8 md:p-12 text-center relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-violet-600/30 rounded-full blur-[60px] pointer-events-none" />
            <div className="relative">
              <h2 className="text-2xl font-bold text-white mb-3">还有其他问题？</h2>
              <p className="text-slate-400 mb-8 text-sm">我们的团队随时准备为您解答</p>
              <a
                href="mailto:support@aiadsgo.com"
                className="inline-flex items-center gap-2 px-8 py-3.5 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-full transition-all shadow-lg shadow-violet-500/30 hover:shadow-violet-500/40 hover:-translate-y-0.5"
              >
                <Mail className="w-4 h-4" />
                发送邮件
              </a>
            </div>
          </section>

        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
