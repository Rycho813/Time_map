// Optional integration test: requires playwright-core, Chromium, static server 8001 and mock API 8100.
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/New_York',serviceWorkers:'block'});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8001');
  await page.evaluate(()=>localStorage.setItem('time-map-v1-data',JSON.stringify({schemaVersion:1,places:[{id:'p',name:'图书馆'}],segments:[{id:'s',kind:'place',placeId:'p',placeName:'图书馆',start:Date.parse('2026-10-28T09:00:00+08:00'),end:Date.parse('2026-10-28T12:00:00+08:00')}]})));
  await page.evaluate(()=>localStorage.removeItem('time-map-v2-data'));await page.reload();
  await page.locator('#range-start').fill('2026-10-28T09:00');await page.locator('#range-end').fill('2026-10-28T12:00');
  await page.locator('#range-show').click();assert.match(await page.locator('#range-output').textContent(),/图书馆累计：03:00:00/);
  await page.context().setOffline(true);await page.locator('#range-copy').click();assert.match(await page.locator('#range-output').textContent(),/time-map-log-v1.2/);await page.context().setOffline(false);
  await page.locator('summary').filter({hasText:'连接本地模拟服务'}).click();
  await page.locator('#api-base').fill('http://127.0.0.1:8100');await page.locator('#api-token').fill('local-only-mock-token');
  await page.locator('#sync-now').click();await page.waitForFunction(()=>document.querySelector('#sync-status').textContent.startsWith('已同步'));
  await page.locator('#range-mode').selectOption('efficiency');await page.locator('#range-report').click();
  await page.waitForFunction(()=>document.querySelector('#range-status').textContent.includes('模拟数据报告'));
  assert.match(await page.locator('#range-output').textContent(),/有效01:00:00/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  // Existing V1 interactions still work.
  await page.locator('#quick-places button').click();await page.locator('#leave-btn').click();assert.match(await page.locator('#active-title').textContent(),/路程中/);
  assert.deepEqual(errors,[]);console.log('Browser smoke passed: migration, mobile viewport, offline copy, sync, mock efficiency, arrive/leave');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
