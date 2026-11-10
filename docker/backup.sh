#!/bin/sh
# Daily backup loop (service "backup"): database dump + uploads (encrypted photos, receipts),
# retention, and a weekly restore test whose result the Admin page shows.
while true; do
  day=$(date +%F)
  f=/backups/nutria-$day.dump
  pg_dump -h postgres -U nutria -d nutria --format=custom --file="$f.tmp" && mv "$f.tmp" "$f" && echo "backup $f"
  if [ -d /uploads ]; then
    u=/backups/uploads-$day.tar
    tar -cf "$u.tmp" -C /uploads . && mv "$u.tmp" "$u" && echo "backup $u"
  fi
  find /backups -name 'nutria-*.dump' -mtime +14 -delete
  find /backups -name 'uploads-*.tar' -mtime +7 -delete
  find /backups -name 'premigrate-*.dump' -mtime +30 -delete
  # One dump is written before every deploy: keep the 5 newest.
  ls -t /backups/premigrate-*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f
  # Restore test on Sundays, and the first time.
  if [ "$(date +%u)" = 7 ] || [ ! -f /backups/restore-test.json ]; then sh /restore-test.sh "$f"; fi
  sleep 86400
done
