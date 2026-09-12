#!/bin/sh
# Host-side backup, outside the Docker volume. Requires docker and flock.
set -eu
backup_dir="${PESIKI_BACKUP_DIR:-/home/gleb/pesiki-backups}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
exec 9>"$backup_dir/.backup.lock"
flock -n 9 || exit 0
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker exec -i pesiki-bot node --input-type=module <<'JS'
import Database from 'better-sqlite3';
const db = new Database('/app/data/stats.sqlite', { readonly: true, fileMustExist: true });
await db.backup('/app/data/.stats-backup.sqlite');
db.close();
const backup = new Database('/app/data/.stats-backup.sqlite', { readonly: true });
if (backup.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Invalid backup');
backup.close();
JS
docker cp pesiki-bot:/app/data/.stats-backup.sqlite "$backup_dir/.stats-$backup_stamp.tmp"
chmod 600 "$backup_dir/.stats-$backup_stamp.tmp"
mv "$backup_dir/.stats-$backup_stamp.tmp" "$backup_dir/stats-$backup_stamp.sqlite"
printf 'Saved %s/stats-%s.sqlite\n' "$backup_dir" "$backup_stamp"
