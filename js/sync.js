import { syncEnvelope, persistEnvelope, newId } from './storage.js';
export class ApiError extends Error {
  constructor(status, detail = '') {
    const message = status === 401 ? '401：设备凭据无效或已撤销，请重新填写有效凭据。'
      : status === 409 ? `409：云端版本冲突，未覆盖记录。${detail ? ' ' + detail : ''}`
      : `HTTP ${status}：${detail || '请求失败'}`;
    super(message); this.name = 'ApiError'; this.status = status;
  }
}
export function operationsBetween(oldState, state) {
  return ['places','segments'].flatMap(table => {
    const old = new Map(oldState[table].map(v => [v.id,v]));
    const current = new Map(state[table].map(v => [v.id,v]));
    return [...[...old.keys()].filter(id => !current.has(id)).map(id => ({table,action:'delete',id})),
      ...[...current].filter(([id,v]) => JSON.stringify(old.get(id)) !== JSON.stringify(v)).map(([id,value]) => ({table,action:'upsert',id,value}))];
  });
}
export class SyncClient {
  constructor(api) { this.api = api; this.running = null; }
  async sync() {
    if (this.running) return this.running;
    this.running = this.perform().finally(() => { this.running = null; });
    return this.running;
  }
  async perform() {
    let e = syncEnvelope();
    if (!e.queue.length && JSON.stringify(e.state) !== JSON.stringify(e.acknowledged)) {
      e.queue.push({ batch_id: newId(), base_revision: e.revision, state: e.state, restore_deleted:e.restoreDeleted || false });
      persistEnvelope(e);
    }
    if (!e.queue.length) {
      const before = JSON.stringify(e);
      const page = await this.api(`/v1/sync/changes?cursor=${e.revision}&limit=1`);
      if (JSON.stringify(syncEnvelope()) !== before) return this.perform();
      if (page.revision !== e.revision) throw new ApiError(409, `本机版本${e.revision}，云端版本${page.revision}；请先备份并采用云端副本。`);
      return e;
    }
    const batch = e.queue[0];
    const operations = operationsBetween(e.acknowledged,batch.state);
    let result;
    if (operations.length <= 500 && new TextEncoder().encode(JSON.stringify(operations)).length < 200000) {
      result = await this.api('/v1/sync/batches',{batch_id:batch.batch_id,base_revision:batch.base_revision,operations,restore_deleted:batch.restore_deleted || false});
    } else {
      const chunks=[];let chunk=[];let bytes=2;
      for (const op of operations) {
        const size=new TextEncoder().encode(JSON.stringify(op)).length+1;
        if (chunk.length && (chunk.length>=500 || bytes+size>200000)) { chunks.push(chunk);chunk=[];bytes=2; }
        chunk.push(op);bytes+=size;
      }
      if (chunk.length) chunks.push(chunk);
      for (let part=0;part<chunks.length;part++) await this.api(`/v1/sync/stage/${encodeURIComponent(batch.batch_id)}/${part}`,chunks[part]);
      result = await this.api(`/v1/sync/commit/${encodeURIComponent(batch.batch_id)}`,{parts:chunks.length,base_revision:batch.base_revision,restore_deleted:batch.restore_deleted || false});
    }
    // 在请求期间用户可能继续修改；只确认已发送快照，绝不覆盖新本地数据。
    e = syncEnvelope();
    if (e.queue[0]?.batch_id !== batch.batch_id) throw new Error('同步队列发生冲突，请刷新后重试。');
    e.queue.shift(); e.restoreDeleted = false; e.revision = result.revision; e.acknowledged = batch.state; e.lastSync = new Date().toISOString();
    persistEnvelope(e);
    if (JSON.stringify(e.state) !== JSON.stringify(e.acknowledged)) return this.perform();
    return e;
  }
}
export function createApi(base, token) {
  const url = new URL(base.trim());
  token = token.trim();
  if (!token) throw new ApiError(401);
  if (url.username || url.password) throw new Error('API地址不能包含用户名或密码。');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('API必须使用HTTPS。');
  return async (path, body) => {
    let response = await fetch(new URL(path, url), { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? {'Content-Type': 'application/json'} : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000), cache: 'no-store' });
    for (let retry=0;response.status===429 && retry<5;retry++) {
      await new Promise(resolve=>setTimeout(resolve,Math.min(60,Math.max(1,Number(response.headers.get('Retry-After'))||60))*1000));
      response = await fetch(new URL(path,url),{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),cache:'no-store'});
    }
    let data;
    try { data = await response.json(); }
    catch { if (!response.ok) throw new ApiError(response.status); throw new Error('服务返回了无法识别的数据。'); }
    if (!response.ok) throw new ApiError(response.status, typeof data.detail === 'string' ? data.detail : '');
    return data;
  };
}
// Explicit recovery only: caller must confirm and back up local state before invoking.
export async function reconcile(api, useCloud = false) {
  const original = JSON.stringify(syncEnvelope());
  let cursor = 0;
  const maps = {places:new Map(),segments:new Map()};
  let page;let target;let after=0;
  do {
    page = await api(`/v1/sync/changes?cursor=${cursor}&limit=500${target === undefined ? '' : `&target=${target}&after=${after}`}`);
    if (target !== undefined && page.revision !== target) throw new Error('云端分页版本不一致，恢复已暂停。');
    for (const batch of page.items) for (const op of batch.operations) {
      if (op.action === 'delete') maps[op.table].delete(op.id);
      else maps[op.table].set(op.id,op.value);
    }
    cursor = page.next_cursor;target ??= page.revision;after=page.after || 0;
  } while (page.has_more);
  const cloud = {schemaVersion:1,places:[...maps.places.values()],segments:[...maps.segments.values()].sort((a,b)=>a.start-b.start)};
  const e = syncEnvelope();
  if (JSON.stringify(e) !== original) throw new Error('读取云端期间本机记录发生变化；请重新保存备份后恢复。');
  e.acknowledged = cloud; e.revision = page.revision; e.queue = [];
  if (useCloud) e.state = cloud;
  e.restoreDeleted = !useCloud;
  e.lastSync = new Date().toISOString();
  persistEnvelope(e);
  return e;
}
