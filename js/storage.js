/**
 * 文件作用：管理本地数据，读取/保存 localStorage，并检查记录是否有效。
 * 只有这里能直接读写 localStorage；app.js 只需要调用公开函数。
 * 每次操作会先检查完整数据，再一次性保存，避免写入一半造成损坏。
 */

export const STORAGE_KEY = 'time-map-v1-data';
export const SCHEMA_VERSION = 1;

export function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, places: [], segments: [] };
}

export function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 统一的合法性检查：也用于检查别人给的备份文件。
export function validateState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('数据版本不兼容。此程序只接受 V1 的 JSON 备份。');
  }
  if (!Array.isArray(data.places) || !Array.isArray(data.segments)) {
    throw new Error('备份中缺少 places 或 segments 数组。');
  }
  if (data.places.length > 10000 || data.segments.length > 200000) {
    throw new Error('备份记录数量超过安全上限。');
  }

  const placeIds = new Set();
  for (const p of data.places) {
    if (!p || typeof p.id !== 'string' || !p.id ||
        typeof p.name !== 'string' || !p.name.trim() || p.name.length > 36 || placeIds.has(p.id)) {
      throw new Error('地点数据无效或出现重复的地点 ID。');
    }
    placeIds.add(p.id);
  }

  const segmentIds = new Set();
  let activeCount = 0;
  for (let i = 0; i < data.segments.length; i++) {
    const s = data.segments[i];
    if (!s || typeof s.id !== 'string' || !s.id || segmentIds.has(s.id) ||
        !['place', 'transit'].includes(s.kind) || !Number.isSafeInteger(s.start) || s.start < 0 ||
        (s.end !== null && (!Number.isSafeInteger(s.end) || s.end < s.start))) {
      throw new Error(`第 ${i + 1} 段记录的 ID、类型或时间无效。`);
    }
    if (s.kind === 'place' &&
       (typeof s.placeId !== 'string' || !s.placeId ||
        typeof s.placeName !== 'string' || !s.placeName.trim() || s.placeName.length > 36)) {
      throw new Error(`第 ${i + 1} 段记录缺少地点信息。`);
    }
    segmentIds.add(s.id);
    if (s.end === null) {
      activeCount++;
      if (i !== data.segments.length - 1) throw new Error('进行中的记录只能放在最后一段。');
    }
    if (i > 0) {
      const previous = data.segments[i - 1];
      if (previous.end === null || previous.end > s.start) {
        throw new Error(`第 ${i} 段和第 ${i + 1} 段时间重叠或顺序颠倒。请修正后重试。`);
      }
    }
  }
  if (activeCount > 1) throw new Error('不能同时进行两段计时。');
  return true;
}

export const V2_KEY = 'time-map-v2-data';
function readEnvelope() {
  const text = localStorage.getItem(V2_KEY);
  if (text === null) return null;
  const envelope = JSON.parse(text);
  if (envelope.version !== 2 || !envelope.state || !Number.isInteger(envelope.revision) || !Array.isArray(envelope.queue)) throw new Error('V2数据损坏，已停止写入。');
  validateState(envelope.state);
  return envelope;
}
export function loadState() {
  const envelope = readEnvelope();
  if (envelope) return envelope.state;
  const text = localStorage.getItem(STORAGE_KEY);
  const state = text === null ? emptyState() : JSON.parse(text);
  validateState(state);
  // 原V1键保持不变；首次同步以完整、显式快照导入空云端。
  localStorage.setItem(V2_KEY, JSON.stringify({ version: 2, state, revision: 0, acknowledged: emptyState(), queue: [], lastSync: null }));
  return state;
}
export function saveState(state) {
  validateState(state);
  const envelope = readEnvelope() || { version: 2, revision: 0, acknowledged: emptyState(), queue: [], lastSync: null };
  envelope.state = state;
  localStorage.setItem(V2_KEY, JSON.stringify(envelope));
}
export function syncEnvelope() { return readEnvelope(); }
export function persistEnvelope(envelope) {
  validateState(envelope.state);
  localStorage.setItem(V2_KEY, JSON.stringify(envelope));
}
export function backupState() { return { format: 'time-map-backup-v2', state: loadState() }; }

export function copyState(state) {
  return JSON.parse(JSON.stringify(state));
}
