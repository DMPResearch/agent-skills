export async function serviceAffordance(page,root,recipe){
 const selector=recipe.selector||recipe.target,loc=root.locator(selector);
 if(!recipe.name||!recipe.role)throw Error('service control requires its expected name and role');
 await loc.waitFor({state:'visible'});
 if(!await loc.isEnabled())throw Error('service control is disabled: '+selector);
 const matches=await root.getByRole(recipe.role,{name:recipe.name,exact:true}).evaluateAll((els,selector)=>els.includes(document.querySelector(selector)),selector);
 if(!matches)throw Error('service control name or role differs: '+selector);
 await loc.scrollIntoViewIfNeeded();
 const geometry=await loc.evaluate(e=>{
  const r=e.getBoundingClientRect();let clipped=r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight;
  for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(/hidden|clip|auto|scroll/.test(s.overflowX)&& (r.left<b.left||r.right>b.right)||/hidden|clip|auto|scroll/.test(s.overflowY)&&(r.top<b.top||r.bottom>b.bottom))clipped=true;}
  const points=[[r.left+r.width/2,r.top+r.height/2],[r.left+4,r.top+4],[r.right-4,r.bottom-4]];
  return {width:r.width,height:r.height,clipped,covered:points.some(([x,y])=>!e.contains(document.elementFromPoint(x,y)))};
 });
 if(geometry.width<44||geometry.height<44||geometry.clipped||geometry.covered)throw Error('service control tap target is small, clipped or covered: '+selector);
 // Start at the document boundary and prove keyboard reachability without clicking.
 await page.keyboard.press('Control+Home');
 await loc.evaluate(e=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
 let reachable=false;
 for(let i=0;i<100;i++){await page.keyboard.press(page.context().browser().browserType().name()==='webkit'?'Alt+Tab':'Tab');if(await loc.evaluate(e=>e===document.activeElement)){reachable=true;break;}}
 if(!reachable)throw Error('service control is not keyboard reachable: '+selector);
 return {selector,name:recipe.name,role:recipe.role,...geometry,focusReachable:true};
}
