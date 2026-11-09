"use client";
import { SeriesChart } from "@/components/charts/weight-chart";

/** Thin client wrapper so the server page can render the recharts series. */
export function PriceChart({ data, unit }: { data: { date: string; value: number | null }[]; unit: string }) {
  return <SeriesChart data={data} kind="line" unit={unit} color="var(--herb)" />;
}
