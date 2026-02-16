"use client";

import { useId, useMemo } from "react";
import type { ProgressTrendPoint, TrendMode } from "@/lib/progressTrend";
import { formatMetricValue } from "@/lib/numberFormat";
import styles from "./ProgressTrend.module.css";

type ProgressTrendProps = {
  points: ProgressTrendPoint[];
  mode: TrendMode;
  unitLabel: string;
};

export default function ProgressTrend({
  points,
  mode,
  unitLabel,
}: ProgressTrendProps) {
  const gradientIdBase = useId().replace(/:/g, "");
  const lineGradientId = `${gradientIdBase}-line`;
  const areaGradientId = `${gradientIdBase}-area`;

  const chartData = useMemo(() => {
    if (points.length === 0) return null;

    const width = 320;
    const height = 92;
    const padding = 8;
    const plotWidth = width - padding * 2;
    const plotHeight = height - padding * 2;

    const values = points.map((point) => point.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = maxValue - minValue;

    const coordinates = points.map((point, index) => {
      const x =
        points.length === 1
          ? width / 2
          : padding + (index / (points.length - 1)) * plotWidth;
      const normalized = valueRange === 0 ? 0.5 : (point.value - minValue) / valueRange;
      const y = padding + (1 - normalized) * plotHeight;
      return { x, y };
    });

    const linePath = coordinates
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");
    const baselineY = height - padding;
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    const areaPath = `${linePath} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;

    return {
      width,
      height,
      linePath,
      areaPath,
      startValue: values[0],
      endValue: values[values.length - 1],
      lastPoint: last,
    };
  }, [points]);

  if (points.length === 0 || !chartData) {
    return <div className={styles.empty}>No check-ins yet for trend view.</div>;
  }

  if (points.length < 2) {
    return (
      <div className={styles.empty}>Add one more check-in to unlock the trend line.</div>
    );
  }

  const delta = chartData.endValue - chartData.startValue;
  const deltaPrefix = delta > 0 ? "+" : "";
  const modeCopy =
    mode === "snapshot"
      ? "Snapshot value trend across check-ins"
      : "Cumulative progress trend across check-ins";

  return (
    <div className={styles.trendWrap}>
      <div className={styles.trendHeader}>Progress trend</div>
      <div className={styles.chartShell}>
        <svg className={styles.chart} viewBox={`0 0 ${chartData.width} ${chartData.height}`}>
          <defs>
            <linearGradient id={lineGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f4a127" />
              <stop offset="100%" stopColor="#5a3d2b" />
            </linearGradient>
            <linearGradient id={areaGradientId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f4a127" />
              <stop offset="100%" stopColor="#f4a127" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className={styles.areaPath} d={chartData.areaPath} fill={`url(#${areaGradientId})`} />
          <path
            className={styles.linePath}
            d={chartData.linePath}
            stroke={`url(#${lineGradientId})`}
          />
          <circle
            className={styles.point}
            cx={chartData.lastPoint.x}
            cy={chartData.lastPoint.y}
            r="3"
          />
        </svg>
      </div>
      <div className={styles.trendMeta}>
        {modeCopy}. Start {formatMetricValue(chartData.startValue)} {unitLabel} · Latest{" "}
        {formatMetricValue(chartData.endValue)} {unitLabel} · Delta {deltaPrefix}
        {formatMetricValue(delta)} {unitLabel}
      </div>
    </div>
  );
}
