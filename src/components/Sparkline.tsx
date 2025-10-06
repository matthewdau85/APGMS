import React from "react";

export interface SparklinePoint {
  value: number;
  upper?: number | null;
  lower?: number | null;
}

interface SparklineProps {
  data: SparklinePoint[];
  width?: number;
  height?: number;
  stroke?: string;
}

export function Sparkline({
  data,
  width = 160,
  height = 60,
  stroke = "#0f766e",
}: SparklineProps) {
  if (!data.length) {
    return <div className="text-xs text-gray-400">no data</div>;
  }

  const values = data.map((d) => d.value);
  const upper = data.map((d) => (d.upper ?? d.value));
  const lower = data.map((d) => (d.lower ?? d.value));
  const minVal = Math.min(...lower);
  const maxVal = Math.max(...upper);
  const range = maxVal - minVal || 1;

  const points = values
    .map((val, idx) => {
      const x = (idx / (values.length - 1 || 1)) * width;
      const y = height - ((val - minVal) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPath = data
    .map((val, idx) => {
      const x = (idx / (values.length - 1 || 1)) * width;
      const yUpper = height - (((val.upper ?? val.value) - minVal) / range) * height;
      return `${x},${yUpper}`;
    })
    .concat(
      data
        .slice()
        .reverse()
        .map((val, revIdx) => {
          const idx = data.length - 1 - revIdx;
          const x = (idx / (values.length - 1 || 1)) * width;
          const yLower = height - (((val.lower ?? val.value) - minVal) / range) * height;
          return `${x},${yLower}`;
        })
    )
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <linearGradient id="sparklineGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPath} fill="url(#sparklineGradient)" stroke="none" />
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
      {data.map((val, idx) => {
        const x = (idx / (values.length - 1 || 1)) * width;
        const y = height - ((val.value - minVal) / range) * height;
        return <circle key={idx} cx={x} cy={y} r={2} fill={stroke} opacity={idx === data.length - 1 ? 1 : 0.4} />;
      })}
    </svg>
  );
}

export default Sparkline;
