import { syncEnvelope, persistEnvelope, newId } from './storage.js';
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
      e.queue.push({ batch_id: newId(), base_revision: e.revision, state: e.state });
      persistEnvelope(e);
    }
    if (!e.queue.length) return e;
    const batch = e.queue[0];
    const result = await this.api('/v1/sync/batches', batch);
    // 在请求期间用户可能继续修改；只确认已发送快照，绝不覆盖新本地数据。
    e = syncEnvelope();
    if (e.queue[0]?.batch_id !== batch.batch_id) throw new Error('同步队列发生冲突，请刷新后重试。');
    e.queue.shift(); e.revision = result.revision; e.acknowledged = batch.state; e.lastSync = new Date().toISOString();
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
