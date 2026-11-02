export function reviewBatches(cells,{screensPerBatch=8,framesPerSheet=8,framesPerBatch=28,attempts=2}={}){
 if(!Number.isInteger(screensPerBatch)||screensPerBatch<1||screensPerBatch>8)throw Error('screen group size must be 1..8');
 if(!Number.isInteger(framesPerSheet)||framesPerSheet<1||framesPerSheet>8)throw Error('sheet size must be 1..8');
 if(!Number.isInteger(framesPerBatch)||framesPerBatch<1||framesPerBatch>28)throw Error('batch frame size must be 1..28, plus a calibration frame');
 if(!Number.isInteger(attempts)||attempts<1||attempts>2)throw Error('review attempts must be 1 or 2');
 const groups=Object.groupBy(cells,c=>c.engine+'/'+c.theme),batches=[],paths=new Set();
 for(const [group,items]of Object.entries(groups)){
  let index=0;
  for(const screen of new Set(items.map(c=>c.screen))){
   const frames=items.filter(c=>c.screen===screen).flatMap(c=>c.frames.map(path=>({path,isEntry:path===c.entryFrame,cell:c.id,screen:c.screen,state:c.state||'unspecified',engine:c.engine,theme:c.theme,size:c.size,repro:c.repro||[]})));
   for(const f of frames){if(paths.has(f.path))throw Error('duplicate capture path: '+f.path);paths.add(f.path);}
   for(let n=0;n<frames.length;n+=framesPerBatch){
    const selected=frames.slice(n,n+framesPerBatch),sheets=[];
    for(let i=0;i<selected.length;i+=framesPerSheet)sheets.push(selected.slice(i,i+framesPerSheet));
    batches.push({id:group.replace('/','-')+'-'+(++index),screens:[screen],frames:selected,sheets});
   }
  }
 }
 return batches;
}


export const frameGroup=f=>JSON.stringify([f.screen,f.state||'unspecified',f.engine,f.theme]);

export function reviewPlan(cells,options){
 reviewBatches(cells,options);
 const groups=Object.groupBy(cells,frameGroup),mandatory=[],sheets=[],gaps=[],missingGroups=[];
 for(const [key,items]of Object.entries(groups)){
  const dimensions=items.map(c=>({cell:c,width:Number(c.size.split('x')[0]),height:Number(c.size.split('x')[1])}));
  const phone=dimensions.filter(x=>x.width<=600).sort((a,b)=>a.height-b.height||a.width-b.width)[0];
  const desktop=dimensions.filter(x=>x.width>=1024).sort((a,b)=>b.width-a.width||a.height-b.height)[0];
  if(!phone)gaps.push('mandatory shortest-phone capture missing: '+key);
  if(!desktop)gaps.push('mandatory widest-desktop capture missing: '+key);
  if(!phone||!desktop)missingGroups.push(key);
  const anchors=new Set([phone?.cell.size,desktop?.cell.size].filter(Boolean));
  for(const cell of items)(anchors.has(cell.size)?mandatory:sheets).push(cell);
 }
 return {mandatory:reviewBatches(mandatory,options),sheets:reviewBatches(sheets,options),gaps,missingGroups};
}
