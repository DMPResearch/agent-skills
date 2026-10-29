#!/usr/bin/env python3
"""Generate catalogue.md from the authoritative catalogue.json."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
data=json.loads((root/'rules/catalogue.json').read_text())
rows=['# Practice rule catalogue','','Generated from catalogue.json by scripts/render-catalogue.py. Edit JSON only.','',data['scope'],'','Mechanical checks identify candidates; auditors judge context and rules without mechanical coverage. Repo extensions may add stricter rules, not waive security.','']
seen=set()
for rule in data['rules']:
    assert rule['id'] not in seen and rule['kind'] in ['mechanical','judgment']
    seen.add(rule['id'])
    if rule.get('group')=='no-ai-slop' and not any(row=='## No AI slop: hard blockers' for row in rows):
        rows += ['## No AI slop: hard blockers','']
    rows += [f"## {rule['id']}",'',rule['rule'],'',*((['Severity: '+rule['severity'], '']) if rule.get('severity') else []), f"Check ({rule['kind']}): {rule['check']}",'',f"Violation: {rule['violation']}",'', "Sources: " + "; ".join(rule["sources"]), '']
(root/'rules/catalogue.md').write_text('\n'.join(rows))
print(f'Generated {len(seen)} rules')
