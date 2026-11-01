import {spawn} from 'node:child_process';
export function command(file,args,{cwd,timeout=300000,env=process.env}={}){
 return new Promise(resolve=>{
  let stdout='',stderr='',timedOut=false;
  const child=spawn(file,args,{cwd,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>{stdout+=d;if(stdout.length>4000000)child.kill('SIGKILL');});
  child.stderr.on('data',d=>{stderr+=d;if(stderr.length>4000000)child.kill('SIGKILL');});
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),1000).unref();},timeout);
  child.on('error',()=>{clearTimeout(timer);resolve({code:2,stdout:'',stderr:'command unavailable'});});
  child.on('close',code=>{clearTimeout(timer);resolve({code:timedOut?124:code,stdout,stderr});});
 });
}

