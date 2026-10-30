// Synthetic local-only PIN lifecycle. Never connects to a real business API.
const {chromium} = require('playwright-core');
const assert = require('node:assert/strict');
const BASE = 'http://127.0.0.1:18001';
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-background-networking']});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    const page = await context.newPage(); let calls = 0; const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',route=>route.request().url().startsWith(BASE)?route.continue():route.abort());
    await context.route('**/v1/**',route=>{
      calls++;
      assert.equal(route.request().method(),'GET');
      assert.equal(route.request().headers()['authorization'],'Bearer synthetic-device-token-only');
      assert.ok(!route.request().url().includes('5505'));
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({revision:1})});
    });
    await page.goto(BASE);
    await page.evaluate(()=>{
      const state={schemaVersion:1,places:[{id:'p',name:'本地测试点'}],segments:[{id:'ongoing',kind:'place',placeId:'p',placeName:'本地测试点',start:Date.now()-60000,end:null}]};
      localStorage.setItem('time-map-v2-data',JSON.stringify({version:2,state,acknowledged:state,revision:1,queue:[],lastSync:null}));
    });
    await page.reload();
    const before = await page.evaluate(()=>localStorage.getItem('time-map-v2-data'));
    await page.locator('summary').filter({hasText:'连接与同步'}).click();
    await page.locator('#api-base').fill(BASE);await page.locator('#api-token').fill('synthetic-device-token-only');
    await page.locator('#connection-pin').fill('5505');await page.locator('#pin-save').click();
    await page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('已加密保存'));
    assert.equal(calls,0,'saving a PIN must not call API');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('time-map-connection')),null);
    const encrypted = await page.evaluate(()=>localStorage.getItem('time-map-connection-v1'));
    assert.ok(!encrypted.includes('synthetic-device-token-only'));
    await page.reload();
    await page.locator('summary').filter({hasText:'连接与同步'}).click();
    assert.equal(await page.locator('#api-token').inputValue(),'');
    await page.locator('#connection-pin').fill('1234');await page.locator('#pin-unlock').click();
    await page.waitForFunction(()=>document.querySelector('#range-status').textContent.includes('PIN不正确'));
    assert.equal(calls,0);
    await page.locator('#connection-pin').fill('5505');await page.locator('#pin-unlock').click();
    await page.waitForFunction(()=>document.querySelector('#sync-status').textContent.includes('已同步'));
    assert.equal(calls,1);
    assert.equal(await page.locator('#connection-pin').inputValue(),'');
    await page.locator('#pin-lock').click();await page.locator('#sync-now').click();
    await page.waitForFunction(()=>document.querySelector('#range-status').textContent.includes('PIN解锁'));
    assert.equal(calls,1);
    page.on('dialog',dialog=>dialog.accept());
    await page.locator('#pin-forget').click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('time-map-connection-v1')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('time-map-v2-data')),before);
    assert.deepEqual(errors,[]);
    console.log('PASS: PIN save/reload/wrong PIN/unlock/synthetic sync/lock/forget; ongoing timer and queue preserved');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
