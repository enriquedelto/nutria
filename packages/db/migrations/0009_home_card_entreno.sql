-- People with a customised home screen get the new "entreno" card right after "calorias".
UPDATE "persons" p
SET "settings" = jsonb_set(
  p."settings",
  '{homeCards}',
  (
    SELECT jsonb_agg(t.x ORDER BY t.ord)
    FROM (
      SELECT e.value AS x, e.ordinality * 2 AS ord
      FROM jsonb_array_elements(p."settings" -> 'homeCards') WITH ORDINALITY AS e(value, ordinality)
      UNION ALL
      SELECT
        '"entreno"'::jsonb,
        coalesce(
          (SELECT c.ordinality * 2 + 1 FROM jsonb_array_elements_text(p."settings" -> 'homeCards') WITH ORDINALITY AS c(value, ordinality) WHERE c.value = 'calorias' LIMIT 1),
          1
        )
    ) t
  )
)
WHERE jsonb_typeof(p."settings" -> 'homeCards') = 'array'
  AND jsonb_array_length(p."settings" -> 'homeCards') > 0
  AND NOT (p."settings" -> 'homeCards') ? 'entreno';
