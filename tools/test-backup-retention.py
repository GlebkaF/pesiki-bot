#!/usr/bin/env python3
import importlib.util
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

sys.dont_write_bytecode = True
script = Path(__file__).with_name('rotate-stats-backups.py')
spec = importlib.util.spec_from_file_location('rotation', script)
rotation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rotation)
files = [(datetime(2026, 11, 6, 12) - timedelta(days=i), Path(str(i))) for i in range(70)]
kept = rotation.select_kept(files)
assert len(kept) == 11
assert all(Path(str(i)) in kept for i in range(7))
assert rotation.select_kept([]) == set()
assert len(rotation.select_kept(files[:3])) == 3
assert Path('duplicate') not in rotation.select_kept(files + [(datetime(2026, 11, 6, 11), Path('duplicate'))])
with tempfile.TemporaryDirectory() as directory:
    folder = Path(directory)
    for stamp, _ in files:
        (folder / stamp.strftime('stats-%Y%m%dT%H%M%SZ.sqlite')).write_bytes(b'fixture')
    manual = folder / 'stats-before-migration.sqlite'
    manual.write_bytes(b'manual snapshot')
    incomplete = folder / '.stats-20261107T120000Z.tmp'
    incomplete.write_bytes(b'partial')
    link = folder / 'stats-20260101T120000Z.sqlite'
    link.symlink_to(manual)
    subprocess.run([sys.executable, str(script), directory], check=True, capture_output=True)
    assert len(list(folder.iterdir())) == 73, 'dry-run must not delete'
    subprocess.run([sys.executable, str(script), directory, '--apply'], check=True, capture_output=True)
    assert len(list(folder.iterdir())) == 14
    assert manual.read_bytes() == b'manual snapshot'
    assert incomplete.exists() and link.is_symlink()
    subprocess.run([sys.executable, str(script), directory, '--apply'], check=True, capture_output=True)
    assert len(list(folder.iterdir())) == 14, 'rotation must be idempotent'
print('Backup retention: daily/weekly, duplicate dates, dry-run, manual files, symlinks, idempotence passed')
