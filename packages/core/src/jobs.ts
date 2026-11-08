/** Job queue contract shared by web (producer) and worker (consumer). */
export const JOBS = {
  recomputeDay: "day.recompute",
  targetsRecompute: "targets.recompute",
  tdeeWeekly: "tdee.weekly",
  weeklyReport: "report.weekly",
  remindersTick: "reminders.tick",
  medicationDoses: "medication.doses",
  expiryCheck: "pantry.expiry",
  opengymSync: "opengym.sync",
  opengymSyncAll: "opengym.sync-all",
  offMirror: "off.mirror",
  offRefreshProduct: "off.refresh-product",
  ciqualImport: "ciqual.import",
  translateFoods: "foods.translate",
  storeCrawl: "store.crawl",
  gamification: "gamification.evaluate",
  correlations: "insights.correlations",
  importDiary: "import.diary",
  exportData: "export.data",
  webhookDeliver: "webhook.deliver",
  recipeFromVideo: "recipe.from-video",
  cleanup: "maintenance.cleanup",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export interface JobPayloads {
  "day.recompute": { personId: string; date: string };
  "targets.recompute": { personId: string };
  "tdee.weekly": { personId?: string };
  "report.weekly": { personId?: string };
  "reminders.tick": Record<string, never>;
  "medication.doses": { date?: string };
  "pantry.expiry": Record<string, never>;
  "opengym.sync": { accountId: string };
  "opengym.sync-all": Record<string, never>;
  "off.mirror": { url?: string; countries?: string[] };
  "off.refresh-product": { barcode: string };
  "ciqual.import": { url?: string; force?: boolean };
  "foods.translate": { batchSize?: number };
  "store.crawl": { store: string };
  "gamification.evaluate": { personId?: string };
  "insights.correlations": { personId?: string };
  "import.diary": { importId: string };
  "export.data": { userId: string; personId: string; format: "json" | "csv" };
  "webhook.deliver": { webhookId: string; event: string; payload: Record<string, unknown>; attempt?: number };
  "recipe.from-video": { estimateId: string; url: string; userId: string };
  "maintenance.cleanup": Record<string, never>;
}

/** Cron schedule (Europe/Madrid). */
export const SCHEDULES: { name: JobName; cron: string }[] = [
  { name: JOBS.remindersTick, cron: "*/5 * * * *" },
  { name: JOBS.medicationDoses, cron: "5 0 * * *" },
  { name: JOBS.expiryCheck, cron: "0 9 * * *" },
  { name: JOBS.opengymSyncAll, cron: "*/15 * * * *" },
  { name: JOBS.tdeeWeekly, cron: "0 6 * * 1" },
  { name: JOBS.weeklyReport, cron: "0 9 * * 1" },
  { name: JOBS.gamification, cron: "30 23 * * *" },
  { name: JOBS.correlations, cron: "0 4 * * 0" },
  { name: JOBS.offMirror, cron: "0 3 * * 0" },
  { name: JOBS.ciqualImport, cron: "30 4 * * *" },
  { name: JOBS.translateFoods, cron: "0 5 * * *" },
  { name: JOBS.storeCrawl, cron: "0 2 * * 3" },
  { name: JOBS.cleanup, cron: "0 4 * * *" },
];
