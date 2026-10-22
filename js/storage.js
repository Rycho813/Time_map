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

export function loadState() {
  const text = localStorage.getItem(STORAGE_KEY);
  if (text === null) return emptyState();
  let state;
  try { state = JSON.parse(text); }
  catch { throw new Error('本机 JSON 数据已经损坏，无法解析。'); }
  validateState(state);
  return state;
}

export function saveState(state) {
  validateState(state);
  // 如果浏览器空间不足或禁用了本地存储，会抛错；调用方会告知用户，没有假装保存成功。
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function copyState(state) {
  return JSON.parse(JSON.stringify(state));
}
