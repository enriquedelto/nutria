#!/bin/sh
# Restore test: loads a dump into a scratch database, compares row counts with the live one,
# checks the uploads archive and writes /backups/restore-test.json (shown in Admin).
# By hand:  docker compose exec backup sh /restore-test.sh [/backups/nutria-YYYY-MM-DD.dump]
f=${1:-$(ls -t /backups/nutria-*.dump 2>/dev/null | head -1)}
out=/backups/restore-test.json
db=nutria_restore_test
now=$(date -u +%FT%TZ)
fail() {
  printf '{"at":"%s","dump":"%s","ok":false,"error":"%s","tables":{}}\n' "$now" "$(basename "${f:-}")" "$1" > "$out"
  echo "restore-test FALLA: $1"
  exit 1
}
[ -n "$f" ] && [ -f "$f" ] || fail "no hay copia que probar"
q() { psql -h postgres -U nutria -d "$1" -tAc "$2" 2>/dev/null; }

q postgres "drop database if exists $db" >/dev/null
q postgres "create database $db" >/dev/null || fail "no se pudo crear la base de pruebas"
pg_restore -h postgres -U nutria -d "$db" --no-owner "$f" 2>/tmp/restore.err
rc=$?

ok=true
tables=""
for t in '"user"' persons diary_entries foods weight_logs recipes receipts; do
  r=$(q "$db" "select count(*) from $t")
  l=$(q nutria "select count(*) from $t")
  name=$(echo "$t" | tr -d '"')
  # Every table must be there; a table with rows in production cannot come back empty.
  if [ -z "$r" ] || { [ "${l:-0}" -gt 0 ] && [ "$r" -eq 0 ]; }; then ok=false; fi
  tables="$tables${tables:+,}\"$name\":{\"restored\":${r:-null},\"live\":${l:-null}}"
done
q postgres "drop database if exists $db" >/dev/null

uploads=null
u=$(ls -t /backups/uploads-*.tar 2>/dev/null | head -1)
if [ -n "$u" ]; then
  inTar=$(tar -tf "$u" 2>/dev/null | grep -vc '/$')
  files=$(find /uploads -type f 2>/dev/null | wc -l | tr -d ' ')
  uploads="{\"archive\":\"$(basename "$u")\",\"inArchive\":$inTar,\"files\":$files}"
  # Files may have been added since the archive was written, never fewer than 90 %.
  [ "$files" -gt 0 ] && [ $((inTar * 10)) -lt $((files * 9)) ] && ok=false
fi
# pg_restore exits 1 on warnings too: it only fails the test together with a wrong table.
err=""
if [ "$ok" = false ]; then err=$(head -c 300 /tmp/restore.err | tr '\n"\\' '  /'); fi
printf '{"at":"%s","dump":"%s","ok":%s,"rc":%s,"error":"%s","tables":{%s},"uploads":%s}\n' "$now" "$(basename "$f")" "$ok" "$rc" "$err" "$tables" "$uploads" > "$out"
echo "restore-test $(basename "$f"): ok=$ok"
[ "$ok" = true ]
