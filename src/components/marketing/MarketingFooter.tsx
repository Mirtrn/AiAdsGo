import React from "react";
import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="bg-[#080c18] text-white/40 py-16 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {/* Brand Column */}
          <div className="col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-5">
              <img src="/logo-white.svg" alt="AiAdsGo" className="h-8 w-auto" />
            </Link>
            <p className="text-sm leading-relaxed">
              专为 Affiliate Marketer 打造的 Google Ads
              自动化投放平台。让每一分预算都发挥最大价值。
            </p>
          </div>

          {/* Company Links */}
          <div>
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-4">公司</h3>
            <ul className="space-y-3">
              <li><Link href="/about" className="text-sm hover:text-white/70 transition-colors">关于我们</Link></li>
              <li><Link href="/contact" className="text-sm hover:text-white/70 transition-colors">联系方式</Link></li>
              <li><Link href="/privacy" className="text-sm hover:text-white/70 transition-colors">隐私政策</Link></li>
              <li><Link href="/terms" className="text-sm hover:text-white/70 transition-colors">服务条款</Link></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-4">联系我们</h3>
            <ul className="space-y-3">
              <li>
                <a href="mailto:support@aiadsgo.com" className="text-sm hover:text-white/70 transition-colors">
                  support@aiadsgo.com
                </a>
              </li>
              <li>
                <a href="mailto:legal@aiadsgo.com" className="text-sm hover:text-white/70 transition-colors">
                  legal@aiadsgo.com
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-white/25">
            &copy; {new Date().getFullYear()} AiAdsGo. All rights reserved.
          </p>
          <div className="flex space-x-6">
            <Link href="/privacy" className="text-xs text-white/25 hover:text-white/50 transition-colors">隐私政策</Link>
            <Link href="/terms" className="text-xs text-white/25 hover:text-white/50 transition-colors">服务条款</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
