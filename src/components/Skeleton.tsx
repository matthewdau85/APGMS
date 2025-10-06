import React from "react";

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className = "", width = "100%", height = "1rem" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded bg-slate-200 ${className}`}
      style={{ width, height, minHeight: typeof height === "number" ? `${height}px` : height }}
    />
  );
}
