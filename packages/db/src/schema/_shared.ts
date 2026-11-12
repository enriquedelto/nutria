import { customType, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

/** Primary key: UUIDv7 generated in the app (time-ordered, also usable offline on the client). */
export const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const newId = () => uuidv7();

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });

/** Nutrient amounts keyed by nutrient code (see `nutrients` table), per 100 g or per entry. */
export type NutrientMap = Record<string, number>;

/** `time` read as "HH:MM": Postgres returns "08:00:00", while forms, validation and the UI use "08:00". */
export const hhmm = customType<{ data: string; driverData: string }>({
  dataType: () => "time",
  fromDriver: (v) => String(v).slice(0, 5),
});
