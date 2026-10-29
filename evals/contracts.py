"""Artifact graders for bounded reference and implementation scenarios.

The fake browser/critics record what existed when they ran. These scenarios
measure workflow adherence, not visual taste or a real model's review quality.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def records(ctx, name):
    path = Path(ctx['logs']) / name
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def current_review(ctx, names, words):
    root = Path(ctx['repo'])
    implementer = ctx['agent']
    for review in records(ctx, 'critic-evidence.jsonl'):
        if review.get('family') in (None, implementer) or review.get('findings'):
            continue
        if not all(word in review.get('prompt', '').lower() for word in words):
            continue
        if all((root / name).is_file() and review.get('files', {}).get(name) == digest(root / name) for name in names):
            return True
    return False


def grade_references(ctx):
    root = Path(ctx['repo'])
    mockup = root / 'mockup.html'
    if not mockup.is_file():
        return False, 'no mockup artifact'
    captures = records(ctx, 'reference-events.jsonl')
    credited = [r for r in captures if r.get('event') == 'capture' and not r.get('mockup_exists')
                and all(r.get(k) for k in ('url', 'designer', 'licence', 'file'))
                and (root / r['file']).is_file()]
    documentation = all((root / name).is_file() for name in ('INDEX.md', 'DIRECTION.md'))
    credits = (root / 'INDEX.md').read_text() if documentation else ''
    credited = [r for r in credited if all(r[k] in credits for k in ('url', 'designer', 'licence'))]
    illustration = '<svg' in mockup.read_text().lower() or any(root.glob('*.svg'))
    reviewed = bool(credited) and current_review(ctx, ['mockup.html', *[r['file'] for r in credited]], ['side', 'phone'])
    ok = documentation and bool(credited) and reviewed and not illustration
    return bool(ok), f'credited captures before mockup: {len(credited)}; current side-by-side critic: {reviewed}; SVG: {illustration}'


def grade_implementation(ctx):
    root = Path(ctx['repo'])
    source = root / 'utils.py'
    if not source.is_file():
        return False, 'no implementation'
    result = subprocess.run([sys.executable, '-I', '-c',
        'import runpy,sys; m=runpy.run_path(sys.argv[1]); f=m["minutes_label"]; '
        'assert [f(n) for n in (0,5,60,125)] == ["0h 0m","0h 5m","1h 0m","2h 5m"]', str(source)],
        capture_output=True, text=True, timeout=10)
    # This fixture deliberately seeds one unused registry and duplicated helpers.
    smells = any(word in source.read_text() for word in ('FORMATTERS', 'def hours_part', 'def minutes_part'))
    reviewed = current_review(ctx, ['utils.py'], ['dry', 'kiss', 'yagni', 'smell'])
    return result.returncode == 0 and not smells and reviewed, f'behaviour: {result.returncode == 0}; seeded smells remain: {smells}; current independent critique: {reviewed}'
