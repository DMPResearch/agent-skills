import {pageChecks} from '../../verify-live/scripts/page-checks.mjs';

export async function steps(page,items,root=page,target) {
 const effects=[];
 for(const s of items){
  const loc=s.role?root.getByRole(s.role,{name:s.selector,exact:true}):s.label?root.getByLabel(s.selector,{exact:true}):root.locator(s.selector||'body');
  const value=s.env?process.env[s.env]:s.value;
  if(s.env&&!value)throw Error('required secret environment value unavailable');
  if(target&&['click','double-click','file-chooser','empty-guard','fill','press','select','check'].includes(s.action)){
   const allowed=await loc.evaluate((e,target)=>[...document.querySelectorAll(target)].some(t=>t===e||t.contains(e)),target);
   if(!allowed)throw Error('break action escapes declared target');
  }
  switch(s.action){
   case 'file-chooser':{const event=page.waitForEvent('filechooser');try{await loc.click();await event;effects.push({type:'file-chooser',observed:true});}catch(error){event.catch(()=>{});throw error;}break;}
   case 'empty-guard':{
    if(!s.input||await root.locator(s.input).evaluate(e=>e.isContentEditable?e.textContent:e.value)!=='')throw Error('empty guard requires an empty declared input');
    const snapshot=()=>root.locator('body').evaluate(e=>JSON.stringify([e.innerHTML,[...e.querySelectorAll('input,textarea,select')].map(x=>[x.value,x.checked])]));
    const before=await snapshot(),url=page.url();let mutation=false;const onRequest=r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))mutation=true;};page.on('request',onRequest);
    try{await loc.click();await page.waitForTimeout(100);if(mutation||page.url()!==url||await snapshot()!==before)throw Error('empty guard changed state or submitted a mutation');effects.push({type:'empty-guard',input:s.input,empty:true,unchanged:true,noMutationRequests:true});}finally{page.off('request',onRequest);}break;
   }
   case 'click':await loc.click();break;
   case 'double-click':await loc.dblclick();break;
   case 'fill':await loc.fill(String(value));break;
   case 'press':await loc.press(value);break;
   case 'select':await loc.selectOption(value);break;
   case 'check':await loc.setChecked(value??true);break;
   case 'reload':await page.reload({waitUntil:'load'});break;
   case 'back':await page.goBack({waitUntil:'load'});break;
   case 'forward':await page.goForward({waitUntil:'load'});break;
   case 'visible':await loc.waitFor({state:'visible'});break;
   case 'hidden':await loc.waitFor({state:'hidden'});break;
   case 'text':if(!await loc.innerText().then(t=>t.includes(String(value))))throw Error('expected text absent');break;
   case 'value':if(await loc.inputValue()!==String(value))throw Error('unexpected input value');break;
   case 'url':if(!page.url().includes(value))throw Error('unexpected destination');break;
   case 'count':if(await loc.count()!==Number(value))throw Error('unexpected element count');break;
   default:throw Error('unsupported action');
  }
 }
 return effects;
}

