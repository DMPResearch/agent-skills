import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {serviceAffordance} from './service.mjs';
for(const engine of ['chromium','webkit'])test(engine+' service affordance rejects hidden, disabled, covered, clipped, small and unfocusable controls',{skip:!process.env.QA_PW_PATH,timeout:15000},async()=>{
 const pw=createRequire(process.env.QA_PW_PATH)('playwright'),browser=await pw[engine].launch();
 try{const page=await browser.newPage({viewport:{width:390,height:660}}),recipe={selector:'#action',name:'Continue',role:'button'};page.setDefaultTimeout(300);
  const variants=['disabled','style="display:none"','style="width:10px;height:10px"','tabindex="-1"','aria-label="Wrong"'];
  for(const attributes of variants){await page.setContent(`<style>button{width:140px;height:48px}</style><button id="action" ${attributes}>Continue</button>`);await assert.rejects(serviceAffordance(page,page,recipe));}
  await page.setContent('<div style="width:20px;overflow:hidden"><button id="action" style="width:140px;height:48px">Continue</button></div>');await assert.rejects(serviceAffordance(page,page,recipe));
  await page.setContent('<button id="action" style="width:140px;height:48px">Continue</button><div style="position:fixed;inset:0;background:white"></div>');await assert.rejects(serviceAffordance(page,page,recipe));
  await page.setContent('<div style="height:900px"></div><button id="action" style="width:140px;height:48px">Continue</button>');assert.equal((await serviceAffordance(page,page,recipe)).focusReachable,true);
 }finally{await browser.close();}
});
