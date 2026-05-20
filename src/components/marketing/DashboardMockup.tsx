"use client";

import { useState, type ReactNode } from "react";
import { Zap, BarChart3, Globe2, ShieldCheck, Rocket, Bot, Plus } from "lucide-react";

const navItems = [
  { label: "仪表盘", key: "dashboard" },
  { label: "Offer 管理", key: "offers" },
  { label: "广告系列", key: "campaigns" },
  { label: "创意管理", key: "creatives" },
  { label: "关键词", key: "keywords" },
  { label: "数据分析", key: "analytics" },
];

function DashboardPage() {
  return (
    <div className="flex-1 p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-white font-semibold text-base">仪表盘</h3>
          <p className="text-white/30 text-xs mt-0.5">今日数据概览</p>
        </div>
        <button className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5 transition-colors">
          <Zap className="w-3 h-3" /> 新建 Offer
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: "活跃 Offer", value: "12", change: "+3 今日", color: "text-violet-400" },
          { label: "广告展示量", value: "8,420", change: "+12.4%", color: "text-cyan-400" },
          { label: "转化率", value: "3.8%", change: "+0.6%", color: "text-emerald-400" },
        ].map((card) => (
          <div key={card.label} className="bg-white/[0.04] border border-white/5 rounded-xl p-3">
            <div className="text-white/40 text-xs mb-2">{card.label}</div>
            <div className={`text-xl font-bold ${card.color}`}>{card.value}</div>
            <div className="text-emerald-400 text-xs mt-1">{card.change}</div>
          </div>
        ))}
      </div>
      <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden">
        <div className="border-b border-white/5 px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs text-white/50 font-medium">最近 Offer</span>
          <span className="text-xs text-violet-400 cursor-pointer hover:text-violet-300">查看全部 →</span>
        </div>
        {[
          { name: "MacBook Pro M4", status: "投放中", ctr: "4.2%", green: true },
          { name: "Nike Air Max 2025", status: "审核中", ctr: "—", green: false },
          { name: "Sony WH-1000XM6", status: "投放中", ctr: "3.1%", green: true },
        ].map((row) => (
          <div key={row.name} className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors">
            <span className="text-xs text-white/70">{row.name}</span>
            <div className="flex items-center gap-4">
              <span className="text-xs text-white/30">{row.ctr}</span>
              <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${row.green ? "bg-emerald-500/10" : "bg-yellow-500/10"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${row.green ? "bg-emerald-500" : "bg-yellow-500"}`} />
                <span className={`text-xs ${row.green ? "text-emerald-400" : "text-yellow-400"}`}>{row.status}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OffersPage() {
  return (
    <div className="flex-1 p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-white font-semibold text-base">Offer 管理</h3>
          <p className="text-white/30 text-xs mt-0.5">共 12 个活跃 Offer</p>
        </div>
        <button className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5 transition-colors">
          <Plus className="w-3 h-3" /> 添加 Offer
        </button>
      </div>
      <div className="bg-white/[0.03] border border-white/5 rounded-xl overflow-hidden">
        <div className="border-b border-white/5 px-4 py-2.5 grid grid-cols-4 text-xs text-white/30 font-medium">
          <span>产品名称</span><span>落地页</span><span>CTR</span><span>状态</span>
        </div>
        {[
          { name: "MacBook Pro M4", url: "apple.com/macbook-pro", ctr: "4.2%", green: true, status: "投放中" },
          { name: "Nike Air Max 2025", url: "nike.com/air-max", ctr: "—", green: false, status: "审核中" },
          { name: "Sony WH-1000XM6", url: "sony.com/headphones", ctr: "3.1%", green: true, status: "投放中" },
          { name: "iPad Pro M4", url: "apple.com/ipad-pro", ctr: "2.8%", green: true, status: "投放中" },
        ].map((row) => (
          <div key={row.name} className="grid grid-cols-4 items-center px-4 py-3 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors">
            <span className="text-xs text-white/80 font-medium">{row.name}</span>
            <span className="text-xs text-white/30 truncate">{row.url}</span>
            <span className="text-xs text-cyan-400">{row.ctr}</span>
            <div className={`flex items-center gap-1.5 w-fit px-2 py-0.5 rounded-full ${row.green ? "bg-emerald-500/10" : "bg-yellow-500/10"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${row.green ? "bg-emerald-500" : "bg-yellow-500"}`} />
              <span className={`text-xs ${row.green ? "text-emerald-400" : "text-yellow-400"}`}>{row.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CampaignsPage() {
  return (
    <div className="flex-1 p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-white font-semibold text-base">广告系列</h3>
          <p className="text-white/30 text-xs mt-0.5">5 个正在投放</p>
        </div>
        <button className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5 transition-colors">
          <Rocket className="w-3 h-3" /> 新建系列
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { name: "MacBook Pro - 美国", budget: "$50/天", impressions: "12,400", spend: "$38.2", status: "投放中", green: true },
          { name: "Nike Air Max - 英国", budget: "$30/天", impressions: "8,200", spend: "$22.1", status: "投放中", green: true },
          { name: "Sony 耳机 - 德国", budget: "$20/天", impressions: "5,600", spend: "$15.8", status: "投放中", green: true },
          { name: "iPad Pro - 日本", budget: "$40/天", impressions: "—", spend: "—", status: "审核中", green: false },
        ].map((c) => (
          <div key={c.name} className="bg-white/[0.04] border border-white/5 rounded-xl p-4 hover:bg-white/[0.06] cursor-pointer transition-colors">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-white/80 font-medium">{c.name}</span>
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${c.green ? "bg-emerald-500/10 text-emerald-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${c.green ? "bg-emerald-500" : "bg-yellow-500"}`} />
                {c.status}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><div className="text-white/30 text-xs">预算</div><div className="text-xs text-white/70 mt-1">{c.budget}</div></div>
              <div><div className="text-white/30 text-xs">展示量</div><div className="text-xs text-cyan-400 mt-1">{c.impressions}</div></div>
              <div><div className="text-white/30 text-xs">消耗</div><div className="text-xs text-violet-400 mt-1">{c.spend}</div></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreativesPage() {
  return (
    <div className="flex-1 p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-white font-semibold text-base">创意管理</h3>
          <p className="text-white/30 text-xs mt-0.5">AI 已生成 48 组广告素材</p>
        </div>
        <button className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-semibold text-white flex items-center gap-1.5 transition-colors">
          <Bot className="w-3 h-3" /> AI 生成
        </button>
      </div>
      <div className="space-y-3">
        {[
          { title: "MacBook Pro M4 - 标题组 A", headlines: 15, descs: 4, score: 92, color: "text-emerald-400" },
          { title: "Nike Air Max - 标题组 B", headlines: 12, descs: 3, score: 78, color: "text-yellow-400" },
          { title: "Sony WH-1000XM6 - 标题组 A", headlines: 15, descs: 4, score: 88, color: "text-emerald-400" },
        ].map((c) => (
          <div key={c.title} className="bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 flex items-center justify-between hover:bg-white/[0.05] cursor-pointer transition-colors">
            <div>
              <div className="text-xs text-white/80 font-medium mb-1">{c.title}</div>
              <div className="text-xs text-white/30">{c.headlines} 个标题 · {c.descs} 个描述</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-white/30 mb-1">质量分</div>
              <div className={`text-lg font-bold ${c.color}`}>{c.score}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsPage() {
  return (
    <div className="flex-1 p-6 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-white font-semibold text-base">数据分析</h3>
          <p className="text-white/30 text-xs mt-0.5">近 7 天表现</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { label: "总展示量", value: "58,240", icon: <BarChart3 className="w-4 h-4 text-cyan-400" />, change: "+18.3%" },
          { label: "总点击量", value: "2,140", icon: <Globe2 className="w-4 h-4 text-violet-400" />, change: "+9.6%" },
          { label: "平均 CPC", value: "$0.82", icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />, change: "-5.2%" },
          { label: "总转化", value: "312", icon: <Rocket className="w-4 h-4 text-orange-400" />, change: "+21.4%" },
        ].map((s) => (
          <div key={s.label} className="bg-white/[0.04] border border-white/5 rounded-xl p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center">{s.icon}</div>
            <div>
              <div className="text-white/40 text-xs">{s.label}</div>
              <div className="text-white text-sm font-bold">{s.value}</div>
              <div className={`text-xs ${s.change.startsWith("+") ? "text-emerald-400" : "text-red-400"}`}>{s.change}</div>
            </div>
          </div>
        ))}
      </div>
      {/* Simple bar chart */}
      <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
        <div className="text-xs text-white/40 mb-3">近 7 天点击量</div>
        <div className="flex items-end gap-2 h-16">
          {[40, 65, 55, 80, 70, 90, 75].map((h, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full rounded-sm bg-gradient-to-t from-violet-600 to-indigo-500 opacity-80"
                style={{ height: `${h}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-2 text-xs text-white/20">
          {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DashboardMockup() {
  const [active, setActive] = useState("dashboard");

  const pages: Record<string, ReactNode> = {
    dashboard: <DashboardPage />,
    offers: <OffersPage />,
    campaigns: <CampaignsPage />,
    creatives: <CreativesPage />,
    keywords: <DashboardPage />,
    analytics: <AnalyticsPage />,
  };

  return (
    <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-violet-900/30 bg-[#0d1117]">
      {/* Browser bar */}
      <div className="h-9 bg-[#161b22] border-b border-white/10 flex items-center px-4 gap-2">
        <span className="w-3 h-3 rounded-full bg-red-500/60" />
        <span className="w-3 h-3 rounded-full bg-yellow-500/60" />
        <span className="w-3 h-3 rounded-full bg-green-500/60" />
        <span className="ml-4 text-xs text-white/25 font-mono">app.aiadsgo.com / {active}</span>
      </div>

      {/* App shell */}
      <div className="flex h-[420px] text-sm">
        {/* Sidebar */}
        <div className="w-52 bg-[#0d1117] border-r border-white/5 flex flex-col p-4 gap-1 flex-shrink-0">
          <div className="flex items-center gap-2 mb-5 px-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-white text-sm">AiAdsGo</span>
          </div>
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActive(item.key)}
              className={`px-3 py-2 rounded-lg text-xs font-medium text-left transition-all ${
                active === item.key
                  ? "bg-violet-600/20 text-violet-300"
                  : "text-white/30 hover:text-white/60 hover:bg-white/5"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Main content — switch by active tab */}
        {pages[active]}
      </div>
    </div>
  );
}
