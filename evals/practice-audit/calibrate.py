#!/usr/bin/env python3
"""Generate a blind seeded repo, run the real auditors, and score recall/noise."""
import argparse
import json
import pathlib
import subprocess
import sys

ROOT=pathlib.Path(__file__).resolve().parents[2]

def score(report, expected):
    # Only final violations count. Mechanical candidates remain visible in reports.
    findings=[f for f in report['findings'] if not f.get('candidate',False)]
    found=[]; missed=[]
    def matches(f, seed):
        return f['rule_id'] in seed['rules'] and f['file'] in seed['files'] and (f['rule_id']=='ENG-002' or seed.get('first',1)<=f['line']<=seed.get('last',10000))
    mechanical_findings=[f for f in report.get('mechanical',{}).get('findings',[]) if not f.get('candidate',False)]
    for seed in expected:
        pool=mechanical_findings if seed['kind']=='mechanical' else findings
        (found if any(matches(f,seed) for f in pool) else missed).append(seed['id'])
    false=[f for f in findings if not any(matches(f,{**seed,'rules':seed['rules']+seed.get('secondary_rules',[])}) for seed in expected)]
    mechanical=[s for s in expected if s['kind']=='mechanical']
    judgment=[s for s in expected if s['kind']=='judgment']
    m=sum(s['id'] in found for s in mechanical);j=sum(s['id'] in found for s in judgment)
    families={}
    for family in ['claude','codex']:
        actor=next((a for a in report.get('auditors',[]) if a['family']==family),{})
        actor_findings=actor.get('findings',[])
        detected=[s for s in expected if any(matches(f,s) for f in actor_findings)]
        families[family]={'status':actor.get('status','missing'),'contributed':len(actor_findings),'mechanical_found':sum(s['kind']=='mechanical' for s in detected),'judgment_found':sum(s['kind']=='judgment' for s in detected),'smells_found':sum(s.get('group')=='smell' for s in detected),'design_found':sum(s.get('group')=='design' for s in detected),'missed':[s['id'] for s in expected if s not in detected]}
    smells=sum(s.get('group')=='smell' for s in expected);design=sum(s.get('group')=='design' for s in expected)
    family_pass=all(f['status']=='complete' and f['contributed']>0 and f['judgment_found']>=7 and f['smells_found']==smells and f['design_found']==design for f in families.values())
    return {'families':families,'status':report['status'],'mechanical_found':m,'mechanical_total':len(mechanical),'judgment_found':j,'judgment_total':len(judgment),'found':found,'missed':missed,'false':false,'passed':family_pass and report['status']=='complete' and m==len(mechanical) and j>=7 and len(false)<=2}

