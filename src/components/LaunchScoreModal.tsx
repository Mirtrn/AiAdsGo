"use client";

import { useState, useEffect } from "react";
import {
  getCachedLaunchScore,
  setCachedLaunchScore,
  clearCachedLaunchScore,
} from "@/lib/launch-score-cache";
import RadarChart from "./RadarChart";
import ScoreTrendChart from "./ScoreTrendChart";

interface LaunchScoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  offer: {
    id: number;
    offerName: string;
    brand: string;
  };
}

interface Creative {
  id: number;
  version: number;
  headline1: string;
  headline2: string | null;
  headline3: string | null;
  description1: string;
  description2: string | null;
  finalUrl: string;
  qualityScore: number | null;
  isApproved: boolean;
  createdAt: string;
}

interface ScoreDimension {
  score: number;
  issues: string[];
  suggestions: string[];
}

interface LaunchScoreData {
  totalScore: number;
  keywordAnalysis: ScoreDimension & {
    relevance: number;
    competition: string;
  };
  marketFitAnalysis: ScoreDimension & {
    targetAudienceMatch: number;
    geographicRelevance: number;
    competitorPresence: string;
  };
  landingPageAnalysis: ScoreDimension & {
    loadSpeed: number;
    mobileOptimization: boolean;
    contentRelevance: number;
    callToAction: boolean;
    trustSignals: number;
  };
  budgetAnalysis: ScoreDimension & {
    estimatedCpc: number;
    competitiveness: string;
    roi: number;
  };
  contentAnalysis: ScoreDimension & {
    headlineQuality: number;
    descriptionQuality: number;
    keywordAlignment: number;
    uniqueness: number;
  };
  overallRecommendations: string[];
}

