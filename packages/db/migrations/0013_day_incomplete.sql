-- Día marcado como registrado a medias: no cuenta en medias, adherencia ni gasto adaptativo.
ALTER TABLE "daily_summaries" ADD COLUMN "incomplete" boolean DEFAULT false NOT NULL;
