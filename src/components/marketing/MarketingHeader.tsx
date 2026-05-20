import Link from "next/link";

export function MarketingHeader() {
  return (
    <header className="fixed top-0 w-full bg-white/90 backdrop-blur-xl z-50 border-b border-slate-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo.svg" alt="AiAdsGo" className="h-8 w-auto" />
          </Link>
          <div className="flex items-center gap-4">
            <a href="/login" className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
              登录
            </a>
            <a
              href="/login"
              className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-full transition-all shadow-md shadow-violet-500/20 hover:shadow-violet-500/30 hover:-translate-y-0.5"
            >
              开始使用
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
