export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">
          AutoAds - AI广告自动化投放系统
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          基于AI的Google Ads广告自动化创建、优化和管理平台
        </p>
        <div className="flex gap-4 justify-center">
          <a
            href="/login"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            登录
          </a>
          <a
            href="/register"
            className="px-6 py-3 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition"
          >
            注册
          </a>
        </div>
      </div>
    </main>
  )
}
