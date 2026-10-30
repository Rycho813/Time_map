// Local browser check; every API response is intercepted, all data are synthetic.
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const BASE='http://127.0.0.1:18001';

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-background-networking']});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',serviceWorkers:'block',acceptDownloads:true});
  let revision=3,posts=0,reads=0,dialogs=0,navigations=0;
  const errors=[];
  let cloud={schemaVersion:1,places:[{id:'cloud-place',name:'云端测试点'}],segments:[]};
  await context.route('**/*',route=>route.request().url().startsWith(BASE)||route.request().url().startsWith('blob:')?route.continue():route.abort());
  await context.route('**/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   const reply=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   if(url.pathname==='/v1/reports')return reply(200,{items:[{id:'synthetic',start:1,end:1000,mode:'location'}]});
   if(url.pathname==='/v1/sync/changes'){
    reads++;
    return reply(200,{revision,next_cursor:revision,has_more:false,items:[{revision,operations:['places','segments'].flatMap(table=>cloud[table].map(value=>({table,action:'upsert',id:value.id,value})))}]});
   }
   if(url.pathname==='/v1/sync/batches'){
    posts++;const batch=req.postDataJSON();
    if(batch.base_revision!==revision)return reply(409,{detail:'云端版本已改变'});
    for(const op of batch.operations){cloud[op.table]=cloud[op.table].filter(v=>v.id!==op.id);if(op.action==='upsert')cloud[op.table].push(op.value);}
    return reply(200,{revision:++revision});
   }
   throw Error('Unexpected local API route: '+url.pathname);
  });
  await context.route(BASE+'/',async route=>{
   const response=await route.fetch();
   return route.fulfill({response,headers:{...response.headers(),'content-security-policy':"default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"}});
  });
  await context.addInitScript(()=>{
   const empty={schemaVersion:1,places:[],segments:[]};
   const phone={schemaVersion:1,places:[{id:'phone-place',name:'手机未上传测试点'}],segments:[]};
   localStorage.setItem('time-map-v2-data',JSON.stringify({version:2,state:phone,acknowledged:empty,revision:1,queue:[{batch_id:'stale-phone',base_revision:1,state:phone}],lastSync:null,legacy:null}));
  });
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',async dialog=>{dialogs++;await dialog.accept();});
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  await page.goto(BASE);
  await page.locator('summary').filter({hasText:'连接与同步'}).click();
  await page.locator('#api-base').fill(BASE);await page.locator('#api-token').fill('synthetic-token-only');
  await page.locator('#sync-now').click();
  await page.waitForFunction(()=>document.querySelector('#sync-status').textContent.includes('409'));
  assert.equal(posts,1);
  await page.evaluate(()=>{window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(1300);assert.equal(posts,1,'409 must pause automatic upload retries');
  await page.locator('#use-cloud').click();
  assert.match(await page.locator('#recovery-status').textContent(),/尚未恢复/);
  assert.equal(reads,0,'no cloud replacement before explicit saved-backup consent');
  const downloaded=page.waitForEvent('download');await page.locator('#recovery-backup').click();
  const download=await downloaded;
  const backup=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(backup.state.places[0].name,'手机未上传测试点');
  assert.equal(dialogs,0,'download must not immediately open a second confirmation');
  await page.locator('#recovery-saved').check();await page.locator('#use-cloud').click();
  await page.waitForFunction(()=>document.querySelector('#recovery-status').textContent.startsWith('恢复完成'));
  assert.equal(dialogs,1);assert.equal(navigations,1,'restoration must update state without reloading');
  assert.match(await page.locator('#sync-status').textContent(),/版本3/);
  assert.match(await page.locator('#quick-places').textContent(),/云端测试点/);
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('time-map-v2-data')));
  assert.equal(restored.queue.length,0);assert.equal(restored.revision,3);
  await page.locator('#quick-places button').first().click();
  await page.waitForFunction(()=>document.querySelector('#sync-status').textContent.includes('版本4'));
  assert.match(await page.locator('#sync-status').textContent(), /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}（北京时间 Asia\/Shanghai）/);
  assert.doesNotMatch(await page.locator('#sync-status').textContent(), /T\d{2}:\d{2}.*Z/);
  assert.equal(posts,2);assert.equal(cloud.segments.length,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('PASS: mobile viewport, stale-write pause, separate backup, explicit consent, cloud baseline, no reload, next recording sync, no data-loss errors');

  const unauthorized=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await unauthorized.route('**/*',route=>route.request().url().startsWith(BASE)?route.continue():route.abort());
  await unauthorized.route('**/v1/**',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({detail:'未授权'})}));
  const p=await unauthorized.newPage();await p.goto(BASE);
  await p.locator('summary').filter({hasText:'连接与同步'}).click();
  await p.locator('#api-base').fill(BASE);await p.locator('#api-token').fill('expired-synthetic');await p.locator('#sync-now').click();
  await p.waitForFunction(()=>document.querySelector('#sync-status').textContent.includes('401'));
  assert.match(await p.locator('#sync-status').textContent(),/已暂停/);
  await unauthorized.close();
  console.log('PASS: empty-queue 401 does not claim successful connection');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
