#!/usr/bin/env python3
"""Keep latest backup per day for seven dates, plus four older ISO weeks.
Only timestamped automatic backups are eligible; manual snapshots are untouched.
Run after a newly created backup has passed SQLite quick_check.
"""
import argparse
import datetime as dt
import json
import re
from pathlib import Path


def select_kept(files):
    daily, weekly, kept = set(), set(), set()
    for stamp, file in sorted(files, reverse=True):
        day = stamp.date()
        if day in daily:
            continue
        if len(daily) < 7:
            daily.add(day)
            kept.add(file)
            continue
        week = stamp.isocalendar()[:2]
        if week not in weekly and len(weekly) < 4:
            weekly.add(week)
            kept.add(file)
    return kept


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    files = []
    for file in args.directory.iterdir():
        if file.is_symlink() or not file.is_file():
            continue
        match = re.fullmatch(r'stats-(\d{8}T\d{6}Z)\.sqlite', file.name)
        if match:
            files.append((dt.datetime.strptime(match[1], '%Y%m%dT%H%M%SZ'), file))
    kept = select_kept(files)
    removed = [file for _, file in files if file not in kept]
    total = sum(file.stat().st_size for file in removed)
    print(json.dumps({'apply': args.apply, 'keep': len(kept), 'remove': len(removed),
                      'bytes_freed': total, 'kept': sorted(p.name for p in kept)}))
    if args.apply:
        for file in removed:
            file.unlink()


if __name__ == '__main__':
    main()
