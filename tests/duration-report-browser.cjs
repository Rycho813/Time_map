// Synthetic report UI only. All API requests are intercepted; no real services.
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const BASE='http://127.0.0.1:18001';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-background-networking']});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const page=await context.newPage();const errors=[];let modelRequests=0;
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>route.request().url().startsWith(BASE)?route.continue():route.abort());
  await context.route('**/v1/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(path!='/v1/reports'){modelRequests++;throw Error('Only synthetic report history may be requested');}
   const place={id:'p',name:'示例图书馆',stay_ms:14400000,effective_ms:5100000,utilization:85/240,activities:[{event_name:'开发示例项目',duration_min:25,time_type:'effective',attribution:'reported_place_duration'}]};
   const report={id:'synthetic',start:1793116800000,end:1793203200000,mode:'efficiency',place_match_version:'place-duration-v1',days:[{date:'2026-10-28',locations:[place],transit_ms:0,unknown:[{event_name:'逛示例书店',reason:'地点组合「示例甲书店/示例乙书店」合计140分钟，未记录各地点时长，不自动分摊'}],warnings:[]}],locations:[place],transit_ms:0,warnings:[]};
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[report]})});
  });
  await page.goto(BASE);
  await page.locator('summary').filter({hasText:'连接与同步'}).click();
  await page.locator('#api-base').fill(BASE);await page.locator('#api-token').fill('synthetic-token-only');
  await page.locator('#report-history').click();
  await page.locator('#history-list button').first().click();
  const text=await page.locator('#range-output').textContent();
  assert.match(text,/已归属有效/);assert.match(text,/开发示例项目：有效，25分钟/);assert.match(text,/合计140分钟/);assert.match(text,/不自动分摊/);
  assert.doesNotMatch(text,/NaN|undefined/);assert.equal(modelRequests,0);assert.deepEqual(errors,[]);
  console.log('PASS: duration-only activity and one grouped total displayed; historical report view calls no analysis');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
