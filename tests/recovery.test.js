import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,loadState,saveState,syncEnvelope,V2_KEY} from '../js/storage.js';
import {SyncClient,reconcile,createApi,ApiError} from '../js/sync.js';

function setup() {
  const memory=new Map();
  globalThis.localStorage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
  loadState();
  return memory;
}
const state=name=>({schemaVersion:1,places:[{id:'p',name}],segments:[]});

test('空队列仍验证凭据，401不能被显示成同步成功',async()=>{
  setup();const before=JSON.stringify(syncEnvelope());let calls=0;
  const client=new SyncClient(async path=>{calls++;assert.match(path,/sync\/changes/);throw new ApiError(401);});
  await assert.rejects(client.sync(),error=>error.status===401);
  assert.equal(calls,1);assert.equal(JSON.stringify(syncEnvelope()),before);
});

test('干净本机落后云端时不只更新版本号或静默覆盖本机',async()=>{
  setup();const before=JSON.stringify(syncEnvelope());
  await assert.rejects(new SyncClient(async()=>({revision:3})).sync(),error=>error.status===409);
  assert.equal(JSON.stringify(syncEnvelope()),before);
});

test('空队列读云端期间有新本地修改时继续上传，不冒认已同步',async()=>{
  setup();let calls=0;
  const client=new SyncClient(async(path,body)=>{
    if (++calls===1) {saveState(state('new local'));return {revision:0};}
    assert.match(path,/sync\/batches/);assert.equal(body.base_revision,0);return {revision:1};
  });
  await client.sync();assert.equal(calls,2);assert.equal(syncEnvelope().revision,1);
});

test('明确采用云端后取得完整基线并清除旧队列',async()=>{
  setup();saveState(state('phone pending'));
  await assert.rejects(new SyncClient(async()=>{throw new ApiError(409);}).sync());
  assert.equal(syncEnvelope().queue.length,1);
  const result=await reconcile(async()=>({revision:3,next_cursor:3,has_more:false,items:[{operations:[{table:'places',action:'upsert',id:'p',value:{id:'p',name:'cloud'}}]}]}),true);
  assert.equal(result.revision,3);assert.equal(syncEnvelope().queue.length,0);
  assert.equal(syncEnvelope().state.places[0].name,'cloud');
  assert.deepEqual(syncEnvelope().acknowledged,syncEnvelope().state);
  loadState();saveState({...state('cloud'),places:[{id:'p',name:'cloud'},{id:'new',name:'phone next'}]});
  await new SyncClient(async(_,body)=>{assert.equal(body.base_revision,3);return {revision:4};}).sync();
  assert.equal(syncEnvelope().revision,4);
});

test('读取恢复数据时本机新记录不能被覆盖或清空队列',async()=>{
  setup();saveState(state('before'));
  await assert.rejects(reconcile(async()=>{
    saveState(state('new edit while reading'));
    return {revision:2,next_cursor:2,has_more:false,items:[]};
  },true),/本机记录发生变化/);
  assert.equal(syncEnvelope().state.places[0].name,'new edit while reading');
  assert.equal(syncEnvelope().revision,0);
});

test('云端分页版本变化时恢复不落盘',async()=>{
  setup();const before=JSON.stringify(syncEnvelope());let calls=0;
  await assert.rejects(reconcile(async()=>++calls===1?
    {revision:2,next_cursor:0,after:1,has_more:true,items:[]}:
    {revision:3,next_cursor:3,has_more:false,items:[]},true),/分页版本不一致/);
  assert.equal(JSON.stringify(syncEnvelope()),before);
});

test('凭据空白被去除，401和409保留可诊断状态码',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async(url,options)=>{
      assert.equal(String(url),'https://example.invalid/v1/reports');
      assert.equal(options.headers.Authorization,'Bearer synthetic-token');
      return {ok:false,status:401,json:async()=>({detail:'未授权'})};
    };
    await assert.rejects(createApi(' https://example.invalid/ ',' synthetic-token ')('/v1/reports'),e=>e.status===401);
    globalThis.fetch=async()=>({ok:false,status:409,json:async()=>({detail:'云端版本已改变'})});
    await assert.rejects(createApi('https://example.invalid','synthetic')('/v1/sync/batches',{}),e=>e.status===409);
    assert.throws(()=>createApi('https://example.invalid',' '),e=>e.status===401);
  } finally {globalThis.fetch=original;}
});
