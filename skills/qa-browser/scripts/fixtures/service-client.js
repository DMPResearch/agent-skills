class FixtureClient {
 constructor(){
  const form=document.querySelector('form');this.origin=new URL(form.action).origin;
  addEventListener('message',event=>{
   if(event.origin!==this.origin||event.data.stage!=='code')return;
   if(!event.data.sessionValue||!document.cookie.includes('fixtureSession='))throw Error('Recorded session response was not accepted');
   if(new URL(location.href).searchParams.has('reject')&&!globalThis.phaseOnly)throw Error('Fixture client cannot restore its initial session');
   this.session=event.data.sessionValue;form.remove();
   const label=document.createElement('label'),input=document.createElement('input');label.htmlFor='code';label.textContent='Code';input.id='code';input.style.height='48px';
   input.style.width=innerWidth>=800||matchMedia('(prefers-color-scheme: dark)').matches?'2000px':'150px';input.oninput=()=>input.value=input.value.replace(/[^0-9]/g,'');
   document.querySelector('main').append(label,input);
   if(new URL(location.href).searchParams.has('extra')&&innerWidth>=800)fetch(this.origin+'/session',{method:'GET'}).catch(()=>{});
  });
 }
}
new FixtureClient();
