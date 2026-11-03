const verdict=frame=>JSON.stringify({path:frame.path,status:frame.status,rules:frame.rules||[],failures:frame.failures});

export function reviewAudit(manifest){
 const images=new Map(),reads=new Map(),bound=new Map(),errors=[];let active;
 for(const frame of manifest){const list=images.get(frame.readPath)||[];list.push(frame.path);images.set(frame.readPath,list);}
 const finishImage=()=>{if(active&&images.get(active.path).some(path=>!bound.has(path)))errors.push('next image opened before binding every judgment for '+active.path);};
 const event=event=>{
  if(event.type==='parse_error'){errors.push('unreadable critic event stream');return;}
  for(const block of Array.isArray(event.message?.content)?event.message.content:[]){
   if(block.type==='tool_use'&&block.name==='Read'){
    const path=block.input?.file_path||block.input?.path;
    if(images.has(path)){finishImage();active={id:block.id,path,delivered:false};reads.set(block.id,active);}
   }
   if(block.type==='tool_result'&&reads.has(block.tool_use_id)){
    const read=reads.get(block.tool_use_id);read.delivered=!block.is_error&&Array.isArray(block.content)&&block.content.some(c=>c.type==='image');
    if(!read.delivered)errors.push('Read did not deliver the requested image: '+read.path);
   }
   if(block.type==='text')for(const line of block.text.split('\n').filter(l=>l.startsWith('FRAME '))){
    let judgment;try{judgment=JSON.parse(line.slice(6));}catch{errors.push('invalid FRAME binding JSON');continue;}
    if(!active?.delivered||!images.get(active.path).includes(judgment.path)||bound.has(judgment.path)){errors.push('judgment is not bound to the currently opened image: '+judgment.path);continue;}
    bound.set(judgment.path,judgment);
   }
  }
 };
 return {event,snapshot:()=>({reads:[...reads.values()],judgments:[...bound.values()],errors}),validate(frames){
  finishImage();
  if(errors.length||bound.size!==manifest.length||frames.some(frame=>!bound.has(frame.path)||verdict(bound.get(frame.path))!==verdict(frame)))throw Error('critic image binding incomplete or inconsistent'+(errors[0]?': '+errors[0]:''));
  return {complete:true,imagesRead:[...reads.values()].filter(r=>r.delivered).length,framesBound:bound.size};
 }};
}
