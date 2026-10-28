/**
 * 文件作用：自动检查日期、跨天、总时长及错误记录拦截；供开发者在电脑执行 npm test。
 * 不参与实际网页运行，也不需要上传给 GitHub Pages（上传也不会影响页面）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { dateFromKey, segmentsOfDay, dayTotals, moveDay, localDateKey } from '../js/time.js';
import { emptyState, validateState } from '../js/storage.js';

function t(time) { return new Date(`${time}+08:00`).getTime(); }

test('初始数据有效', () => { assert.equal(validateState(emptyState()), true); });
test('跨天停留应分别计入前一天和后一天', () => {
  const segments = [{id:'1',kind:'place',placeId:'home',placeName:'家',start:t('2026-10-21T23:00:00'),end:t('2026-10-22T01:00:00')}];
  const a = segmentsOfDay(segments,'2026-10-21');
  const b = segmentsOfDay(segments,'2026-10-22');
  assert.equal(a[0].duration, 3600000);
  assert.equal(b[0].duration, 3600000);
  assert.equal(dayTotals([...a,...b],[{id:'home',name:'家'}]).placeMs,7200000);
});
test('跨天的未结束路程能持续累计', () => {
  const segments = [{id:'1',kind:'transit',start:t('2026-10-21T23:50:00'),end:null}];
  const parts = segmentsOfDay(segments,'2026-10-22',t('2026-10-22T00:20:00'));
  assert.equal(parts.length,1);
  assert.equal(dayTotals(parts,[]).transitMs, 20*60000);
});
test('同一地点多次到访会合并，路程也全部合并', () => {
  const parts = [
    {kind:'place',placeId:'a',placeName:'家',duration:30*60000},
    {kind:'transit',duration:10*60000},
    {kind:'place',placeId:'b',placeName:'学校',duration:60*60000},
    {kind:'transit',duration:20*60000},
    {kind:'place',placeId:'a',placeName:'家',duration:45*60000}
  ];
  const totals=dayTotals(parts,[{id:'a',name:'家'},{id:'b',name:'学校'}]);
  assert.equal(totals.transitMs,30*60000);
  assert.equal(totals.placeMs,135*60000);
  assert.equal(totals.locations.find(p=>p.id==='a').duration,75*60000);
});
test('相邻记录可以首尾相接，但不能时间重叠', () => {
  const s=emptyState();
  s.places.push({id:'a',name:'家'});
  s.segments.push(
    {id:'p',kind:'place',placeId:'a',placeName:'家',start:1000,end:2000},
    {id:'r',kind:'transit',start:2000,end:null}
  );
  assert.equal(validateState(s),true);
  s.segments[1].start=1999;
  assert.throws(()=>validateState(s),/重叠/);
});
test('拒绝存在两个活跃记录的备份', () => {
  const s=emptyState();
  s.segments=[{id:'r',kind:'transit',start:1000,end:null},
    {id:'r2',kind:'transit',start:2000,end:null}];
  assert.throws(()=>validateState(s));
});
test('日期加减可跨月份，不使用 UTC 日期造成偏移', () => {
  assert.equal(moveDay('2026-10-31',1),'2026-11-01');
  assert.equal(localDateKey(dateFromKey('2026-10-22')),'2026-10-22');
});