export default function LaunchScoreModal({
  isOpen,
  onClose,
  offer,
}: LaunchScoreModalProps) {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [scoreData, setScoreData] = useState<LaunchScoreData | null>(null);
  const [error, setError] = useState("");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // Creative选择相关状态
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [loadingCreatives, setLoadingCreatives] = useState(false);
  const [selectedCreativeId, setSelectedCreativeId] = useState<number | null>(
    null,
  );

  // 历史评分相关状态
  const [activeTab, setActiveTab] = useState<"current" | "history" | "compare" | "performance">(
    "current",
  );
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // 性能对比相关状态
  const [performanceData, setPerformanceData] = useState<any>(null);
  const [loadingPerformance, setLoadingPerformance] = useState(false);
  const [performanceTimeRange, setPerformanceTimeRange] = useState<string>('30');
  const [avgOrderValue, setAvgOrderValue] = useState<string>('');

  // Creative对比相关状态
  const [selectedCompareIds, setSelectedCompareIds] = useState<number[]>([]);
  const [compareData, setCompareData] = useState<any[]>([]);
  const [loadingCompare, setLoadingCompare] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadCreatives();
      loadExistingScore();
      loadHistory();
    }
  }, [isOpen, offer.id]);

  const loadCreatives = async () => {
    setLoadingCreatives(true);
    try {
      const response = await fetch(`/api/offers/${offer.id}/creatives`, {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setCreatives(data.data.creatives);
        // 默认选择最新的Creative（第一个）
        if (data.data.creatives.length > 0) {
          setSelectedCreativeId(data.data.creatives[0].id);
        }
      }
    } catch (err) {
      console.error("加载Creatives失败:", err);
    } finally {
      setLoadingCreatives(false);
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const response = await fetch(
        `/api/offers/${offer.id}/launch-score/history`,
        {
          credentials: "include",
        },
      );

      if (response.ok) {
        const data = await response.json();
        setHistoryData(data.data.history || []);
      }
    } catch (err) {
      console.error("加载历史评分失败:", err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadCompareData = async (creativeIds: number[]) => {
    if (creativeIds.length < 2) {
      return;
    }

    setLoadingCompare(true);
    try {
      const response = await fetch(
        `/api/offers/${offer.id}/launch-score/compare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ creativeIds }),
        },
      );

      if (response.ok) {
        const data = await response.json();
        setCompareData(data.data.comparisons || []);
      }
    } catch (err) {
      console.error("加载对比数据失败:", err);
    } finally {
      setLoadingCompare(false);
    }
  };

  const loadPerformanceData = async () => {
    setLoadingPerformance(true);
    try {
      const params = new URLSearchParams({
        daysBack: performanceTimeRange,
      });

      if (avgOrderValue && parseFloat(avgOrderValue) > 0) {
        params.append('avgOrderValue', avgOrderValue);
      }

      const response = await fetch(
        `/api/offers/${offer.id}/launch-score/performance?${params.toString()}`,
        {
          credentials: "include",
        },
      );

      if (response.ok) {
        const data = await response.json();
        setPerformanceData(data);
      }
    } catch (err) {
      console.error("加载性能对比数据失败:", err);
    } finally {
      setLoadingPerformance(false);
    }
  };

  const handleCompareSelectionChange = (creativeId: number) => {
    setSelectedCompareIds((prev) => {
      if (prev.includes(creativeId)) {
        return prev.filter((id) => id !== creativeId);
      } else {
        // 最多选择3个
        if (prev.length >= 3) {
          return prev;
        }
        return [...prev, creativeId];
      }
    });
  };

  const loadExistingScore = async () => {
    // 如果没有选中Creative，先不加载
    if (!selectedCreativeId) {
      return;
    }

    // 首先检查缓存
    const cached = getCachedLaunchScore(offer.id, selectedCreativeId);
    if (cached) {
      console.log("✅ 从缓存加载Launch Score");
      setScoreData(cached);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/offers/${offer.id}/launch-score`, {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        if (data.launchScore) {
          const scoreData = {
            totalScore: data.launchScore.total_score,
            keywordAnalysis: JSON.parse(data.launchScore.keyword_analysis_data),
            marketFitAnalysis: JSON.parse(
              data.launchScore.market_analysis_data,
            ),
            landingPageAnalysis: JSON.parse(
              data.launchScore.landing_page_analysis_data,
            ),
            budgetAnalysis: JSON.parse(data.launchScore.budget_analysis_data),
            contentAnalysis: JSON.parse(data.launchScore.content_analysis_data),
            overallRecommendations: JSON.parse(
              data.launchScore.recommendations || "[]",
            ),
          };
          setScoreData(scoreData);
          // 设置缓存
          setCachedLaunchScore(offer.id, selectedCreativeId, scoreData);
          console.log("✅ Launch Score已缓存");
        }
      }
    } catch (err) {
      console.error("加载评分失败:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedCreativeId) {
      setError("请先选择一个Creative");
      return;
    }

    setAnalyzing(true);
    setError("");

    // 清除旧缓存（因为要重新分析）
    clearCachedLaunchScore(offer.id);

    try {
      const response = await fetch(`/api/offers/${offer.id}/launch-score`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          creativeId: selectedCreativeId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "分析失败");
      }

      const data = await response.json();
      setScoreData(data.analysis);
      // 缓存新分析结果
      setCachedLaunchScore(offer.id, selectedCreativeId, data.analysis);
      console.log("✅ 新分析结果已缓存");
    } catch (err: any) {
      setError(err.message || "分析失败，请重试");
    } finally {
      setAnalyzing(false);
    }
  };

  // 当选择的Creative变化时，重新加载评分
  useEffect(() => {
    if (selectedCreativeId && isOpen) {
      loadExistingScore();
    }
  }, [selectedCreativeId]);

  // 当对比选择变化时，重新加载对比数据
  useEffect(() => {
    if (selectedCompareIds.length >= 2 && isOpen && activeTab === "compare") {
      loadCompareData(selectedCompareIds);
    }
  }, [selectedCompareIds, activeTab]);

  const getScoreColor = (score: number, maxScore: number) => {
    const percentage = (score / maxScore) * 100;
    if (percentage >= 90) return "text-green-600";
    if (percentage >= 75) return "text-blue-600";
    if (percentage >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreGrade = (totalScore: number) => {
    if (totalScore >= 85)
      return {
        grade: "A",
        label: "优秀",
        color: "bg-green-100 text-green-800",
      };
    if (totalScore >= 70)
      return { grade: "B", label: "良好", color: "bg-blue-100 text-blue-800" };
    if (totalScore >= 60)
      return {
        grade: "C",
        label: "及格",
        color: "bg-yellow-100 text-yellow-800",
      };
    if (totalScore >= 50)
      return {
        grade: "D",
        label: "需改进",
        color: "bg-orange-100 text-orange-800",
      };
    return {
      grade: "F",
      label: "不建议投放",
      color: "bg-red-100 text-red-800",
    };
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
          onClick={onClose}
        />

        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
          <div className="bg-white px-6 pt-6 pb-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900">
                投放分析 - {offer.offerName}
              </h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Tab切换 */}
            <div className="flex border-b border-gray-200 mb-6">
              <button
                onClick={() => setActiveTab("current")}
                className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
                  activeTab === "current"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                当前评分
              </button>
              <button
                onClick={() => setActiveTab("history")}
                className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
                  activeTab === "history"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                历史对比 {historyData.length > 0 && `(${historyData.length})`}
              </button>
              <button
                onClick={() => setActiveTab("compare")}
                className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
                  activeTab === "compare"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                对比分析 {creatives.length > 0 && `(${creatives.length}个)`}
              </button>
              <button
                onClick={() => {
                  setActiveTab("performance");
                  if (!performanceData) {
                    loadPerformanceData();
                  }
                }}
                className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
                  activeTab === "performance"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                实际表现
              </button>
            </div>

            {activeTab === "current" ? (
              loading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
                  <p className="mt-4 text-gray-600">加载中...</p>
                </div>
              ) : !scoreData ? (
                <div className="text-center py-12">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                  <h3 className="mt-2 text-sm font-medium text-gray-900">
                    暂无投放评分
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    选择Creative后点击按钮开始AI智能分析
                  </p>

                  {/* Creative选择器 */}
                  <div className="mt-6 max-w-md mx-auto">
                    {loadingCreatives ? (
                      <div className="text-sm text-gray-500">
                        加载Creatives中...
                      </div>
                    ) : creatives.length === 0 ? (
                      <div className="text-sm text-yellow-600 bg-yellow-50 border border-yellow-200 rounded p-3">
                        暂无可用Creative，请先生成广告创意
                      </div>
                    ) : (
                      <div className="text-left">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          选择Creative
                        </label>
                        <select
                          value={selectedCreativeId || ""}
                          onChange={(e) =>
                            setSelectedCreativeId(Number(e.target.value))
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          {creatives.map((creative) => (
                            <option key={creative.id} value={creative.id}>
                              v{creative.version} -{" "}
                              {creative.headline1.substring(0, 40)}
                              {creative.qualityScore !== null &&
                                ` (评分: ${creative.qualityScore}/100)`}
                            </option>
                          ))}
                        </select>
                        {selectedCreativeId && (
                          <div className="mt-3 text-xs text-gray-500 bg-gray-50 p-3 rounded">
                            <div className="font-medium mb-1">
                              已选Creative详情:
                            </div>
                            {(() => {
                              const creative = creatives.find(
                                (c) => c.id === selectedCreativeId,
                              );
                              return creative ? (
                                <div className="space-y-1">
                                  <div>
                                    <span className="font-medium">标题1:</span>{" "}
                                    {creative.headline1}
                                  </div>
                                  {creative.headline2 && (
                                    <div>
                                      <span className="font-medium">
                                        标题2:
                                      </span>{" "}
                                      {creative.headline2}
                                    </div>
                                  )}
                                  <div>
                                    <span className="font-medium">描述:</span>{" "}
                                    {creative.description1}
                                  </div>
                                  {creative.qualityScore && (
                                    <div>
                                      <span className="font-medium">
                                        质量评分:
                                      </span>{" "}
                                      {creative.qualityScore}/100
                                    </div>
                                  )}
                                </div>
                              ) : null;
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-6">
                    <button
                      onClick={handleAnalyze}
                      disabled={
                        analyzing ||
                        !selectedCreativeId ||
                        creatives.length === 0
                      }
                      className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {analyzing ? "分析中..." : "开始投放分析"}
                    </button>
                  </div>
                  {error && (
                    <div className="mt-4 text-sm text-red-600">{error}</div>
                  )}
                </div>
              ) : (
                <div className="space-y-6 max-h-[600px] overflow-y-auto">
                  <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg p-6 text-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-medium opacity-90">
                          投放评分
                        </h3>
                        <div className="mt-2 flex items-baseline">
                          <span className="text-5xl font-bold">
                            {scoreData.totalScore}
                          </span>
                          <span className="ml-2 text-2xl opacity-75">/100</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span
                          className={`inline-block px-4 py-2 rounded-lg text-lg font-semibold ${getScoreGrade(scoreData.totalScore).color} bg-white`}
                        >
                          {getScoreGrade(scoreData.totalScore).grade} -{" "}
                          {getScoreGrade(scoreData.totalScore).label}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 雷达图可视化 */}
                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h4 className="text-lg font-semibold text-gray-900 mb-4 text-center">
                      5维度评分雷达图
                    </h4>
                    <RadarChart
                      data={[
                        {
                          label: "关键词",
                          value: scoreData.keywordAnalysis.score,
                          max: 30,
                        },
                        {
                          label: "市场契合",
                          value: scoreData.marketFitAnalysis.score,
                          max: 25,
                        },
                        {
                          label: "着陆页",
                          value: scoreData.landingPageAnalysis.score,
                          max: 20,
                        },
                        {
                          label: "预算",
                          value: scoreData.budgetAnalysis.score,
                          max: 15,
                        },
                        {
                          label: "内容",
                          value: scoreData.contentAnalysis.score,
                          max: 10,
                        },
                      ]}
                      size={350}
                    />
                  </div>

                  <div className="grid grid-cols-5 gap-4">
                    {[
                      {
                        name: "关键词",
                        score: scoreData.keywordAnalysis.score,
                        max: 30,
                        key: "keyword",
                      },
                      {
                        name: "市场契合",
                        score: scoreData.marketFitAnalysis.score,
                        max: 25,
                        key: "market",
                      },
                      {
                        name: "着陆页",
                        score: scoreData.landingPageAnalysis.score,
                        max: 20,
                        key: "landing",
                      },
                      {
                        name: "预算",
                        score: scoreData.budgetAnalysis.score,
                        max: 15,
                        key: "budget",
                      },
                      {
                        name: "内容",
                        score: scoreData.contentAnalysis.score,
                        max: 10,
                        key: "content",
                      },
                    ].map((dim) => (
                      <button
                        key={dim.key}
                        onClick={() =>
                          setExpandedSection(
                            expandedSection === dim.key ? null : dim.key,
                          )
                        }
                        className={`bg-white border rounded-lg p-4 text-center hover:border-indigo-500 transition cursor-pointer ${
                          expandedSection === dim.key
                            ? "border-indigo-500 ring-2 ring-indigo-200"
                            : "border-gray-200"
                        }`}
                      >
                        <div className="text-sm text-gray-600">{dim.name}</div>
                        <div
                          className={`text-2xl font-bold mt-2 ${getScoreColor(dim.score, dim.max)}`}
                        >
                          {dim.score}/{dim.max}
                        </div>
                        <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-indigo-600 h-2 rounded-full transition-all"
                            style={{ width: `${(dim.score / dim.max) * 100}%` }}
                          />
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* 维度详情展开区域 */}
                  {expandedSection && (
                    <div className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-6">
                      {expandedSection === "keyword" &&
                        scoreData.keywordAnalysis && (
                          <div>
                            <h4 className="text-lg font-semibold text-gray-900 mb-4">
                              关键词分析详情
                            </h4>
                            <div className="grid grid-cols-2 gap-4 mb-4">
                              <div>
                                <span className="text-sm text-gray-600">
                                  相关性评分：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {scoreData.keywordAnalysis.relevance}/100
                                </span>
                              </div>
                              <div>
                                <span className="text-sm text-gray-600">
                                  竞争程度：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {scoreData.keywordAnalysis.competition}
                                </span>
                              </div>
                            </div>
                            {scoreData.keywordAnalysis.issues.length > 0 && (
                              <div className="mb-4">
                                <h5 className="text-sm font-medium text-red-700 mb-2">
                                  ⚠️ 发现问题
                                </h5>
                                <ul className="list-disc list-inside text-sm text-red-600 space-y-1">
                                  {scoreData.keywordAnalysis.issues.map(
                                    (issue, i) => (
                                      <li key={i}>{issue}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}
                            {scoreData.keywordAnalysis.suggestions.length >
                              0 && (
                              <div>
                                <h5 className="text-sm font-medium text-green-700 mb-2">
                                  💡 优化建议
                                </h5>
                                <ul className="list-disc list-inside text-sm text-green-600 space-y-1">
                                  {scoreData.keywordAnalysis.suggestions.map(
                                    (suggestion, i) => (
                                      <li key={i}>{suggestion}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                      {expandedSection === "market" &&
                        scoreData.marketFitAnalysis && (
                          <div>
                            <h4 className="text-lg font-semibold text-gray-900 mb-4">
                              市场契合度详情
                            </h4>
                            <div className="grid grid-cols-3 gap-4 mb-4">
                              <div>
                                <span className="text-sm text-gray-600">
                                  目标受众匹配：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {
                                    scoreData.marketFitAnalysis
                                      .targetAudienceMatch
                                  }
                                  /100
                                </span>
                              </div>
                              <div>
                                <span className="text-sm text-gray-600">
                                  地理相关性：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {
                                    scoreData.marketFitAnalysis
                                      .geographicRelevance
                                  }
                                  /100
                                </span>
                              </div>
                              <div>
                                <span className="text-sm text-gray-600">
                                  竞争对手：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {
                                    scoreData.marketFitAnalysis
                                      .competitorPresence
                                  }
                                </span>
                              </div>
                            </div>
                            {scoreData.marketFitAnalysis.issues.length > 0 && (
                              <div className="mb-4">
                                <h5 className="text-sm font-medium text-red-700 mb-2">
                                  ⚠️ 发现问题
                                </h5>
                                <ul className="list-disc list-inside text-sm text-red-600 space-y-1">
                                  {scoreData.marketFitAnalysis.issues.map(
                                    (issue, i) => (
                                      <li key={i}>{issue}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}
                            {scoreData.marketFitAnalysis.suggestions.length >
                              0 && (
                              <div>
                                <h5 className="text-sm font-medium text-green-700 mb-2">
                                  💡 优化建议
                                </h5>
                                <ul className="list-disc list-inside text-sm text-green-600 space-y-1">
                                  {scoreData.marketFitAnalysis.suggestions.map(
                                    (suggestion, i) => (
                                      <li key={i}>{suggestion}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                      {expandedSection === "landing" &&
                        scoreData.landingPageAnalysis && (
                          <div>
                            <h4 className="text-lg font-semibold text-gray-900 mb-4">
                              着陆页质量详情
                            </h4>
                            <div className="grid grid-cols-3 gap-4 mb-4">
                              <div>
                                <span className="text-sm text-gray-600">
                                  加载速度：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {scoreData.landingPageAnalysis.loadSpeed}/100
                                </span>
                              </div>
                              <div>
                                <span className="text-sm text-gray-600">
                                  移动优化：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {scoreData.landingPageAnalysis
                                    .mobileOptimization
                                    ? "是"
                                    : "否"}
                                </span>
                              </div>
                              <div>
                                <span className="text-sm text-gray-600">
                                  内容相关性：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {
                                    scoreData.landingPageAnalysis
                                      .contentRelevance
                                  }
                                  /100
                                </span>
                              </div>
                              <div>
                                <span className="text-sm text-gray-600">
                                  行动召唤：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {scoreData.landingPageAnalysis.callToAction
                                    ? "有"
                                    : "无"}
                                </span>
                              </div>
                              <div>
                                <span className="text-sm text-gray-600">
                                  信任信号：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {scoreData.landingPageAnalysis.trustSignals}
                                  /100
                                </span>
                              </div>
                            </div>
                            {scoreData.landingPageAnalysis.issues.length >
                              0 && (
                              <div className="mb-4">
                                <h5 className="text-sm font-medium text-red-700 mb-2">
                                  ⚠️ 发现问题
                                </h5>
                                <ul className="list-disc list-inside text-sm text-red-600 space-y-1">
                                  {scoreData.landingPageAnalysis.issues.map(
                                    (issue, i) => (
                                      <li key={i}>{issue}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}
                            {scoreData.landingPageAnalysis.suggestions.length >
                              0 && (
                              <div>
                                <h5 className="text-sm font-medium text-green-700 mb-2">
                                  💡 优化建议
                                </h5>
                                <ul className="list-disc list-inside text-sm text-green-600 space-y-1">
                                  {scoreData.landingPageAnalysis.suggestions.map(
                                    (suggestion, i) => (
                                      <li key={i}>{suggestion}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                      {expandedSection === "budget" &&
                        scoreData.budgetAnalysis && (
                          <div>
                            <h4 className="text-lg font-semibold text-gray-900 mb-4">
                              预算分析详情
                            </h4>
                            <div className="grid grid-cols-3 gap-4 mb-4">
                              <div>
                                <span className="text-sm text-gray-600">
                                  预估CPC：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  $
                                  {scoreData.budgetAnalysis.estimatedCpc.toFixed(
                                    2,
                                  )}
                                </span>
                              </div>
                              <div>
                                <span className="text-sm text-gray-600">
                                  竞争激烈度：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {scoreData.budgetAnalysis.competitiveness}
                                </span>
                              </div>
                              <div>
                                <span className="text-sm text-gray-600">
                                  预估ROI：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {scoreData.budgetAnalysis.roi}%
                                </span>
                              </div>
                            </div>
                            {scoreData.budgetAnalysis.issues.length > 0 && (
                              <div className="mb-4">
                                <h5 className="text-sm font-medium text-red-700 mb-2">
                                  ⚠️ 发现问题
                                </h5>
                                <ul className="list-disc list-inside text-sm text-red-600 space-y-1">
                                  {scoreData.budgetAnalysis.issues.map(
                                    (issue, i) => (
                                      <li key={i}>{issue}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}
                            {scoreData.budgetAnalysis.suggestions.length >
                              0 && (
                              <div>
                                <h5 className="text-sm font-medium text-green-700 mb-2">
                                  💡 优化建议
                                </h5>
                                <ul className="list-disc list-inside text-sm text-green-600 space-y-1">
                                  {scoreData.budgetAnalysis.suggestions.map(
                                    (suggestion, i) => (
                                      <li key={i}>{suggestion}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                      {expandedSection === "content" &&
                        scoreData.contentAnalysis && (
                          <div>
                            <h4 className="text-lg font-semibold text-gray-900 mb-4">
                              内容创意详情
                            </h4>
                            <div className="grid grid-cols-2 gap-4 mb-4">
                              <div>
                                <span className="text-sm text-gray-600">
                                  标题质量：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {scoreData.contentAnalysis.headlineQuality}
                                  /100
                                </span>
                              </div>
                              <div>
                                <span className="text-sm text-gray-600">
                                  描述质量：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {scoreData.contentAnalysis.descriptionQuality}
                                  /100
                                </span>
                              </div>
                              <div>
                                <span className="text-sm text-gray-600">
                                  关键词对齐：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {scoreData.contentAnalysis.keywordAlignment}
                                  /100
                                </span>
                              </div>
                              <div>
                                <span className="text-sm text-gray-600">
                                  独特性：
                                </span>
                                <span className="ml-2 font-semibold text-gray-900">
                                  {scoreData.contentAnalysis.uniqueness}/100
                                </span>
                              </div>
                            </div>
                            {scoreData.contentAnalysis.issues.length > 0 && (
                              <div className="mb-4">
                                <h5 className="text-sm font-medium text-red-700 mb-2">
                                  ⚠️ 发现问题
                                </h5>
                                <ul className="list-disc list-inside text-sm text-red-600 space-y-1">
                                  {scoreData.contentAnalysis.issues.map(
                                    (issue, i) => (
                                      <li key={i}>{issue}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}
                            {scoreData.contentAnalysis.suggestions.length >
                              0 && (
                              <div>
                                <h5 className="text-sm font-medium text-green-700 mb-2">
                                  💡 优化建议
                                </h5>
                                <ul className="list-disc list-inside text-sm text-green-600 space-y-1">
                                  {scoreData.contentAnalysis.suggestions.map(
                                    (suggestion, i) => (
                                      <li key={i}>{suggestion}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                  )}

                  {scoreData.overallRecommendations.length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="font-semibold text-blue-900 mb-2">
                        💡 优化建议
                      </h4>
                      <ul className="space-y-2 text-sm text-blue-800">
                        {scoreData.overallRecommendations.map((rec, i) => (
                          <li key={i} className="flex items-start">
                            <svg
                              className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                clipRule="evenodd"
                              />
                            </svg>
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex justify-end space-x-3 pt-4 border-t">
                    <button
                      onClick={handleAnalyze}
                      disabled={analyzing}
                      className="px-4 py-2 border border-indigo-600 text-indigo-600 rounded-md hover:bg-indigo-50 disabled:opacity-50"
                    >
                      {analyzing ? "分析中..." : "重新分析"}
                    </button>
                    <button
                      onClick={onClose}
                      className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              )
            ) : activeTab === "history" ? (
              /* 历史对比Tab */
              <div className="space-y-6">
                {loadingHistory ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">加载历史数据中...</p>
                  </div>
                ) : historyData.length === 0 ? (
                  <div className="text-center py-12">
                    <svg
                      className="mx-auto h-12 w-12 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                      />
                    </svg>
                    <h3 className="mt-2 text-sm font-medium text-gray-900">
                      暂无历史记录
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      完成第一次评分后，历史记录将显示在这里
                    </p>
                  </div>
                ) : (
                  <>
                    {/* 趋势图 */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <h4 className="text-lg font-semibold text-gray-900 mb-4">
                        评分趋势
                      </h4>
                      <ScoreTrendChart
                        data={historyData.map((h) => ({
                          date: h.calculatedAt,
                          score: h.totalScore,
                        }))}
                        width={600}
                        height={250}
                      />
                    </div>

                    {/* 历史记录表格 */}
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      <div className="px-6 py-4 border-b border-gray-200">
                        <h4 className="text-lg font-semibold text-gray-900">
                          详细历史记录
                        </h4>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                分析时间
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                总分
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                关键词
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                市场契合
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                着陆页
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                预算
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                内容
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                等级
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {historyData.map((record, index) => {
                              const grade = getScoreGrade(record.totalScore);
                              const isLatest = index === 0;

                              return (
                                <tr
                                  key={record.id}
                                  className={
                                    isLatest ? "bg-blue-50" : "hover:bg-gray-50"
                                  }
                                >
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {new Date(
                                      record.calculatedAt,
                                    ).toLocaleString("zh-CN")}
                                    {isLatest && (
                                      <span className="ml-2 text-xs text-blue-600 font-medium">
                                        (最新)
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span
                                      className={`text-sm font-bold ${getScoreColor(record.totalScore, 100)}`}
                                    >
                                      {record.totalScore}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {record.dimensions.keyword}/30
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {record.dimensions.marketFit}/25
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {record.dimensions.landingPage}/20
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {record.dimensions.budget}/15
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {record.dimensions.content}/10
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span
                                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${grade.color}`}
                                    >
                                      {grade.grade}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* 维度对比雷达图（对比最新和最旧） */}
                    {historyData.length >= 2 && (
                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-gray-900 mb-4">
                          首次 vs 最新评分对比
                        </h4>
                        <div className="grid grid-cols-2 gap-8">
                          <div>
                            <h5 className="text-sm font-medium text-gray-700 mb-3 text-center">
                              首次评分 (
                              {new Date(
                                historyData[
                                  historyData.length - 1
                                ].calculatedAt,
                              ).toLocaleDateString("zh-CN")}
                              )
                            </h5>
                            <RadarChart
                              data={[
                                {
                                  label: "关键词",
                                  value:
                                    historyData[historyData.length - 1]
                                      .dimensions.keyword,
                                  max: 30,
                                },
                                {
                                  label: "市场契合",
                                  value:
                                    historyData[historyData.length - 1]
                                      .dimensions.marketFit,
                                  max: 25,
                                },
                                {
                                  label: "着陆页",
                                  value:
                                    historyData[historyData.length - 1]
                                      .dimensions.landingPage,
                                  max: 20,
                                },
                                {
                                  label: "预算",
                                  value:
                                    historyData[historyData.length - 1]
                                      .dimensions.budget,
                                  max: 15,
                                },
                                {
                                  label: "内容",
                                  value:
                                    historyData[historyData.length - 1]
                                      .dimensions.content,
                                  max: 10,
                                },
                              ]}
                              size={300}
                            />
                          </div>
                          <div>
                            <h5 className="text-sm font-medium text-gray-700 mb-3 text-center">
                              最新评分 (
                              {new Date(
                                historyData[0].calculatedAt,
                              ).toLocaleDateString("zh-CN")}
                              )
                            </h5>
                            <RadarChart
                              data={[
                                {
                                  label: "关键词",
                                  value: historyData[0].dimensions.keyword,
                                  max: 30,
                                },
                                {
                                  label: "市场契合",
                                  value: historyData[0].dimensions.marketFit,
                                  max: 25,
                                },
                                {
                                  label: "着陆页",
                                  value: historyData[0].dimensions.landingPage,
                                  max: 20,
                                },
                                {
                                  label: "预算",
                                  value: historyData[0].dimensions.budget,
                                  max: 15,
                                },
                                {
                                  label: "内容",
                                  value: historyData[0].dimensions.content,
                                  max: 10,
                                },
                              ]}
                              size={300}
                            />
                          </div>
                        </div>
                        <div className="mt-6 text-center">
                          <div className="inline-flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-700">
                                总分变化：
                              </span>
                              <span className="font-bold text-gray-900">
                                {historyData[historyData.length - 1].totalScore}{" "}
                                → {historyData[0].totalScore}
                              </span>
                              <span
                                className={`font-bold ${
                                  historyData[0].totalScore >
                                  historyData[historyData.length - 1].totalScore
                                    ? "text-green-600"
                                    : historyData[0].totalScore <
                                        historyData[historyData.length - 1]
                                          .totalScore
                                      ? "text-red-600"
                                      : "text-gray-600"
                                }`}
                              >
                                (
                                {historyData[0].totalScore -
                                  historyData[historyData.length - 1]
                                    .totalScore >=
                                0
                                  ? "+"
                                  : ""}
                                {historyData[0].totalScore -
                                  historyData[historyData.length - 1]
                                    .totalScore}
                                )
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end">
                      <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                      >
                        关闭
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : activeTab === "compare" ? (
              /* 对比分析Tab */
              <div className="space-y-6">
                {/* Creative多选器 */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">
                    选择要对比的Creative（最多3个）
                  </h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {creatives.map((creative) => (
                      <label
                        key={creative.id}
                        className={`flex items-start p-3 border rounded-md cursor-pointer transition ${
                          selectedCompareIds.includes(creative.id)
                            ? "border-indigo-500 bg-indigo-50"
                            : "border-gray-200 hover:border-gray-300 bg-white"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCompareIds.includes(creative.id)}
                          onChange={() =>
                            handleCompareSelectionChange(creative.id)
                          }
                          disabled={
                            !selectedCompareIds.includes(creative.id) &&
                            selectedCompareIds.length >= 3
                          }
                          className="mt-1 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                        />
                        <div className="ml-3 flex-1">
                          <div className="text-sm font-medium text-gray-900">
                            v{creative.version} - {creative.headline1}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {creative.description1}
                          </div>
                          {creative.qualityScore && (
                            <div className="text-xs text-gray-600 mt-1">
                              质量评分: {creative.qualityScore}/100
                            </div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-gray-500">
                    已选择 {selectedCompareIds.length}/3 个Creative
                  </div>
                </div>

                {/* 对比结果显示 */}
                {selectedCompareIds.length < 2 ? (
                  <div className="text-center py-12 text-gray-500">
                    请至少选择2个Creative进行对比
                  </div>
                ) : loadingCompare ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">加载对比数据中...</p>
                  </div>
                ) : compareData.length === 0 ? (
                  <div className="text-center py-12">
                    <button
                      onClick={() => loadCompareData(selectedCompareIds)}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                    >
                      加载对比数据
                    </button>
                  </div>
                ) : (
                  <>
                    {/* 并排雷达图对比 */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <h4 className="text-lg font-semibold text-gray-900 mb-4 text-center">
                        Creative评分雷达图对比
                      </h4>
                      <div
                        className={`grid gap-6 ${
                          compareData.length === 2
                            ? "grid-cols-2"
                            : "grid-cols-3"
                        }`}
                      >
                        {compareData.map((item) => (
                          <div key={item.creativeId} className="text-center">
                            <h5 className="text-sm font-medium text-gray-700 mb-2">
                              v{item.creative.version} -{" "}
                              {item.creative.headline1.substring(0, 20)}...
                            </h5>
                            {item.score ? (
                              <>
                                <div
                                  className="text-2xl font-bold mb-2"
                                  style={{
                                    color:
                                      item.score.totalScore >= 70
                                        ? "#22c55e"
                                        : item.score.totalScore >= 50
                                          ? "#3b82f6"
                                          : "#ef4444",
                                  }}
                                >
                                  {item.score.totalScore}分
                                </div>
                                <RadarChart
                                  data={[
                                    {
                                      label: "关键词",
                                      value: item.score.dimensions.keyword,
                                      max: 30,
                                    },
                                    {
                                      label: "市场",
                                      value: item.score.dimensions.marketFit,
                                      max: 25,
                                    },
                                    {
                                      label: "着陆页",
                                      value: item.score.dimensions.landingPage,
                                      max: 20,
                                    },
                                    {
                                      label: "预算",
                                      value: item.score.dimensions.budget,
                                      max: 15,
                                    },
                                    {
                                      label: "内容",
                                      value: item.score.dimensions.content,
                                      max: 10,
                                    },
                                  ]}
                                  size={compareData.length === 2 ? 300 : 250}
                                />
                              </>
                            ) : (
                              <div className="text-sm text-gray-500 py-12">
                                暂无评分数据
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 对比数据表格 */}
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      <div className="px-6 py-4 border-b border-gray-200">
                        <h4 className="text-lg font-semibold text-gray-900">
                          详细数据对比
                        </h4>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                指标
                              </th>
                              {compareData.map((item) => (
                                <th
                                  key={item.creativeId}
                                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                  v{item.creative.version}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            <tr>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                总分
                              </td>
                              {compareData.map((item) => (
                                <td
                                  key={item.creativeId}
                                  className="px-6 py-4 whitespace-nowrap"
                                >
                                  {item.score ? (
                                    <span
                                      className={`text-sm font-bold ${
                                        item.score.totalScore >= 70
                                          ? "text-green-600"
                                          : item.score.totalScore >= 50
                                            ? "text-blue-600"
                                            : "text-red-600"
                                      }`}
                                    >
                                      {item.score.totalScore}/100
                                    </span>
                                  ) : (
                                    <span className="text-sm text-gray-400">
                                      -
                                    </span>
                                  )}
                                </td>
                              ))}
                            </tr>
                            <tr className="bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                关键词分析
                              </td>
                              {compareData.map((item) => (
                                <td
                                  key={item.creativeId}
                                  className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                                >
                                  {item.score
                                    ? `${item.score.dimensions.keyword}/30`
                                    : "-"}
                                </td>
                              ))}
                            </tr>
                            <tr>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                市场契合
                              </td>
                              {compareData.map((item) => (
                                <td
                                  key={item.creativeId}
                                  className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                                >
                                  {item.score
                                    ? `${item.score.dimensions.marketFit}/25`
                                    : "-"}
                                </td>
                              ))}
                            </tr>
                            <tr className="bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                着陆页质量
                              </td>
                              {compareData.map((item) => (
                                <td
                                  key={item.creativeId}
                                  className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                                >
                                  {item.score
                                    ? `${item.score.dimensions.landingPage}/20`
                                    : "-"}
                                </td>
                              ))}
                            </tr>
                            <tr>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                预算效率
                              </td>
                              {compareData.map((item) => (
                                <td
                                  key={item.creativeId}
                                  className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                                >
                                  {item.score
                                    ? `${item.score.dimensions.budget}/15`
                                    : "-"}
                                </td>
                              ))}
                            </tr>
                            <tr className="bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                内容创意
                              </td>
                              {compareData.map((item) => (
                                <td
                                  key={item.creativeId}
                                  className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                                >
                                  {item.score
                                    ? `${item.score.dimensions.content}/10`
                                    : "-"}
                                </td>
                              ))}
                            </tr>
                            <tr>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                质量评分
                              </td>
                              {compareData.map((item) => (
                                <td
                                  key={item.creativeId}
                                  className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                                >
                                  {item.creative.qualityScore
                                    ? `${item.creative.qualityScore}/100`
                                    : "-"}
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* 推荐结论 */}
                    {(() => {
                      const validScores = compareData.filter(
                        (item) => item.score,
                      );
                      if (validScores.length === 0) return null;

                      const bestScore = Math.max(
                        ...validScores.map((item) => item.score.totalScore),
                      );
                      const bestCreative = validScores.find(
                        (item) => item.score.totalScore === bestScore,
                      );

                      return (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                          <h4 className="font-semibold text-green-900 mb-2 flex items-center">
                            <svg
                              className="w-5 h-5 mr-2"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                clipRule="evenodd"
                              />
                            </svg>
                            推荐结论
                          </h4>
                          <div className="text-sm text-green-800">
                            <p className="mb-2">
                              <span className="font-medium">
                                最佳Creative：
                              </span>
                              v{bestCreative?.creative.version} -{" "}
                              {bestCreative?.creative.headline1}
                            </p>
                            <p>
                              <span className="font-medium">总分：</span>
                              {bestScore}分 - 建议优先使用此Creative进行投放
                            </p>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="flex justify-end">
                      <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                      >
                        关闭
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : activeTab === "performance" ? (
              /* 实际表现Tab */
              <div className="space-y-6">
                {loadingPerformance ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">加载性能数据中...</p>
                  </div>
                ) : !performanceData ? (
                  <div className="text-center py-12">
                    <button
                      onClick={loadPerformanceData}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                    >
                      加载性能数据
                    </button>
                  </div>
                ) : !performanceData.hasLaunchScore ? (
                  <div className="text-center py-12 text-gray-500">
                    <p className="mb-4">暂无Launch Score记录</p>
                    <button
                      onClick={() => setActiveTab("current")}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                    >
                      前往创建Launch Score
                    </button>
                  </div>
                ) : !performanceData.hasPerformanceData ? (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                    <svg className="mx-auto h-12 w-12 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <h3 className="mt-4 text-lg font-medium text-yellow-900">暂无实际投放数据</h3>
                    <p className="mt-2 text-sm text-yellow-700">
                      Launch Score已创建，但尚未检测到实际的广告投放数据。
                      <br />
                      请先投放广告并等待数据同步后，再查看预测准确度分析。
                    </p>
                    <div className="mt-6 text-sm text-gray-600">
                      <p>Launch Score创建时间: {new Date(performanceData.launchScore.calculatedAt).toLocaleString('zh-CN')}</p>
                      <p className="mt-1">总分: <span className="font-bold text-indigo-600">{performanceData.launchScore.totalScore}/100</span></p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* 控制面板 */}
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            时间范围
                          </label>
                          <select
                            value={performanceTimeRange}
                            onChange={(e) => {
                              setPerformanceTimeRange(e.target.value);
                              loadPerformanceData();
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          >
                            <option value="7">最近7天</option>
                            <option value="30">最近30天</option>
                            <option value="90">最近90天</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            平均订单价值 (用于ROI计算)
                          </label>
                          <input
                            type="number"
                            value={avgOrderValue}
                            onChange={(e) => setAvgOrderValue(e.target.value)}
                            onBlur={loadPerformanceData}
                            placeholder="例如: 50.00"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                        </div>
                      </div>
                    </div>

                    {/* 准确度评分卡片 */}
                    <div className={`rounded-lg p-6 text-white ${
                      performanceData.accuracyScore >= 80 ? 'bg-green-500' :
                      performanceData.accuracyScore >= 60 ? 'bg-blue-500' :
                      performanceData.accuracyScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-medium opacity-90">预测准确度</h3>
                          <div className="mt-2 flex items-baseline">
                            <span className="text-5xl font-bold">{performanceData.accuracyScore}</span>
                            <span className="ml-2 text-2xl opacity-75">/100</span>
                          </div>
                          <p className="mt-2 text-sm opacity-90">
                            Launch Score创建于: {new Date(performanceData.launchScore.calculatedAt).toLocaleDateString('zh-CN')}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-4xl">
                            {performanceData.accuracyScore >= 80 ? '🎯' :
                             performanceData.accuracyScore >= 60 ? '✅' :
                             performanceData.accuracyScore >= 40 ? '⚠️' : '❌'}
                          </div>
                          <p className="mt-2 text-sm opacity-90">
                            {performanceData.accuracyScore >= 80 ? '预测非常准确' :
                             performanceData.accuracyScore >= 60 ? '预测基本准确' :
                             performanceData.accuracyScore >= 40 ? '预测有偏差' : '预测不准确'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* 预测 vs 实际对比表格 */}
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                        <h4 className="text-lg font-semibold text-gray-900">
                          Launch Score预测 vs 实际表现
                        </h4>
                        <p className="text-sm text-gray-600 mt-1">
                          数据范围: {performanceData.performanceData.dateRange.start} 至 {performanceData.performanceData.dateRange.end} ({performanceData.performanceData.dateRange.days}天)
                        </p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                指标
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Launch Score预测
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                实际表现
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                准确度
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                差异说明
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {performanceData.comparisons.map((comparison: any, index: number) => (
                              <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {comparison.metric}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  {comparison.predicted}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-indigo-600">
                                  {comparison.actual}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm">
                                  {comparison.accuracy !== null ? (
                                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                      comparison.accuracy >= 80 ? 'bg-green-100 text-green-800' :
                                      comparison.accuracy >= 60 ? 'bg-blue-100 text-blue-800' :
                                      comparison.accuracy >= 40 ? 'bg-yellow-100 text-yellow-800' :
                                      'bg-red-100 text-red-800'
                                    }`}>
                                      {comparison.accuracy}%
                                    </span>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600">
                                  {comparison.variance}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* 性能调整建议 */}
                    {performanceData.adjustedRecommendations && performanceData.adjustedRecommendations.length > 0 && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                        <h4 className="font-semibold text-blue-900 mb-3 flex items-center">
                          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          基于实际表现的优化建议
                        </h4>
                        <ul className="space-y-2">
                          {performanceData.adjustedRecommendations.map((rec: string, i: number) => (
                            <li key={i} className="flex items-start text-sm text-blue-800">
                              <span className="mr-2">{i + 1}.</span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex justify-end">
                      <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                      >
                        关闭
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
