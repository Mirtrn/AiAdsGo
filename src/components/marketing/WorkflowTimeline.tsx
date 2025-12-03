"use client";

import { useState, useEffect, useRef } from "react";
import {
  Link2,
  Wand2,
  Link as LinkIcon,
  Rocket,
  CheckCircle2,
} from "lucide-react";

interface WorkflowStep {
  id: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  duration: string;
  color: string;
  gradient: string;
  details: string[];
  gifPlaceholder: string;
}

const workflowSteps: WorkflowStep[] = [
  {
    id: 1,
    icon: Link2,
    title: "输入链接",
    subtitle: "粘贴产品URL",
    duration: "1分钟",
    color: "text-blue-500",
    gradient: "from-blue-500 to-cyan-500",
    details: [
      "支持任意电商/独立站链接",
      "自动识别品牌和产品信息",
      "智能提取页面关键数据",
      "支持批量导入多个链接",
    ],
    gifPlaceholder: "🔗 粘贴链接演示",
  },
  {
    id: 2,
    icon: Wand2,
    title: "AI生成",
    subtitle: "智能创意生成",
    duration: "5分钟",
    color: "text-purple-500",
    gradient: "from-purple-500 to-pink-500",
    details: [
      "AI生成15个广告标题",
      "自动生成4个描述文案",
      "智能推荐20-30个关键词",
      "多语言自动本地化",
      "质量评分和排序",
    ],
    gifPlaceholder: "✨ AI生成中...",
  },
  {
    id: 3,
    icon: LinkIcon,
    title: "关联账号",
    subtitle: "绑定Google Ads",
    duration: "1分钟",
    color: "text-emerald-500",
    gradient: "from-emerald-500 to-teal-500",
    details: [
      "OAuth安全授权",
      "支持MCC管理账号",
      "一键关联多个账号",
      "数据安全加密存储",
    ],
    gifPlaceholder: "🔐 安全关联中...",
  },
  {
    id: 4,
    icon: Rocket,
    title: "发布上线",
    subtitle: "一键投放广告",
    duration: "3分钟",
    color: "text-orange-500",
    gradient: "from-orange-500 to-red-500",
    details: [
      "自动创建广告系列",
      "智能设置出价策略",
      "实时发布到Google Ads",
      "投放效果即时追踪",
    ],
    gifPlaceholder: "🚀 发布成功！",
  },
];

function StepCard({
  step,
  isActive,
  isCompleted,
  onClick,
}: {
  step: WorkflowStep;
  isActive: boolean;
  isCompleted: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`relative cursor-pointer transition-all duration-300 ${
        isActive ? "scale-105" : "hover:scale-102"
      }`}
      onClick={onClick}
    >
      {/* 步骤卡片 */}
      <div
        className={`relative p-4 rounded-2xl border-2 transition-all duration-300 ${
          isActive
            ? `border-transparent bg-gradient-to-br ${step.gradient} text-white shadow-lg`
            : isCompleted
            ? "border-emerald-300 bg-emerald-50"
            : "border-slate-200 bg-white hover:border-slate-300"
        }`}
      >
        {/* 图标 */}
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 ${
            isActive
              ? "bg-white/20"
              : isCompleted
              ? "bg-emerald-500 text-white"
              : "bg-slate-100"
          }`}
        >
          {isCompleted && !isActive ? (
            <CheckCircle2 className="w-6 h-6" />
          ) : (
            <step.icon className={`w-6 h-6 ${isActive ? "text-white" : step.color}`} />
          )}
        </div>

        {/* 标题 */}
        <h3
          className={`font-bold mb-1 ${
            isActive ? "text-white" : "text-slate-900"
          }`}
        >
          {step.title}
        </h3>
        <p
          className={`text-sm mb-2 ${
            isActive ? "text-white/80" : "text-slate-500"
          }`}
        >
          {step.subtitle}
        </p>

        {/* 时长 */}
        <div
          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
            isActive
              ? "bg-white/20 text-white"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          ⏱️ {step.duration}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-orange-500 rounded-full transition-all duration-1000 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

export function WorkflowTimeline() {
  const [activeStep, setActiveStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.2 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  // 自动播放进度
  useEffect(() => {
    if (!isVisible) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          return 0;
        }
        return prev + 1;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isVisible]);

  // 根据进度更新当前步骤（按时间比例：1+5+1+3=10分钟）
  // 输入链接(1分钟): 0-10%, AI生成(5分钟): 10-60%, 关联账号(1分钟): 60-70%, 发布上线(3分钟): 70-100%
  useEffect(() => {
    if (progress < 10) setActiveStep(0);
    else if (progress < 60) setActiveStep(1);
    else if (progress < 70) setActiveStep(2);
    else setActiveStep(3);
  }, [progress]);

  return (
    <section ref={ref} className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* 标题 */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl mb-4">
            4步完成，从创意到投放
          </h2>
          <p className="text-xl text-slate-600">
            全程只需 <span className="font-bold text-blue-600">10分钟</span>，比泡一杯咖啡还快
          </p>
        </div>

        {/* 进度条 */}
        <div className="max-w-3xl mx-auto mb-8">
          <div className="flex justify-between text-sm text-slate-500 mb-2">
            <span>开始</span>
            <span className="font-medium text-slate-900">
              总进度 {Math.round(progress)}%
            </span>
            <span>完成</span>
          </div>
          <ProgressBar progress={progress} />
          <div className="flex justify-between mt-2">
            {/* 显示累计时间：0分钟, 1分钟, 6分钟, 7分钟, 10分钟 */}
            {["0分钟", "1分钟", "6分钟", "7分钟"].map((time, index) => (
              <div
                key={index}
                className={`text-xs font-medium transition-colors ${
                  index <= activeStep ? workflowSteps[Math.min(index, 3)].color : "text-slate-400"
                }`}
              >
                {time}
              </div>
            ))}
            <div
              className={`text-xs font-medium transition-colors ${
                progress >= 100 ? "text-orange-500" : "text-slate-400"
              }`}
            >
              10分钟
            </div>
          </div>
        </div>

        {/* 步骤卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
          {workflowSteps.map((step, index) => (
            <StepCard
              key={step.id}
              step={step}
              isActive={index === activeStep}
              isCompleted={index < activeStep}
              onClick={() => {
                setActiveStep(index);
                // 按时间比例设置进度：0%, 10%, 60%, 70%
                const progressPoints = [0, 10, 60, 70];
                setProgress(progressPoints[index] + 5);
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
