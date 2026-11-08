/**
 * EFSA Dietary Reference Values (DRV Finder 2019/2023), selected micronutrients.
 * PRI/AI are daily targets; "max" are limits (UL or public-health caps).
 * Age bands in years [min, max). Values in the nutrient's catalogue unit.
 */
export type Sex = "female" | "male";
export type LifeStage = "pregnancy" | "lactation" | null;

export interface DrvRow {
  code: string;
  sex: Sex | null;
  ageMin: number;
  ageMax: number;
  lifeStage: LifeStage;
  kind: "PRI" | "AI" | "RI" | "UL" | "MAX";
  amount: number;
}

type Band = [ageMin: number, ageMax: number, male: number, female: number];

const bands = (code: string, kind: DrvRow["kind"], rows: Band[], preg?: number, lact?: number): DrvRow[] => {
  const out: DrvRow[] = [];
  for (const [a, b, m, f] of rows) {
    out.push({ code, sex: "male", ageMin: a, ageMax: b, lifeStage: null, kind, amount: m });
    out.push({ code, sex: "female", ageMin: a, ageMax: b, lifeStage: null, kind, amount: f });
  }
  if (preg != null) out.push({ code, sex: "female", ageMin: 14, ageMax: 60, lifeStage: "pregnancy", kind, amount: preg });
  if (lact != null) out.push({ code, sex: "female", ageMin: 14, ageMax: 60, lifeStage: "lactation", kind, amount: lact });
  return out;
};

const KIDS_ADULT = (k: [number, number, number, number, number, number, number, number]): Band[] => [
  // 1-3, 4-6, 7-10, 11-14, 15-17 (m/f), adults (m/f)
  [1, 4, k[0], k[0]],
  [4, 7, k[1], k[1]],
  [7, 11, k[2], k[2]],
  [11, 15, k[3], k[3]],
  [15, 18, k[4], k[5]],
  [18, 120, k[6], k[7]],
];

export const DRV: DrvRow[] = [
  ...bands("vit_a", "PRI", KIDS_ADULT([250, 300, 400, 600, 750, 650, 750, 650]), 700, 1300),
  ...bands("vit_d", "AI", KIDS_ADULT([15, 15, 15, 15, 15, 15, 15, 15]), 15, 15),
  ...bands("vit_e", "AI", KIDS_ADULT([6, 9, 9, 13, 13, 11, 13, 11]), 11, 11),
  ...bands("vit_k", "AI", KIDS_ADULT([12, 20, 30, 45, 65, 65, 70, 70]), 70, 70),
  ...bands("vit_c", "PRI", KIDS_ADULT([20, 30, 45, 70, 100, 90, 110, 95]), 105, 155),
  ...bands("vit_b2", "PRI", KIDS_ADULT([0.6, 0.7, 1.0, 1.4, 1.6, 1.6, 1.6, 1.6]), 1.9, 2.0),
  ...bands("vit_b5", "AI", KIDS_ADULT([4, 4, 4, 5, 5, 5, 5, 5]), 5, 7),
  ...bands("vit_b6", "PRI", KIDS_ADULT([0.6, 0.7, 1.0, 1.4, 1.7, 1.6, 1.7, 1.6]), 1.8, 1.7),
  ...bands("biotin", "AI", KIDS_ADULT([20, 25, 25, 35, 35, 35, 40, 40]), 40, 45),
  ...bands("folate", "PRI", KIDS_ADULT([120, 140, 200, 270, 330, 330, 330, 330]), 600, 500),
  ...bands("vit_b12", "AI", KIDS_ADULT([1.5, 1.5, 2.5, 3.5, 4, 4, 4, 4]), 4.5, 5),
  ...bands("choline", "AI", KIDS_ADULT([140, 170, 250, 340, 400, 400, 400, 400]), 480, 520),
  ...bands("calcium", "PRI", KIDS_ADULT([450, 800, 800, 1150, 1150, 1150, 950, 950]), 950, 950),
  ...bands("phosphorus", "AI", KIDS_ADULT([250, 440, 440, 640, 640, 640, 550, 550]), 550, 550),
  ...bands("magnesium", "AI", KIDS_ADULT([170, 230, 230, 300, 300, 250, 350, 300]), 300, 300),
  ...bands("iron", "PRI", [
    [1, 7, 7, 7],
    [7, 12, 11, 11],
    [12, 18, 11, 13],
    [18, 50, 11, 16],
    [50, 120, 11, 11],
  ], 16, 16),
  ...bands("zinc", "PRI", KIDS_ADULT([4.3, 5.5, 7.4, 10.7, 14.2, 11.9, 11.7, 9.3]), 10.9, 12.2),
  ...bands("copper", "AI", KIDS_ADULT([0.7, 1.0, 1.0, 1.3, 1.3, 1.1, 1.6, 1.3]), 1.5, 1.5),
  ...bands("manganese", "AI", KIDS_ADULT([0.5, 1, 1.5, 2, 3, 3, 3, 3]), 3, 3),
  ...bands("selenium", "AI", KIDS_ADULT([15, 20, 35, 55, 70, 70, 70, 70]), 70, 85),
  ...bands("iodine", "AI", KIDS_ADULT([90, 90, 90, 120, 130, 130, 150, 150]), 200, 200),
  ...bands("potassium", "AI", KIDS_ADULT([800, 1100, 1800, 2700, 3500, 3500, 3500, 3500]), 3500, 4000),
  ...bands("fiber", "AI", KIDS_ADULT([10, 14, 16, 19, 21, 21, 25, 25]), 25, 25),
  ...bands("epa_dha", "AI", KIDS_ADULT([0.1, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]), 0.35, 0.45),
  // Limits
  ...bands("sodium", "MAX", KIDS_ADULT([1100, 1300, 1700, 2000, 2000, 2000, 2000, 2000]), 2000, 2000),
  ...bands("salt", "MAX", KIDS_ADULT([2, 3, 5, 5, 5, 5, 5, 5]), 5, 5),
  ...bands("caffeine", "MAX", KIDS_ADULT([0, 0, 0, 120, 200, 200, 400, 400]), 200, 200),
  ...bands("alcohol", "MAX", KIDS_ADULT([0, 0, 0, 0, 0, 0, 20, 10]), 0, 0),
];

/** Energy-dependent references (per MJ). */
export const PER_MJ = { vit_b1: 0.1, vit_b3: 1.6 } as const;

/** Upper levels for adults (also in nutrients catalogue), used for supplement warnings. */
export function drvFor(code: string, sex: Sex, age: number, lifeStage: LifeStage): DrvRow | undefined {
  const rows = DRV.filter((r) => r.code === code && (r.sex == null || r.sex === sex) && age >= r.ageMin && age < r.ageMax);
  if (lifeStage) {
    const ls = rows.find((r) => r.lifeStage === lifeStage);
    if (ls) return ls;
  }
  return rows.find((r) => r.lifeStage == null);
}