def prepare(out):
    out.mkdir(parents=True,exist_ok=False)
    repo=out/'repo';repo.mkdir()
    subprocess.run(['git','init','-q',str(repo)],check=True)
    subprocess.run(['git','-C',str(repo),'-c','user.name=Calibration','-c','user.email=calibration@example.invalid','commit','--allow-empty','-qm','baseline'],check=True)
    credential_name=''.join(['api','Key'])
    credential_value=''.join(['gh','p_','Ab7cD9eF3hJ5kL8mN2pQ4rS6tV1wX0yZ'])
    files={
      'AGENTS.md': '# Workspace\nThis repository contains request handlers, interface assets and operational notes. Review the supplied revision without changing files.\n',
      'config.ts': f'export const {credential_name} = "{credential_value}";\nexport const model = process.env.MODEL_ID;\n',
      'Banner.tsx': 'export function Banner() { return <p className="label">Your document was saved.</p>; }\n',
      'runner.ts': 'export function sum(values: number[]) {\n  return values.reduce((total, value) => total + value,\n'+('\n'*499)+'  0);\n}\n',
      'discount.ts': 'export function checkoutDiscount(total: number, percent: number) {\n  return Math.round(total * (100 - percent) / 100);\n}\nexport function invoiceDiscount(total: number, percent: number) {\n  return Math.round(total * (100 - percent) / 100);\n}\n',
      'server.ts': 'const users = new Map();\nexport interface User { id: number; email: string; }\nexport async function createUser(req: Request) {\n  const body = await req.json();\n  users.set(body.id, body);\n  return Response.json(body);\n}\n',
      'client.ts': 'export interface User { id: string; email?: string; }\nexport async function save(user: User) {\n  return fetch("/users", { method: "POST", body: JSON.stringify(user) });\n}\n',
      'server.test.ts': 'import { readFileSync } from "node:fs";\nimport assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("creates a user", () => {\n  const text = readFileSync(new URL("./server.ts", import.meta.url), "utf8");\n  assert.ok(text.includes("users.set"));\n});\n',
      'tokens.css': ':root { --surface: #fff; --ink: #111; --dark-surface: #111; --on-dark: #fff; }\n',
      'screen.css': '.label { color: var(--ink); }\n[data-theme="dark"] { background: var(--dark-surface); }\n[data-theme="dark"] .label { color: var(--dark-surface); }\n.primary { background: var(--ink); color: var(--surface); padding: 1rem; width: 100%; }\n',
      'screen.html': '<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="screen.css">\n<main><p class="label">Document ready</p>\n<button class="primary">Publish document</button>\n<button class="primary">Archive document</button>\n<button class="primary">Delete document</button></main>\n',
      'docs/runtime.md': '# Launch\nStartup opens settings.json before binding the listening socket.\nNo startup path opens settings.json.\n',
      'evidence/actions.log': "Session notes\n09:00 Owner: leave this on your laptop; I will handle the rollout.\n09:18 pipeline --environment production: exit 0, revision 42 active.\n09:20 layout task 17, run 1: snapshot mismatch, exit 1.\n09:23 layout task 17, run 2: snapshot mismatch, exit 1.\n09:24 layout task 17, run 3: snapshot mismatch; plan revision remains 7.\n09:26 Customer: tapping Submit twice creates two receipts.\n09:32 debounce increased from 300 to 500; local incident runs: 0; ticket closed.\n",
      'settings/lookup.ts': 'export function keyEnvironment(options: {provider?: {envKey?: string}}, fallback: string) { return options.provider?.envKey ?? fallback; }\n',
      'notes/connection.md': 'Local connection template: '+''.join(['postgres://','user:','<replace-password>','@localhost/db\n']),
      'spec/guard.test.ts': 'const forbiddenMarkers = ["'+'-----BEGIN '+'PRIVATE KEY-----'+'"];\n',
      'history/fixtures/session.jsonl': json.dumps({'text':'Finished'+chr(8212)+'thank you'})+'\n',
      'math/sum.mjs': 'export function sum(a, b) { return a + b; }\n',
      'math/sum.test.mjs': 'import { sum } from "./sum.mjs";\nimport assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("adds positive and negative values", () => { assert.equal(sum(2, 3), 5); assert.equal(sum(-2, 3), 1); });\n'
    }
    files.update({
      'persist.ts':'export async function saveOrder(order, store) {\n  try { return await store.save(order); }\n  catch (error) { return { saved: true, id: order.id }; }\n}\n',
      'settlement.ts':'export async function transfer(amountCents, account) {\n  if (amountCents > 7500) throw new Error("Transfer limit reached");\n  return account.gateway.send(amountCents);\n}\n',
      'Badge.tsx':'export function Badge() { return <span style={{ color: "#ff00aa" }}>Pending</span>; }\n',
      'docs/behavior.md':'A receipt is issued only after the store acknowledges persistence.\nTransfer limits are negotiated per account and supplied as account.transferLimitCents. A transfer below that limit must not be rejected.\n'
    })
    files['screen.css'] += '.primary:focus-visible { outline: none; }\n'
    files['workflow.ts'] = 'export async function dispatch(command, input, ports) {\n' +         '  if (command === "signup") {\n    const user = await ports.users.create(input);\n    await ports.mail.send(user.email);\n    return user;\n  }\n' +         '  if (command === "export") {\n    const rows = await ports.users.list();\n    const csv = rows.map(row => row.id + "," + row.email).join("\\n");\n    await ports.files.write(input.path, csv);\n    return csv;\n  }\n' +         '  if (command === "stock") {\n    const stock = await ports.stock.list();\n    for (const item of stock) {\n      const remote = await ports.inventory.lookup(item.sku);\n      await ports.stock.update(item.sku, remote.quantity);\n    }\n    return stock;\n  }\n' +         '  if (command === "archive") {\n    const orders = await ports.orders.list();\n    for (const order of orders) {\n      if (order.closed) {\n        await ports.archive.store(order);\n        await ports.orders.remove(order.id);\n      }\n    }\n    return orders;\n  }\n' +         '  if (command === "report") {\n    const records = await ports.billing.list();\n    const totals = new Map();\n    for (const record of records) {\n      totals.set(record.currency, (totals.get(record.currency) || 0) + record.amount);\n    }\n    await ports.report.render(totals);\n    return totals;\n  }\n  throw new Error("Unknown command");\n}\n'
    for name,content in files.items():
        p=repo/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(content)
    subprocess.run(['git','-C',str(repo),'add','.'],check=True)
    return repo

