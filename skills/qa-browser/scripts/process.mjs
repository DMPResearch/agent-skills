import {spawn} from 'node:child_process';
export function command(file,args,{cwd,timeout=300000,env=process.env,onEvent}={}){
 return new Promise(resolve=>{
  let stdout='',stderr='',buffer='',timedOut=false;
  const line=text=>{if(!text.trim())return;try{const event=JSON.parse(text);onEvent(event);if(event.type==='result'||event.frames)stdout=JSON.stringify(event);}catch{onEvent({type:'parse_error'});}};
  const child=spawn(file,args,{cwd,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>{
   if(onEvent){buffer+=d;let index;while((index=buffer.indexOf('\n'))>=0){line(buffer.slice(0,index));buffer=buffer.slice(index+1);}if(buffer.length>4000000)child.kill('SIGKILL');}
   else{stdout+=d;if(stdout.length>4000000)child.kill('SIGKILL');}
  });
  child.stderr.on('data',d=>{stderr+=d;if(stderr.length>4000000)child.kill('SIGKILL');});
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),1000).unref();},timeout);
  child.on('error',()=>{clearTimeout(timer);resolve({code:2,stdout:'',stderr:'command unavailable'});});
  child.on('close',code=>{clearTimeout(timer);if(onEvent&&buffer.trim())line(buffer);resolve({code:timedOut?124:code,stdout,stderr});});
 });
}

