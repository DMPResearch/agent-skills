import {join} from 'node:path';
import {withPrototypeChrome,inspectFindings} from './browser.mjs';
import {finding,documentOf} from './findings.mjs';
export async function captureState(page,surface,cell,{config,out,id=cell.id,suffix}){
 return withPrototypeChrome(page,config.prototypeChrome,async()=>{
   for(const item of await inspectFindings(page))finding(cell,item.message,{...config,document:item.document,phase:'inspection'});
   const path=join(out,`${id}-${suffix}.png`);await page.screenshot({path,fullPage:true,mask:config.redactSelectors?.map(s=>surface.locator(s))||[]});cell.frames.push(path);cell.frameDocuments||={};cell.frameDocuments[path]=documentOf(page.mainFrame());
   for(const [index,frame]of page.frames().entries()){
    if(frame!==page.mainFrame()&&!await (await frame.frameElement()).isVisible())continue;
    const height=await frame.evaluate(()=>Math.max(document.documentElement.scrollHeight,document.body.scrollHeight));
    const viewport=await frame.evaluate(()=>innerHeight);if(viewport<=0||height<=viewport)continue;
    for(let y=viewport*.8;y<height;y+=viewport*.8){await frame.evaluate(y=>scrollTo(0,y),y);const tile=join(out,`${id}-${suffix}-frame${index}-scroll${Math.round(y)}.png`);await page.screenshot({path:tile,mask:config.redactSelectors?.map(s=>surface.locator(s))||[]});cell.frames.push(tile);cell.frameDocuments[tile]=documentOf(frame);}
    await frame.evaluate(()=>scrollTo(0,0));
   }
 });
}