def expected_answers():
    def seed(id,kind,rules,files,first=1,last=10000):
        return dict(id=id,kind=kind,rules=rules,files=files,first=first,last=last)
    expected=[
      seed('secret','mechanical',['SEC-001'],['config.ts'],1,1),
      seed('length','mechanical',['ENG-002'],['runner.ts'],501,505),
      seed('duplicated-rule','judgment',['ENG-003','ENG-SLOP-CODE'],['discount.ts']),
      seed('boundary-contract','judgment',['ENG-007','ENG-008'],['client.ts','server.ts']),
      seed('source-mirroring-test','judgment',['TEST-002','ENG-SLOP-CODE'],['server.test.ts']),
      seed('contrast','judgment',['UI-018','UI-DS-002'],['screen.css','screen.html','tokens.css']),
      seed('action-hierarchy','judgment',['UI-008','UI-SLOP-DESIGN'],['screen.html','screen.css']),
      seed('contradictory-docs','judgment',['ENG-014'],['docs/runtime.md']),
      seed('unauthorized-deploy','judgment',['PROC-015'],['evidence/actions.log'],2,3),
      seed('repeated-retry','judgment',['PROC-003'],['evidence/actions.log'],4,6),
      seed('unreproduced-bug','judgment',['TEST-001','PROC-008'],['evidence/actions.log'],7,8)
    ]
    expected += [
      {**seed('swallowed-write','judgment',['ENG-SMELL-012','ENG-SLOP-CODE'],['persist.ts']),'group':'smell','secondary_rules':['PROC-008','ENG-012']},
      {**seed('mixed-jobs','judgment',['ENG-SMELL-001','ENG-SMELL-003'],['workflow.ts']),'group':'smell','secondary_rules':['ENG-004','ENG-SMELL-013']},
      {**seed('transfer-limit','judgment',['ENG-SMELL-005'],['settlement.ts']),'group':'smell'},
      {**seed('component-literal','judgment',['UI-002'],['Badge.tsx']),'group':'design'},
      {**seed('focus-hidden','judgment',['UI-DS-003'],['screen.css','screen.html']),'group':'design'}
    ]
    expected[10]['secondary_rules']=['PROC-044','TEST-009']
    expected[1]['secondary_rules']=['ENG-SMELL-001','ENG-CAND-001']
    return expected

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out',required=True,help='New directory, preferably /Volumes/DevBox/tmp/<run>')
    p.add_argument('--prepare-only',action='store_true')
    p.add_argument('--report',help='Score an existing report against this run expected.json')
    p.add_argument('--claude-model',default='claude-opus-5-5')
    p.add_argument('--codex-model',default='gpt-6-sol')
    p.add_argument('--codex-reasoning-effort',default='high')
    p.add_argument('--claude-config-dir')
    p.add_argument('--timeout',type=int,default=600)
    a=p.parse_args();out=pathlib.Path(a.out).resolve()
    if a.report:
        result=score(json.loads(pathlib.Path(a.report).read_text()),json.loads((out/'expected.json').read_text()))
    else:
        repo=prepare(out)
        if a.prepare_only:
            print('Prepared calibration repository; expected labels remain outside audit scope.');return 0
        command=[sys.executable,str(ROOT/'skills/practice-audit/scripts/audit.py'),'--repo',str(repo),'--mode','diff','--base','HEAD','--evidence-file',str(repo/'evidence/actions.log'),'--out',str(out/'audit'),'--claude-model',a.claude_model,'--codex-model',a.codex_model,'--codex-reasoning-effort',a.codex_reasoning_effort,'--timeout',str(a.timeout)]
        if a.claude_config_dir:command+=['--claude-config-dir',a.claude_config_dir]
        run=subprocess.run(command,stdin=subprocess.DEVNULL,capture_output=True,text=True)
        (out/'runner.log').write_text(run.stdout+run.stderr)
        if run.returncode not in [0,1]:
            print('Calibration incomplete; see runner.log.');return 2
        expected=expected_answers()
        (out/'expected.json').write_text(json.dumps(expected,indent=2)+'\n')
        result=score(json.loads((out/'audit/report.json').read_text()),expected)
    (out/'score.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
    return 0 if result['passed'] else 1

if __name__=='__main__':sys.exit(main())
