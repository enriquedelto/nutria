#!/bin/sh
# Daily backup loop (service "backup"): database dump + uploads (encrypted photos, receipts),
# retention, and a weekly restore test whose result the Admin page shows.
# Free KB on the backups disk.
avail_kb() { df -Pk /backups | awk 'NR==2 {print $4}'; }
# Size in KB of the newest file matching a glob (0 if none).
last_kb() { l=$(ls -t $1 2>/dev/null | head -1); [ -n "$l" ] && du -k "$l" | cut -f1 || echo 0; }
while true; do
  day=$(date +%F)
  # Leftovers of a failed run (full disk, killed container) are never useful.
  find /backups -name '*.tmp' -mmin +120 -delete
  f=/backups/nutria-$day.dump
  if pg_dump -h postgres -U nutria -d nutria --format=custom --file="$f.tmp"; then
    mv "$f.tmp" "$f" && echo "backup $f"
  else
    rm -f "$f.tmp"; echo "backup FALLIDO $f"
  fi
  if [ -d /uploads ]; then
    u=/backups/uploads-$day.tar.gz
    # Skip the uploads copy when it would not fit with a margin (2x the last one + 1 GB).
    need=$(( $(last_kb '/backups/uploads-*.tar*') * 2 + 1048576 ))
    if [ "$(avail_kb)" -lt "$need" ]; then
      echo "uploads OMITIDO: poco espacio libre ($(avail_kb) KB < $need KB)"
    elif tar -czf "$u.tmp" -C /uploads .; then
      mv "$u.tmp" "$u" && echo "backup $u"
    else
      rm -f "$u.tmp"; echo "backup FALLIDO $u"
    fi
  fi
  find /backups -name 'nutria-*.dump' -mtime +14 -delete
  find /backups -name 'uploads-*.tar' -mtime +7 -delete
  find /backups -name 'uploads-*.tar.gz' -mtime +7 -delete
  find /backups -name 'premigrate-*.dump' -mtime +30 -delete
  # One dump is written before every deploy: keep the 5 newest.
  ls -t /backups/premigrate-*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f
  # Restore test on Sundays, and the first time.
  if [ "$(date +%u)" = 7 ] || [ ! -f /backups/restore-test.json ]; then sh /restore-test.sh "$f"; fi
  sleep 86400
done
