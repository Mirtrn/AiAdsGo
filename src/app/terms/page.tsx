import React from "react";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const dynamic = 'force-dynamic';
export const metadata = pageMetadata.terms;

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white font-sans">
      <MarketingHeader />

      {/* Hero Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-violet-950 to-slate-900 pt-32 pb-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-violet-400 text-sm font-medium mb-3 tracking-wider uppercase">Legal</p>
          <h1 className="text-4xl font-bold text-white mb-4">服务条款</h1>
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
                title: "协议接受与适用范围",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-3 text-sm">
                      欢迎使用 AiAdsGo（以下简称"本平台"、"本服务"）。本服务条款（以下简称"本条款"）构成您与 AiAdsGo 运营团队之间具有法律约束力的协议，规范您对本平台所有功能、内容及服务的访问与使用。
                    </p>
                    <p className="text-slate-600 leading-relaxed mb-3 text-sm">
                      使用本服务即表示您已阅读、理解并同意接受本条款及本平台《隐私政策》的全部约束。如您代表企业或团队使用本服务，您声明并保证您有权代表该主体接受本条款。
                    </p>
                    <p className="text-slate-600 leading-relaxed text-sm">
                      如您不同意本条款的任何内容，请立即停止使用本服务并联系管理员关闭您的账户。
                    </p>
                  </>
                )
              },
              {
                num: "02",
                title: "服务描述",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      AiAdsGo 是一个专为 Affiliate Marketer 设计的 Google Ads 智能自动化投放平台，当前提供以下核心功能：
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3 mb-4">
                      {[
                        "AI 驱动的广告文案与创意生成",
                        "关键词研究、意图分析与推荐",
                        "Google Ads 广告系列批量创建与管理",
                        "投放数据实时分析与优化建议",
                        "Offer 批量管理与竞品分析",
                        "多账户 Google Ads 授权与连接",
                      ].map((item, i) => (
                        <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                          <span className="text-slate-700 text-sm">{item}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-slate-500 text-xs italic">
                      平台功能持续迭代更新，以实际可用功能为准。我们保留在不提前通知的情况下调整、新增或移除功能的权利。
                    </p>
                  </>
                )
              },
              {
                num: "03",
                title: "账户开通与管理",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      AiAdsGo 目前采用邀请制运营，账户由平台管理员统一审核开通，不支持公开自主注册。
                    </p>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      获得账户后，您承诺并保证：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        "您提供的账户关联信息真实、准确、完整",
                        "妥善保管您的登录凭证（用户名、密码、双因素验证信息等），不得泄露给任何第三方",
                        "对该账户下发生的全部操作行为承担责任，无论是否经您本人授权",
                        "不得将账户以任何形式转让、出借、出租、出售或共享给他人使用",
                        "发现账户被盗用、异常登录或任何安全事件时，立即通知管理员并修改密码",
                        "账户仅限于您本人或您所代表的团队在合法业务范围内使用",
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
                num: "04",
                title: "使用规范与禁止行为",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">使用本服务时，您明确同意不从事以下任何行为：</p>
                    <div className="space-y-2">
                      {[
                        "违反中华人民共和国或您所在地区任何适用的法律法规",
                        "侵犯他人的知识产权、商标权、专利权、著作权或其他合法权益",
                        "创建、发布虚假、误导性、欺诈性或侵权的广告内容",
                        "推广违禁产品、违规服务或任何违反 Google Ads 政策的内容",
                        "干扰、攻击、破坏或未经授权访问本平台的系统、服务器或网络",
                        "使用爬虫、脚本或自动化工具抓取、采集本平台数据",
                        "反编译、逆向工程、拆解或尝试提取本平台的源代码",
                        "绕过、破坏或干扰本平台的安全机制或访问控制",
                        "将账户或访问权限共享、转售或以任何方式提供给未授权的第三方",
                        "利用本平台实施任何形式的欺诈、洗钱或其他非法活动",
                        "发送垃圾邮件、进行钓鱼攻击或其他形式的网络骚扰",
                        "上传包含恶意代码、病毒或任何有害程序的文件",
                      ].map((item, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm text-slate-600">
                          <span className="text-red-400 shrink-0 mt-0.5 font-bold">×</span>
                          {item}
                        </div>
                      ))}
                    </div>
                    <p className="text-slate-500 text-xs mt-4 italic">
                      违反上述规范可能导致账户立即暂停或永久封禁，情节严重者我们保留追究法律责任的权利。
                    </p>
                  </>
                )
              },
              {
                num: "05",
                title: "Google Ads 使用合规",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      本平台通过 Google Ads API 与 Google 广告系统集成。在使用相关功能时，您额外承担以下义务：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        "您对通过本平台连接的 Google Ads 账户持有合法授权",
                        "您创建和投放的所有广告均符合 Google Ads 政策及相关法律法规",
                        "您负责管理您的 Google Ads 广告预算、出价和投放设置",
                        "因违反 Google Ads 政策导致的账户被封禁，本平台不承担任何责任",
                        "您授权本平台代表您通过 API 执行广告操作，该授权可随时在平台设置中撤销",
                        "您应定期检查 Google Ads 账户状态，确保各项合规要求均已满足",
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
                num: "06",
                title: "知识产权",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      本条款涉及两方面的知识产权归属：
                    </p>
                    <div className="space-y-3">
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                        <div className="font-semibold text-slate-800 text-sm mb-2">平台本身的知识产权</div>
                        <p className="text-slate-500 text-sm">本平台的所有内容，包括但不限于软件代码、界面设计、文字内容、商标标识、图形图标、数据模型及算法，均为 AiAdsGo 或其许可方的专有财产，受著作权、商标权及其他知识产权法律保护。未经书面许可，您不得以任何形式复制、修改、分发或商业利用上述内容。</p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                        <div className="font-semibold text-slate-800 text-sm mb-2">您的内容与数据</div>
                        <p className="text-slate-500 text-sm">您通过本平台创建的广告文案、关键词、Offer 数据及其他业务内容，其知识产权归您所有。您授予 AiAdsGo 一项有限的、非独占的、免版税的许可，允许我们在提供服务的必要范围内处理、存储和展示这些内容，此许可在您账户终止后自动失效。</p>
                      </div>
                    </div>
                  </>
                )
              },
              {
                num: "07",
                title: "保密义务",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      您在使用本平台过程中可能接触到的平台技术架构、算法逻辑、功能设计、定价策略、业务数据等信息，均属于 AiAdsGo 的保密信息。您承诺：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        "不得向任何第三方披露上述保密信息",
                        "仅将保密信息用于正当使用本服务的目的",
                        "采取与保护自身商业秘密相当的保护措施",
                        "账户终止后，上述保密义务仍持续有效",
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
                num: "08",
                title: "免责声明",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      本服务按"现状"（as-is）及"可用状态"（as-available）提供，不附带任何明示或暗示的保证。AiAdsGo 不对以下情况承担责任：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        "服务的中断、延迟、错误或数据丢失",
                        "您的广告创意在 Google Ads 平台的审核结果",
                        "您的广告投放效果、点击率或投资回报率",
                        "因您违反 Google Ads 政策或相关法律法规导致的账户封禁或损失",
                        "第三方服务（包括 Google Ads API）的不可用或功能变更",
                        "因不可抗力（自然灾害、网络故障、政府行为等）导致的服务中断",
                        "您设备、网络或浏览器兼容性问题引起的功能异常",
                        "您依赖本平台提供的建议或分析结果所做的业务决策",
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
                title: "责任限制",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      在法律允许的最大范围内，AiAdsGo 及其管理人员、员工、合作方对以下损失不承担责任：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        "任何间接损失、附带损失、特殊损失、惩罚性损失或后果性损失",
                        "利润损失、数据丢失、商誉损害或业务机会丧失",
                        "任何超出合理预见范围的损失",
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-violet-500 shrink-0 mt-0.5">·</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                    <p className="text-slate-500 text-xs mt-4 italic">
                      部分司法管辖区不允许排除某些担保或限制某些损害赔偿，上述限制可能对您不完全适用。
                    </p>
                  </>
                )
              },
              {
                num: "10",
                title: "您的赔偿责任",
                content: (
                  <p className="text-slate-600 leading-relaxed text-sm">
                    您同意为 AiAdsGo 及其管理人员、员工、合作方进行辩护并赔偿其损失，使其免受因以下原因产生的任何索赔、损失、费用（包括合理的律师费）：
                    （1）您违反本条款的任何规定；
                    （2）您使用本服务的行为；
                    （3）您侵犯任何第三方权利，包括但不限于知识产权或隐私权；
                    （4）您通过本平台投放的广告内容违反相关法律法规或平台政策。
                  </p>
                )
              },
              {
                num: "11",
                title: "服务变更、暂停与终止",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      AiAdsGo 保留以下权利：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        "随时对服务功能、界面及内容进行修改、升级或迭代",
                        "在不提前通知的情况下暂停或终止部分功能",
                        "因技术维护、安全事件或不可抗力临时中断服务",
                        "因您违反本条款而立即暂停或永久终止您的账户，无需承担赔偿责任",
                        "在业务调整的情况下，提前 30 天通知用户，整体终止本服务的运营",
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-violet-500 shrink-0 mt-0.5">·</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                    <p className="text-slate-500 text-xs mt-4 italic">
                      账户终止后，您在平台上存储的数据将在 90 天内删除，请提前自行备份必要数据。
                    </p>
                  </>
                )
              },
              {
                num: "12",
                title: "条款修改",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      我们可能因业务发展、法规变化或功能调整等原因修改本条款：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        '更新后的条款将在本页面发布，并更新顶部的「最后更新日期」',
                        "对于涉及您重要权利的重大变更，我们将通过邮件提前 30 天通知",
                        "在通知期届满后继续使用本服务，视为您接受更新后的条款",
                        "如您不接受新条款，请在生效前联系管理员停用账户",
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
                title: "适用法律与争议解决",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      本条款受中华人民共和国法律管辖并据此解释，不考虑法律冲突规则。因本条款或本服务引起或与之相关的任何争议，各方应遵循以下流程：
                    </p>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        ["友好协商", "争议发生后，双方应首先尝试通过友好协商解决，协商期为 30 日"],
                        ["书面通知", "如需正式启动争议程序，请以书面形式通过 legal@aiadsgo.com 发送争议通知"],
                        ["司法诉讼", "协商不成时，任何一方均可向 AiAdsGo 注册地（中国江苏省）有管辖权的人民法院提起诉讼"],
                      ].map(([k, v], i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-violet-500 shrink-0 mt-0.5">·</span>
                          <span><strong className="text-slate-800">{k}</strong>：{v}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )
              },
              {
                num: "14",
                title: "其他条款",
                content: (
                  <>
                    <ul className="space-y-2 text-sm text-slate-600">
                      {[
                        ["完整协议", "本条款与《隐私政策》共同构成您与 AiAdsGo 之间关于本服务的完整协议，取代此前一切口头或书面协议"],
                        ["条款可分割性", "若本条款中任何条款被认定为无效或不可执行，该条款将以最接近原意的有效条款替代，其余条款继续有效"],
                        ["不放弃权利", "AiAdsGo 未能执行本条款的任何规定，不构成对该规定的放弃"],
                        ["标题仅供参考", "各章节标题仅为便于阅读而设，不具有法律效力"],
                        ["语言版本", "本条款以中文版本为准，如有其他语言版本存在歧义，以中文版本为准"],
                      ].map(([k, v], i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-violet-500 shrink-0 mt-0.5">·</span>
                          <span><strong className="text-slate-800">{k}</strong>：{v}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )
              },
              {
                num: "15",
                title: "联系方式",
                content: (
                  <>
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm">
                      如您对本服务条款有任何疑问、意见或需要法律事务支持，请通过以下方式联系我们：
                    </p>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2 text-sm text-slate-600">
                      <p>· 法律事务邮箱：<a href="mailto:legal@aiadsgo.com" className="text-violet-600 hover:text-violet-700 font-medium transition-colors">legal@aiadsgo.com</a></p>
                      <p>· 一般支持邮箱：<a href="mailto:support@aiadsgo.com" className="text-violet-600 hover:text-violet-700 font-medium transition-colors">support@aiadsgo.com</a></p>
                      <p>· 联系地址：中国 · 江苏</p>
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
