#!/usr/bin/env python3
"""Bounded, read-only production observation. No OpenDota API requests."""
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

PATTERNS = {
    'rate_limits': r'\[OPENDOTA\] 429',
    'network_failures': r'\[OPENDOTA\] network unavailable',
    'feed_updates': r'\[FEED\] собрано',
    'feed_failures': r'\[FEED\].*не удалось',
}
MARKER = '# pesiki-opendota-observation-24h'

def run(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=30, check=True).stdout

def summarize(samples):
    containers = {}
    for sample in samples:
        if 'container' in sample:
            key = sample['container']['Id']
            old = containers.setdefault(key, {})
            for name, value in sample.get('counts', {}).items():
                old[name] = max(old.get(name, 0), value)
    return {
        'samples': len(samples),
        'probe_errors': sum('error' in s for s in samples),
        'containers_seen': len(containers),
        'max_restart_count': max((s.get('container', {}).get('RestartCount', 0) for s in samples), default=0),
        'max_feed_age_seconds': max((s.get('feed', {}).get('ageSeconds', 0) for s in samples), default=0),
        'counts': {name: sum(c.get(name, 0) for c in containers.values()) for name in PATTERNS},
    }

def main():
    directory = Path(sys.argv[1])
    config = json.loads((directory / 'config.json').read_text())
    now = time.time()
    sample = {'at': dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat()}
    try:
        info = json.loads(run(['docker', 'inspect', 'pesiki-bot']))[0]
        sample['container'] = {'Id': info['Id'], 'RestartCount': info['RestartCount'],
                               'status': info['State']['Status'], 'startedAt': info['State']['StartedAt']}
        logs = subprocess.run(['docker', 'logs', '--since', str(config['start']), '--until', str(int(now)), 'pesiki-bot'],
                              capture_output=True, text=True, timeout=30, check=True)
        text = logs.stdout + logs.stderr
        sample['counts'] = {name: len(re.findall(pattern, text)) for name, pattern in PATTERNS.items()}
        js = "const f=JSON.parse(require('fs').readFileSync('/app/data/feed.json','utf8'));console.log(JSON.stringify({updatedAt:f.updatedAt,ageSeconds:Math.round((Date.now()-f.updatedAt)/1000),matches:f.matches.length,paidKeyConfigured:!!process.env.OPENDOTA_API_KEY}));"
        sample['feed'] = json.loads(run(['docker', 'exec', 'pesiki-bot', 'node', '-e', js]))
    except Exception as error:
        # Do not persist command output: it may contain unrelated application data.
        sample['error'] = type(error).__name__
    samples_path = directory / 'samples.jsonl'
    with samples_path.open('a') as out:
        out.write(json.dumps(sample) + '\n')
    samples = [json.loads(line) for line in samples_path.read_text().splitlines()]
    summary = summarize(samples)
    summary.update(start=config['start'], end=config['end'], lastSample=sample, finished=now >= config['end'])
    temporary = directory / 'summary.tmp'
    temporary.write_text(json.dumps(summary, indent=2) + '\n')
    temporary.replace(directory / 'summary.json')
    if now >= config['end']:
        cron = run(['crontab', '-l'])
        subprocess.run(['crontab', '-'], input='\n'.join(line for line in cron.splitlines() if MARKER not in line)+'\n',
                       text=True, check=True, timeout=10)

if __name__ == '__main__':
    main()
