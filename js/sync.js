import { syncEnvelope, persistEnvelope, newId } from './storage.js';
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
    if (!e.queue.length) return e;
    const batch = e.queue[0];
    const result = await this.api('/v1/sync/batches', {batch_id:batch.batch_id,base_revision:batch.base_revision,operations:operationsBetween(e.acknowledged,batch.state),restore_deleted:batch.restore_deleted || false});
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
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('API必须使用HTTPS。');
  return async (path, body) => {
    const response = await fetch(new URL(path, url), { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? {'Content-Type': 'application/json'} : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000), cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 409 ? '云端版本冲突，未覆盖任何记录。' : JSON.stringify(data.detail || data));
    return data;
  };
}
// Explicit recovery only: caller must confirm and back up local state before invoking.
export async function reconcile(api, useCloud = false) {
  let cursor = 0;
  const maps = {places:new Map(),segments:new Map()};
  let page;
  do {
    page = await api(`/v1/sync/changes?cursor=${cursor}&limit=50`);
    for (const batch of page.items) for (const op of batch.operations) {
      if (op.action === 'delete') maps[op.table].delete(op.id);
      else maps[op.table].set(op.id,op.value);
    }
    cursor = page.next_cursor;
  } while (page.has_more);
  const cloud = {schemaVersion:1,places:[...maps.places.values()],segments:[...maps.segments.values()].sort((a,b)=>a.start-b.start)};
  const e = syncEnvelope();
  e.acknowledged = cloud; e.revision = page.revision; e.queue = [];
  if (useCloud) e.state = cloud;
  e.restoreDeleted = !useCloud;
  persistEnvelope(e);
  return e;
}
