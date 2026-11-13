"use client";
/**
 * Charts are loaded on demand: recharts (~400 kB of JS) stays out of the page's first load and
 * out of link prefetching; a placeholder of the same height avoids layout shift.
 */
import dynamic from "next/dynamic";

export type { CaffeinePoint, MealTimingPoint, WeightPoint } from "./recharts-impl";

const placeholder = (h: string) =>
  function ChartPlaceholder() {
    return <div className={`${h} w-full animate-pulse rounded-xl bg-paper-2`} aria-hidden />;
  };

export const WeightChart = dynamic(() => import("./recharts-impl").then((m) => m.WeightChart), { ssr: false, loading: placeholder("h-64") });
export const SeriesChart = dynamic(() => import("./recharts-impl").then((m) => m.SeriesChart), { ssr: false, loading: placeholder("h-48") });
export const CaffeineChart = dynamic(() => import("./recharts-impl").then((m) => m.CaffeineChart), { ssr: false, loading: placeholder("h-56") });
export const MealTimingChart = dynamic(() => import("./recharts-impl").then((m) => m.MealTimingChart), { ssr: false, loading: placeholder("h-48") });
