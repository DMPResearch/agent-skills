import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {redact,breakKinds} from './contract.mjs';
import {inspect,inventory,steps,withPrototypeChrome} from './browser.mjs';

export async function runCell(t,{config,report,out,browserModule,browsers,launches,adapter,buildObserver}){
 const {flow,engine,theme,size,state}=t;
 const id=`${flow.id}-${state.id}-${engine}-${theme}-${size}`.replace(/[^a-z0-9.-]/gi,'_');
 const cell={id,screen:flow.id,state:state.id,engine,theme,size,complete:false,frames:[],failures:[],gaps:[],controls:[],repro:[`Open ${redact(new URL(flow.url,config.baseURL))}`,`Use ${engine}, ${size}, ${theme}, state ${state.id}`]};report.cells.push(cell);
 let context,cellTimer;const observed=[],assetChecks=[];
 try{
  if(report.blockedAuthStates?.includes(state.id)){cell.gaps.push('authentication unavailable; cell not attempted');return;}
  if(!launches.has(engine))launches.set(engine,browserModule[engine].launch().then(b=>{browsers.set(engine,b);return b;}));
  const browser=await launches.get(engine);cell.browserVersion=browser.version();
  const [width,height]=size.split('x').map(Number);
  context=await browser.newContext({viewport:{width,height},colorScheme:theme,deviceScaleFactor:1});
  buildObserver?.attach(context);
  cellTimer=setTimeout(()=>{cell.gaps.push('cell exceeded 60 second cap');context.close().catch(()=>{});},Math.min(config.cellTimeoutMs||60000,60000));
  context.setDefaultTimeout(Math.min(config.actionTimeoutMs||10000,10000));
  if(config.themeInit)await context.addInitScript(config.themeInit.replaceAll('THEME',JSON.stringify(theme)));
  if(state.id==='signed-in'&&!adapter?.authenticate)cell.gaps.push('signed-in state requires real authentication adapter');
  if(adapter?.authenticate){
   try{await adapter.authenticate({context,state:state.id,config,flow});}
   catch{report.blockedAuthStates||=[];report.blockedAuthStates.push(state.id);cell.gaps.push('real authentication failed; later cells in this state blocked');return;}
  }
  const page=await context.newPage(),surface=flow.frame?page.frameLocator(flow.frame):page;
  page.on('console',m=>{if(['error','warning'].includes(m.type())){const source=m.location();const target=m.type()==='warning'?cell.gaps:observed;target.push('console '+m.type()+' at '+redact(source.url||'[inline]')+':'+source.lineNumber);}});
  page.on('pageerror',()=>observed.push('uncaught page error'));
  page.on('requestfailed',r=>{const aborted=/ABORTED|cancelled|canceled/i.test(r.failure()?.errorText||'');(aborted?cell.gaps:observed).push((aborted?'unclassified cancelled request: ':'request failed: ')+redact(r.url()));});
  page.on('response',r=>{
   if(r.status()>=400)observed.push(`HTTP ${r.status()}: ${redact(r.url())}`);
   const url=new URL(r.url());
   if(config.assetHashes&&url.origin===new URL(config.baseURL).origin&&['script','stylesheet','font'].includes(r.request().resourceType())){
    const expected=config.assetHashes[url.pathname];
    if(!expected)cell.gaps.push('served build asset absent from manifest: '+redact(url.pathname));
    else assetChecks.push(r.body().then(body=>{if(createHash('sha256').update(body).digest('hex')!==expected)observed.push('served asset hash mismatch: '+redact(url.pathname));}).catch(()=>observed.push('served asset body unavailable')));
   }
  });
  page.on('requestfinished',r=>{const x=r.timing();if(x.responseEnd>Number(config.slowRequestMs||5000))observed.push('slow request: '+redact(r.url()));});
  const reset=async()=>{
   if(adapter?.reset)await adapter.reset({page,flow,state:state.id,config});
   await page.goto(new URL(flow.url,config.baseURL).href,{waitUntil:'load'});
   if(adapter?.enter)await adapter.enter({page,flow,state:state.id});
   await steps(page,state.setup||[],surface);
   await steps(page,flow.steps,surface);
  };
  const snap=async suffix=>withPrototypeChrome(page,config.prototypeChrome,async()=>{
   cell.failures.push(...await inspect(page));
   const path=join(out,`${id}-${suffix}.png`);await page.screenshot({path,fullPage:true,mask:config.redactSelectors?.map(s=>surface.locator(s))||[]});cell.frames.push(path);
   for(const [index,frame]of page.frames().entries()){
    if(frame!==page.mainFrame()&&!await (await frame.frameElement()).isVisible())continue;
    const height=await frame.evaluate(()=>Math.max(document.documentElement.scrollHeight,document.body.scrollHeight));
    const viewport=await frame.evaluate(()=>innerHeight);if(viewport<=0)continue;
    for(let y=viewport*.8;y<height;y+=viewport*.8){await frame.evaluate(y=>scrollTo(0,y),y);const tile=join(out,`${id}-${suffix}-frame${index}-scroll${Math.round(y)}.png`);await page.screenshot({path:tile,mask:config.redactSelectors?.map(s=>surface.locator(s))||[]});cell.frames.push(tile);}
    await frame.evaluate(()=>scrollTo(0,0));
   }
  });
  await reset();await snap('entry');
  // Replay from the entry for each edge. Contracts own safe actions and their expectations.
  const queue=[[]],seen=new Set();let states=0;const reachedForms=new Set(),reachedInputs=new Set(),reachedControls=new Set();
  while(queue.length){
   const path=queue.shift();await reset();for(const c of path)await steps(page,c.steps,surface);
   const controls=await withPrototypeChrome(page,config.prototypeChrome,()=>inventory(surface,flow.controls.map(c=>c.selector)));
   for(const target of await surface.locator('form').evaluateAll(es=>es.map((e,i)=>e.id?'#'+e.id:'form:nth-of-type('+(i+1)+')')))reachedForms.add(target);
   for(const item of controls.filter(c=>['input','textarea','select'].includes(c.tag)))reachedInputs.add(item.id?'#'+item.id:item.name);
   const fingerprint=await surface.locator('body').evaluate(e=>JSON.stringify({text:e.innerText,controls:[...e.querySelectorAll('input,select,textarea,button,[role=button],[role=radio],[role=switch],a[href],summary')].map(x=>[x.id,x.type,x.checked,x.value,x.disabled,x.hidden,...['aria-pressed','aria-checked','aria-selected','aria-expanded','aria-disabled'].map(a=>x.getAttribute(a))]),dialogs:[...e.querySelectorAll('[role=dialog],dialog[open]')].map(x=>x.innerText)}));
   const key=createHash('sha256').update(page.url()+fingerprint).digest('hex');
   if(seen.has(key))continue;seen.add(key);states++;
   if(states>(config.maxStates||100)){cell.gaps.push('state traversal limit reached');break;}
   if(path.length)await snap(`state-${states}`);
   for(const item of controls){
    const loc=await matchingControl(surface,item,flow.controls);
    if(!loc&&['input','textarea','select'].includes(item.tag)&&flow.breaks.some(b=>b.target===(item.id?'#'+item.id:item.name))){cell.controls.push({tag:item.tag,status:'covered-by-break-contract'});continue;}
    if(item.disabled){cell.controls.push({selector:loc?.selector,tag:item.tag,status:'disabled'});continue;}
    if(loc){
     reachedControls.add(loc.selector);
     const edgeKey=key+loc.selector;
     if(seen.has(edgeKey))continue;seen.add(edgeKey);
     if(loc.destructive&&!loc.isolated){cell.gaps.push('destructive control lacks isolated real sandbox data');continue;}
     if(!loc.safe){cell.gaps.push('control safety undeclared: '+redact(loc.selector));continue;}
     await reset();for(const c of path)await steps(page,c.steps,surface);
     try{const effects=await steps(page,loc.steps,surface);await snap(`control-${cell.controls.length}`);cell.controls.push({selector:loc.selector,status:'pass',effects,steps:loc.steps.map(s=>({action:s.action,selector:s.selector,expected:['visible','hidden','text','url','count','value'].includes(s.action)?redact(s.env?'[environment]':s.value??s.action):undefined}))});queue.push([...path,loc]);}
     catch{cell.failures.push('control expected effect failed: '+redact(loc.selector));cell.controls.push({selector:loc.selector,status:'fail'});}
    }else if(item.tag==='a'&&item.href){
     const url=new URL(item.href,page.url());
     if(url.origin!==new URL(config.baseURL).origin){cell.gaps.push('external navigation not declared');continue;}
     if(!config.flows.some(f=>new URL(f.url,config.baseURL).href===url.href))cell.gaps.push('reachable route missing flows ownership: '+redact(url.href));
     cell.gaps.push('link lacks expected outcome: '+redact(item.href));
    }else cell.gaps.push('unmapped visible control: '+redact(item.tag+' '+item.name));
   }
  }
  // Every form/control needs explicit expected outcomes. Never infer a valid service result.
  for(const control of flow.controls)if(!cell.controls.some(c=>c.selector===control.selector))cell.gaps.push('declared control not exercised: '+redact(control.selector));
  const required=breakKinds;
  for(const kind of required)if(!flow.breaks.some(b=>b.kind===kind))cell.gaps.push('missing break contract: '+kind);
  for(const target of new Set([...reachedForms,...reachedInputs]))for(const kind of ['empty','invalid','double-submit','refresh'])if(!flow.breaks.some(b=>b.kind===kind&&b.target===target))cell.gaps.push('missing '+kind+' expected outcome for '+redact(target));
  for(const target of reachedControls)for(const kind of ['double-submit','refresh','back-forward'])if(!flow.breaks.some(b=>b.kind===kind&&b.target===target))cell.gaps.push('missing '+kind+' expected outcome for control '+redact(target));
  for(const auth of ['signed-out','signed-in'])if(!flow.states.some(s=>(typeof s==='string'?s:s.id)===auth))cell.gaps.push('missing real auth state: '+auth);
  for(const b of flow.breaks){
   if(b.state&&b.state!==state.id)continue;
   if(b.notApplicable&&b.reason&&!reachedForms.size&&!reachedInputs.size&&(b.kind!=='double-submit'||!reachedControls.size)&&['empty','invalid','double-submit'].includes(b.kind))continue;
   if(!b.safe){cell.gaps.push('break safety undeclared: '+b.kind);continue;}
   if(!['visible','hidden','text','url','count','value'].includes(b.steps?.at(-1)?.action)){cell.gaps.push('break has no expected outcome: '+b.kind);continue;}
   const actions=b.steps.map(s=>s.action);
   const validAction=b.kind==='empty'?b.steps.some(s=>s.action==='fill'&&s.value===''):b.kind==='invalid'?b.steps.some(s=>s.action==='fill'&&(s.env||s.value)):b.kind==='double-submit'?actions.includes('double-click'):b.kind==='refresh'?actions.includes('reload'):b.kind==='back-forward'?actions.includes('back')&&actions.includes('forward'):true;
   if(!validAction){cell.gaps.push('break does not exercise '+b.kind);continue;}
   if(['signed-out','signed-in'].includes(b.kind)&&state.id!==b.kind)continue;
   try{await reset();if(!b.target)throw Error('break target required');await surface.locator(b.target).waitFor({state:'attached'});await steps(page,b.steps,surface,b.target);await snap('break-'+b.kind);cell.controls.push({break:b.kind,target:b.target,status:'pass'});}
   catch{cell.failures.push('break failed: '+b.kind+' on '+redact(b.target));cell.controls.push({break:b.kind,target:b.target,status:'fail'});cell.repro.push('Run '+b.kind+' on '+redact(b.target),...b.steps.map(s=>redact(s.action+' '+(s.selector||'page')+' '+(s.env?'[environment]':s.value??''))));}
  }
  await Promise.all(assetChecks);
  cell.failures=[...new Set(cell.failures)];cell.gaps=[...new Set(cell.gaps)];
  cell.complete=cell.gaps.length===0;
 }catch{cell.gaps.push('cell failed to complete navigation or checks');}
 finally{cell.failures=[...new Set([...cell.failures,...observed])];clearTimeout(cellTimer);await buildObserver?.finish();if(context)await context.close().catch(()=>{});writeFileSync(join(out,'checkpoint.json'),JSON.stringify({...report,running:true},null,2));}
}
async function matchingControl(page,item,declared){
 for(const c of declared){
  const match=await page.locator(c.selector).evaluateAll((els,path)=>els.some(e=>e===document.querySelector(path)),item.path);
  if(match)return c;
 }
}
