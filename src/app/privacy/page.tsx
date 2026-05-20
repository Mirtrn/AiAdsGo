import React from "react";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const dynamic = 'force-dynamic';
export const metadata = pageMetadata.privacy;

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white font-sans">
      <MarketingHeader />

      {/* Hero Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-violet-950 to-slate-900 pt-32 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-violet-400 text-sm font-medium mb-3 tracking-wider uppercase">Legal</p>
          <h1 className="text-4xl font-bold text-white mb-4">隐私政策</h1>
          <p className="text-slate-400 text-base">最后更新日期：2026年5月19日</p>
        </div>
      </div>

      {/* Content */}
      <main className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="divide-y divide-slate-100">

            {[
              {
                num: "01",
                title: "概述与引言",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-3 text-sm">
                      AiAdsGo（以下简称"我们"、"本平台"）非常重视用户的隐私保护。本隐私政策适用于您通过 AiAdsGo 平台（网址：aiadsgo.com）及其相关服务使用过程中产生的个人数据处理行为。
                    </p>
                    <p className="text-slate-600 leading-relaxed mb-3 text-sm">
                      本政策旨在向您清晰说明我们收集哪些信息、为什么收集、如何使用及保护这些信息，以及您对自己数据享有哪些权利。
                    </p>
                    <p className="text-slate-600 leading-relaxed text-sm">
                      使用我们的服务即表示您已阅读并同意本隐私政策中描述的数据处理方式。如您不同意本政策的任何部分，请停止使用我们的服务。
                    </p>
                  </>
                )
              },
              {
                num: "02",
                title: "数据控制者信息",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      本平台的数据控制者为 AiAdsGo 运营团队，注册地址位于中国江苏省。
                    </p>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 text-sm text-slate-600 space-y-2">
                      <p>· 平台名称：AiAdsGo</p>
                      <p>· 经营主体：AiAdsGo 运营团队</p>
                      <p>· 注册地：中国 · 江苏</p>
                      <p>· 隐私事务联系邮箱：<a href="mailto:privacy@aiadsgo.com" className="text-violet-600 hover:text-violet-700 font-medium transition-colors">privacy@aiadsgo.com</a></p>
                    </div>
                  </>
                )
              },
              {
                num: "03",
                title: "我们收集的信息",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">我们可能在以下场景中收集您的相关信息：</p>
                    <div className="space-y-3">
                      {[
                        {
                          label: "账户信息",
                          desc: "管理员在为您开通账户时录入的用户名、电子邮箱地址、所属团队或组织名称等基础身份信息。"
                        },
                        {
                          label: "使用数据",
                          desc: "您在平台上执行的操作记录，包括登录时间、功能访问路径、广告任务创建与修改记录、接口调用日志等。"
                        },
                        {
                          label: "设备与网络信息",
                          desc: "您访问平台时的浏览器类型与版本、操作系统、IP 地址、设备标识符、访问时间戳及来源页面等技术信息。"
                        },
                        {
                          label: "广告业务数据",
                          desc: "您通过平台创建的广告内容、关键词、落地页链接、Offer 信息、投放参数、广告系列结构及相关分析数据等。"
                        },
                        {
                          label: "通信内容",
                          desc: "您通过邮件或平台内联系渠道向我们发送的问题、反馈或请求内容。"
                        },
                        {
                          label: "自动收集信息",
                          desc: "通过 Cookie、本地存储及类似技术自动收集的会话信息、偏好设置和使用行为数据。"
                        },
                      ].map((item, i) => (
                        <div key={i} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                          <div className="font-semibold text-slate-800 text-sm mb-1">{item.label}</div>
                          <div className="text-slate-500 text-sm">{item.desc}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-slate-500 text-xs mt-4 italic">注：本平台目前无收费功能，不收集任何支付信息。</p>
                  </>
                )
              },
              {
                num: "04",
                title: "信息的使用目的",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">我们收集您的信息，仅用于以下合法目的：</p>
                    <ul className="space-y-2">
                      {[
                        "提供、运行、维护和改进平台的核心功能与服务质量",
                        "验证您的账户身份，保障账户与数据安全",
                        "向您发送服务相关的技术通知、系统更新、安全警报及操作提醒",
                        "响应您通过邮件或平台渠道提交的问题、反馈与支持请求",
                        "统计分析平台整体使用趋势，优化产品功能与用户体验",
                        "检测、识别并处置技术异常、安全漏洞或违规行为",
                        "遵守适用的法律法规及配合监管机构的合法要求",
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-3 text-slate-600 text-sm">
                          <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">{i + 1}</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                    <p className="text-slate-500 text-xs mt-4 italic">我们不会将您的个人信息用于定向广告投放或出售给第三方营销机构。</p>
                  </>
                )
              },
              {
                num: "05",
                title: "信息共享与披露",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      我们不会出售、出租或以商业目的交易您的个人信息。以下情形下，我们可能依法共享必要的信息：
                    </p>
                    <ul className="space-y-3 text-sm text-slate-600">
                      {[
                        ["技术服务提供商", "与支撑平台运行的基础设施服务商（如云托管、数据库、安全服务）共享运营所需的最小范围数据，这些服务商受保密协议约束。"],
                        ["Google Ads API", "为实现广告投放功能，您的广告业务数据将通过 Google Ads API 传送至 Google 平台，该过程受 Google 隐私政策约束。"],
                        ["法律要求", "当我们受法律、法规或政府主管机关的合法命令要求时，或为保护 AiAdsGo 的合法权益时。"],
                        ["业务转让", "在公司合并、重组、资产收购或出售等情形下，您的信息可能作为业务资产一并转移，届时我们将提前告知您。"],
                        ["安全保护", "为防止欺诈、保护用户或公共安全，在认为必要时与相关方共享信息。"],
                        ["您的明确同意", "在您知情并明确授权的情况下，与其他您指定的方共享。"],
                      ].map(([k, v], i) => (
                        <li key={i} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                          <div className="font-semibold text-slate-800 mb-1">{k}</div>
                          <div className="text-slate-500">{v}</div>
                        </li>
                      ))}
                    </ul>
                  </>
                )
              },
              {
                num: "06",
                title: "Cookie 与跟踪技术",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      我们使用 Cookie 和类似的本地存储技术来支撑平台功能运行并改善用户体验。具体用途如下：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        ["必要性 Cookie", "用于维持您的登录会话状态，确保平台基本功能正常运行，无法被禁用。"],
                        ["功能性 Cookie", "记录您的界面偏好（如语言、布局设置），以便下次访问时自动恢复。"],
                        ["分析性 Cookie", "帮助我们了解用户如何使用平台，用于改进功能和性能，数据经匿名化处理。"],
                      ].map(([k, v], i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-violet-500 shrink-0 mt-0.5">·</span>
                          <span><strong className="text-slate-800">{k}</strong>：{v}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-slate-500 text-xs mt-4 italic">您可以通过浏览器设置管理 Cookie 偏好，但禁用某些 Cookie 可能导致平台功能受限。</p>
                  </>
                )
              },
              {
                num: "07",
                title: "数据存储与安全",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      我们采取行业标准的技术和管理措施保护您的个人信息：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        "所有数据传输均使用 TLS 1.2+ 加密，防止中间人截获",
                        "敏感数据在数据库中采用加密存储，密钥单独管理",
                        "定期开展安全审计、渗透测试和漏洞扫描",
                        "实行最小权限原则，严格控制员工访问个人数据的权限范围",
                        "所有内部数据访问行为均有日志记录，便于审计追溯",
                        "生产环境与开发测试环境严格隔离",
                        "数据定期备份，具备灾难恢复能力",
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-violet-500 shrink-0 mt-0.5">·</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                    <p className="text-slate-500 text-xs mt-4 italic">尽管我们努力保护您的信息，但任何互联网传输或电子存储方式均无法保证 100% 安全。如发生数据安全事件，我们将依法及时通知受影响的用户。</p>
                  </>
                )
              },
              {
                num: "08",
                title: "数据保留期限",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      我们仅在实现收集目的所必要的期限内保留您的个人信息：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        "账户处于活跃状态期间，我们持续保留您的账户信息和业务数据",
                        "账户被停用或注销后，通常在 90 天内完成数据删除或匿名化处理",
                        "操作日志类数据最长保留 12 个月，用于安全审计和问题排查",
                        "法律法规要求保留的数据，我们将按规定期限保存后再行删除",
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-violet-500 shrink-0 mt-0.5">·</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </>
                )
              },
              {
                num: "09",
                title: "跨境数据传输",
                content: (
                  <p className="text-slate-600 leading-relaxed text-sm">
                    由于我们的服务涉及 Google Ads API（美国）等境外服务提供商，您的部分数据可能在中华人民共和国境外处理和存储。
                    我们将通过签署数据处理协议或采用其他法律允许的机制，确保此类跨境传输符合适用法规的要求，并为您的数据提供与境内同等水平的保护。
                  </p>
                )
              },
              {
                num: "10",
                title: "您的权利",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      根据适用的数据保护法律，您对自己的个人信息享有以下权利：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        ["知情权", "了解我们收集哪些数据、如何使用以及与谁共享"],
                        ["访问权", "请求获取我们持有的您的个人信息副本"],
                        ["更正权", "请求纠正不准确或不完整的个人信息"],
                        ["删除权", "在符合法律规定的情形下，请求删除您的个人信息"],
                        ["数据可携带权", "以机器可读格式接收您提供的数据，并传输至其他服务商"],
                        ["限制处理权", "在特定情形下，请求我们暂停处理您的个人信息"],
                        ["反对权", "基于您的特殊情况，反对我们对您数据的某些处理行为"],
                        ["撤回同意权", "对于基于同意的数据处理，随时撤回您的授权（不影响撤回前的处理合法性）"],
                      ].map(([k, v], i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-violet-500 shrink-0 mt-0.5">·</span>
                          <span><strong className="text-slate-800">{k}</strong>：{v}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-slate-500 text-xs mt-4 italic">如需行使上述权利，请发送邮件至 privacy@aiadsgo.com，我们将在收到请求后 30 个工作日内予以回复。</p>
                  </>
                )
              },
              {
                num: "11",
                title: "未成年人保护",
                content: (
                  <p className="text-slate-600 leading-relaxed text-sm">
                    本平台的服务对象为具备完全民事行为能力的成年用户（18周岁及以上的企业或个人用户）。
                    我们不会故意收集未成年人的个人信息。账户由管理员统一开通，我们要求管理员确保所有获授权用户均满足年龄要求。
                    若发现我们无意中收集了未成年人信息，请立即联系我们，我们将尽快予以删除。
                  </p>
                )
              },
              {
                num: "12",
                title: "第三方服务与链接",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-3 text-sm">
                      本平台集成或链接的第三方服务（包括 Google Ads、Google Analytics 等）拥有独立的隐私政策，我们建议您阅读这些政策：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        "Google 隐私政策：https://policies.google.com/privacy",
                        "对于第三方平台上的数据处理，我们不承担控制者责任",
                        "本平台不负责第三方网站或服务的隐私实践",
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-violet-500 shrink-0 mt-0.5">·</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </>
                )
              },
              {
                num: "13",
                title: "政策更新",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-3 text-sm">
                      我们可能因业务发展、法规变化或功能调整等原因更新本隐私政策。
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        '更新后的政策将在本页面发布，并更新顶部的「最后更新日期」',
                        "若变更涉及您权利的重大调整，我们将通过邮件提前 30 天告知",
                        "继续使用本服务，视为您接受更新后的隐私政策",
                        "建议您定期查阅本页面，了解最新的隐私保护措施",
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-violet-500 shrink-0 mt-0.5">·</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </>
                )
              },
              {
                num: "14",
                title: "联系我们",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      如您对本隐私政策有任何疑问、意见或希望行使您的数据权利，请通过以下方式联系我们：
                    </p>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2 text-sm text-slate-600">
                      <p>· 隐私事务邮箱：<a href="mailto:privacy@aiadsgo.com" className="text-violet-600 hover:text-violet-700 font-medium transition-colors">privacy@aiadsgo.com</a></p>
                      <p>· 一般支持邮箱：<a href="mailto:support@aiadsgo.com" className="text-violet-600 hover:text-violet-700 font-medium transition-colors">support@aiadsgo.com</a></p>
                      <p>· 我们承诺在收到您的请求后 <strong className="text-slate-800">30 个工作日内</strong>予以回复</p>
                    </div>
                  </>
                )
              },
            ].map((section) => (
              <div key={section.num} className="py-10 flex gap-8">
                <div className="w-12 shrink-0">
                  <span className="text-2xl font-black text-slate-100">{section.num}</span>
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-3">
                    <span className="w-1 h-5 bg-violet-500 rounded-full shrink-0" />
                    {section.title}
                  </h2>
                  {section.content}
                </div>
              </div>
            ))}

          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