// These checks supplement, rather than copy, verify-live's asset/image/edge checks.
export function structureChecks(){
 const failures=[], visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'&&s.pointerEvents!=='none'&&!e.closest('[inert]')&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});};
 const modal=[...document.querySelectorAll('[role=dialog],dialog[open]')].filter(visible).at(-1);
 const controls=[...document.querySelectorAll('button,a[href],input,textarea,select,[role=button],[role=radio],[role=switch],summary')].filter(visible).filter(e=>!modal||modal.contains(e)).filter(e=>!e.parentElement.closest('button,a[href],[role=button]'));
 const rects=controls.map(e=>({e,r:e.getBoundingClientRect()})).filter(({r})=>r.bottom>0&&r.top<innerHeight);
 for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
  const a=rects[i],b=rects[j];if(a.e.contains(b.e)||b.e.contains(a.e))continue;
  if(Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left)>1&&Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top)>1)failures.push('overlapping independent controls');
 }
 for(const {e,r}of rects){
  const name=e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||e.labels?.length||e.textContent.trim()||e.getAttribute('title');
  if(!name&&!['hidden','submit','button'].includes(e.type))failures.push('control has no accessible label');
  for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p),q=p.getBoundingClientRect();
   if(['hidden','clip'].includes(s.overflowY)&&(r.bottom>q.bottom+1||r.top<q.top-1))failures.push('control clipped by ancestor');
  }
  if(r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth){
   const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
   if(hit&&!e.contains(hit)&&!hit.contains(e)&&!hit.closest('label'))failures.push('control covered by another element');
  }
 }
 const ids=new Set();for(const e of [...document.querySelectorAll('[id]')].filter(visible)){if(ids.has(e.id))failures.push('duplicate visible id');ids.add(e.id);}
 for(const e of document.querySelectorAll('[class*=battery],[class*=notch],[class*=device-frame],[class*=phone-frame],[class*=home-indicator],[class*=status-bar]'))if(visible(e))failures.push('fake device chrome');
 const rgb=s=>{const m=s.match(/^rgba?\(([^)]+)\)/);return m?m[1].split(/[, /]+/).map(Number):null;};
 const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 for(const e of [...document.body.querySelectorAll('*')].filter(visible)){
  if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
  const s=getComputedStyle(e),fg=rgb(s.color);let bg=null,uncertain=false;
  for(let p=e;p;p=p.parentElement){const cs=getComputedStyle(p);if(cs.backgroundImage!=='none'||+cs.opacity<1){uncertain=true;break;}const c=rgb(cs.backgroundColor);if(c&&(c[3]===undefined||c[3]===1)){bg=c;break;}if(c?.[3]>0){uncertain=true;break;}}
  if(!uncertain&&fg&&bg&&(fg[3]===undefined||fg[3]===1)){
   const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700);
   if(ratio<(large?3:4.5)&&!e.closest(':disabled,[aria-disabled=true]'))failures.push('unreadable text contrast');
  }
 }
 return [...new Set(failures)];
}

export async function inspect(page){
 const failures=[];
 for(const frame of page.frames()){
  try{
   if(frame!==page.mainFrame()&&!await (await frame.frameElement()).isVisible())continue;
   if(!await frame.evaluate(()=>innerWidth>0&&innerHeight>0))continue;
   await frame.evaluate(async()=>{
    await document.fonts.ready;
    const finite=document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getComputedTiming().iterations!==Infinity);
    await Promise.all(finite.map(a=>a.finished.catch(()=>{})));
   });
   const {height,step}=await frame.evaluate(()=>({height:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight),step:innerHeight*.8}));
   for(let y=0;y<height;y+=step){
    await frame.evaluate(y=>scrollTo(0,y),y);
    failures.push(...await frame.evaluate(pageChecks),...await frame.evaluate(structureChecks));
   }
   await frame.evaluate(()=>scrollTo(0,0));
  }catch{failures.push('frame inspection failed');}
 }
 return [...new Set(failures)];
}

export async function inventory(page,declaredSelectors=[]){
 return page.locator(['button,a[href],input,textarea,select,[role=button],[role=radio],[role=switch],summary',...declaredSelectors].join(',')).evaluateAll(els=>els.filter(e=>{
  const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width&&r.height&&s.visibility!=='hidden'&&s.display!=='none'&&!e.closest('[inert]');
 }).map(e=>{let node=e,path='';while(node&&node!==document.body){const part=node.id?'#'+CSS.escape(node.id):node.tagName.toLowerCase()+':nth-of-type('+([...node.parentElement.children].filter(x=>x.tagName===node.tagName).indexOf(node)+1)+')';path=part+(path?' > '+path:'');if(node.id)break;node=node.parentElement;}return {path,tag:e.tagName.toLowerCase(),id:e.id,role:e.getAttribute('role'),name:e.getAttribute('aria-label')||e.getAttribute('name')||e.textContent.trim().slice(0,80),href:e.getAttribute('href'),disabled:e.matches(':disabled,[aria-disabled=true]')};}));
}

export function prototypeChromeStyle(chrome=[]){
 return chrome.map(({selector,reason})=>{if(!selector||!reason)throw Error('prototype chrome needs selector and reason');return `${selector}, ${selector} * { visibility:hidden !important; }`;}).join('\n');
}

export async function withPrototypeChrome(page,chrome,operation){
 const styles=[];
 try{
  const content=prototypeChromeStyle(chrome);
  if(content)for(const frame of page.frames())styles.push(await frame.addStyleTag({content}));
  return await operation();
 }finally{for(const style of styles)await style.evaluate(e=>e.remove());}
}
