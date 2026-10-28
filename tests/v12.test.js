import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLocalDateTime as t, toLocalDateTime, segmentsOfRange, dateFromKey} from '../js/time.js';
import {emptyState,loadState,saveState,syncEnvelope,V2_KEY,STORAGE_KEY} from '../js/storage.js';
import {SyncClient, reconcile} from '../js/sync.js';
import {exportLog} from '../js/log-export.js';
let memory;
function setup() { memory=new Map(); globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}; }
const s=()=>({schemaVersion:1,places:[{id:'p',name:'图书馆'}],segments:[{id:'s',kind:'place',placeId:'p',placeName:'图书馆',start:t('2026-10-28T09:00'),end:t('2026-10-28T12:00')}]});
test('北京时间解析不受宿主时区影响，拒绝不存在日期',()=>{assert.equal(new Date(t('2026-10-28T08:00')).toISOString(),'2026-10-28T00:00:00.000Z');assert.equal(toLocalDateTime(t('2026-10-28T08:00')),'2026-10-28T08:00:00');assert.throws(()=>dateFromKey('2026-02-30'));});
test('区间裁剪不改原始记录，左闭右开',()=>{const original=s();const copy=JSON.stringify(original);const parts=segmentsOfRange(original.segments,t('2026-10-28T10:00'),t('2026-10-28T11:00'));assert.equal(parts[0].duration,3600000);assert.equal(JSON.stringify(original),copy);assert.equal(segmentsOfRange(original.segments,t('2026-10-28T12:00'),t('2026-10-28T13:00')).length,0);});
test('拒绝倒序和超过七天，进行中固定临时终点',()=>{assert.throws(()=>segmentsOfRange([],0,8*86400000));assert.throws(()=>segmentsOfRange([],2,1));assert.equal(segmentsOfRange([{id:'a',start:10,end:null}],1,100,20)[0].duration,10);});
test('复制保留跨日完整源ID与时间边界',()=>{const state=s();const log=exportLog(state,t('2026-10-28T10:00'),t('2026-10-28T11:00'),t('2026-10-28T13:00'));assert.match(log,/Asia\/Shanghai/);const json=JSON.parse(log.split('```json\n')[1].split('\n```')[0]);assert.equal(json.segments[0].start,state.segments[0].start);});
test('迁移保留V1，保存失败不改变已落盘数据',()=>{setup();localStorage.setItem(STORAGE_KEY,JSON.stringify(s()));const original=memory.get(STORAGE_KEY);loadState();assert.equal(memory.get(STORAGE_KEY),original);const before=memory.get(V2_KEY);localStorage.setItem=()=>{throw Error('quota');};assert.throws(()=>saveState(emptyState()),/quota/);assert.equal(memory.get(V2_KEY),before);});
test('请求成功但响应丢失后使用相同批次重试',async()=>{setup();loadState();saveState(s());const ids=[];let first=true;const c=new SyncClient(async(_,b)=>{ids.push(b.batch_id);if(first){first=false;throw Error('timeout');}return {revision:1};});await assert.rejects(c.sync());await c.sync();assert.equal(ids[0],ids[1]);assert.equal(syncEnvelope().queue.length,0);});
test('上传期间新修改保留并继续同步',async()=>{setup();loadState();saveState(s());const sent=[];const c=new SyncClient(async(_,b)=>{sent.push(structuredClone(b));if(sent.length===1){const edited=s();edited.segments[0].end=t('2026-10-28T11:00');saveState(edited);}return {revision:sent.length};});await c.sync();assert.equal(sent.length,2);assert.equal(sent[1].base_revision,1);assert.equal(sent[1].operations[0].value.end,t('2026-10-28T11:00'));assert.equal(syncEnvelope().state.segments[0].end,t('2026-10-28T11:00'));});
test('冲突不丢队列、不冒充成功',async()=>{setup();loadState();saveState(s());const c=new SyncClient(async()=>{throw Error('409');});await assert.rejects(c.sync());assert.equal(syncEnvelope().queue.length,1);assert.equal(syncEnvelope().revision,0);});
test('旧V1标签页修改后停止写入，保留两份数据',()=>{setup();loadState();localStorage.setItem(STORAGE_KEY,JSON.stringify(s()));assert.throws(()=>saveState(s()),/旧版页面/);});
test('其他标签页修改V2后拒绝陈旧写入',()=>{setup();loadState();const e=JSON.parse(memory.get(V2_KEY));e.state=s();memory.set(V2_KEY,JSON.stringify(e));assert.throws(()=>saveState(emptyState()),/另一个页面/);});

test('显式恢复先拉取云端分页再重建基线，不丢本地待恢复数据',async()=>{
 setup();loadState();saveState(s());
 const e=syncEnvelope();e.queue.push({batch_id:'conflict',base_revision:0,state:s()});memory.set(V2_KEY,JSON.stringify(e));
 let calls=0;
 await reconcile(async()=>{calls++;return calls===1?{items:[{revision:1,operations:[{table:'places',action:'upsert',id:'p',value:{id:'p',name:'图书馆'}}]}],next_cursor:1,revision:2,has_more:true}:{items:[{revision:2,operations:[]}],next_cursor:2,revision:2,has_more:false};});
 assert.equal(calls,2);assert.equal(syncEnvelope().revision,2);assert.equal(syncEnvelope().queue.length,0);assert.equal(syncEnvelope().state.segments.length,1);assert.equal(syncEnvelope().restoreDeleted,true);
});
test('大批次拆分暂存后一次提交，重试不拆断关联边界',async()=>{
 setup();loadState();const state=emptyState();state.segments=Array.from({length:1100},(_,i)=>({id:String(i),kind:'transit',start:i*2,end:i*2+1}));saveState(state);
 const calls=[];const c=new SyncClient(async(path,body)=>{calls.push({path,body});return {revision:1};});await c.sync();
 assert.equal(calls.filter(c=>c.path.includes('/stage/')).length,3);assert.equal(calls.at(-1).body.parts,3);assert.equal(syncEnvelope().revision,1);
});
test('分页恢复固定目标版本并携带操作游标',async()=>{
 setup();loadState();let count=0;const paths=[];
 await reconcile(async path=>{paths.push(path);return ++count===1?{items:[],revision:2,next_cursor:0,after:100,has_more:true}:{items:[],revision:2,next_cursor:2,after:101,has_more:false};});
 assert.match(paths[1],/target=2&after=100/);assert.equal(syncEnvelope().revision,2);
});
