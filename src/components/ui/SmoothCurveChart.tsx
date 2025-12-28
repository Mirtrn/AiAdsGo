'use client';

import { useMemo } from 'react';

interface SmoothCurveChartProps {
  data: number[];
}

/**
 * 平滑曲线图表 - 显示24小时点击分布
 * 使用SVG绘制平滑贝塞尔曲线
 */
export default function SmoothCurveChart({ data }: SmoothCurveChartProps) {
  const { points, areaPoints, maxValue } = useMemo(() => {
    if (!data || data.length === 0) {
      return { points: '', areaPoints: '', maxValue: 1 };
    }

    const width = 100;  // SVG视图宽度百分比
    const height = 80;  // SVG视图高度
    const padding = 4;  // 内边距
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const maxValue = Math.max(...data, 1);
    const stepX = chartWidth / 23;  // 24个点，23个间隔

    // 计算所有点的坐标
    const coords = data.map((value, index) => {
      const x = padding + index * stepX;
      const y = padding + chartHeight - (value / maxValue) * chartHeight;
      return { x, y };
    });

    // 生成平滑曲线路径
    // 使用贝塞尔曲线连接各点
    let path = `M ${coords[0].x},${coords[0].y}`;

    for (let i = 0; i < coords.length - 1; i++) {
      const current = coords[i];
      const next = coords[i + 1];

      // 计算控制点
      const cp1x = current.x + stepX * 0.5;
      const cp1y = current.y;
      const cp2x = next.x - stepX * 0.5;
      const cp2y = next.y;

      path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${next.x},${next.y}`;
    }

    // 生成填充区域路径（闭合到右下角和左下角）
    const lastCoord = coords[coords.length - 1];
    const areaPath = `${path} L ${lastCoord.x},${padding + chartHeight} L ${padding},${padding + chartHeight} Z`;

    return {
      points: path,
      areaPoints: areaPath,
      maxValue
    };
  }, [data]);

  // 生成X轴标签
  const xLabels = useMemo(() => {
    return data.map((_, index) => index.toString().padStart(2, '0'));
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="h-24 bg-muted/50 rounded-md flex items-center justify-center text-muted-foreground text-sm">
        暂无分布数据
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* SVG Chart */}
      <svg
        viewBox="0 0 100 80"
        className="w-full h-20"
        preserveAspectRatio="none"
      >
        {/* Gradient definition */}
        <defs>
          <linearGradient id="curveGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgb(59, 130, 246)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(59, 130, 246)" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Filled area */}
        <path
          d={areaPoints}
          fill="url(#curveGradient)"
          stroke="none"
        />

        {/* Smooth curve line */}
        <path
          d={points}
          fill="none"
          stroke="rgb(59, 130, 246)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {data.map((value, index) => {
          const x = 4 + (index / 23) * 92;
          const y = 76 - (value / maxValue) * 72;
          return (
            <circle
              key={index}
              cx={x}
              cy={y}
              r="1.5"
              fill="rgb(59, 130, 246)"
              className="transition-all duration-200"
            />
          );
        })}
      </svg>

      {/* X-axis labels */}
      <div className="flex justify-between mt-1 px-[2%]">
        {xLabels.filter((_, i) => i % 6 === 0).map((label, i) => (
          <span key={i} className="text-[10px] text-muted-foreground">
            {label}h
          </span>
        ))}
      </div>
    </div>
  );
}
