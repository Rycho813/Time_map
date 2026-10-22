/**
 * 文件作用：处理全部日期与时长计算；不操作页面、不读写数据。
 * 尤其负责：把跨过午夜的记录切成当天那一段，以及生成每天的地点/路程汇总。
 */

const pad2 = (number) => String(number).padStart(2, '0');

export function localDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function dateFromKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('日期格式不正确。');
  const [year, month, day] = key.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  if (localDateKey(d) !== key) throw new Error('日期不存在。');
  return d;
}

export function moveDay(key, step) {
  const d = dateFromKey(key);
  d.setDate(d.getDate() + step);
  return localDateKey(d);
}

export function toLocalDateTime(timestamp) {
  const d = new Date(timestamp);
  return `${localDateKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function parseLocalDateTime(text) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) throw new Error('请填写完整的日期时间。');
  const d = new Date(text);
  if (!Number.isFinite(d.getTime()) || toLocalDateTime(d.getTime()).slice(0, 16) !== text.slice(0, 16)) {
    throw new Error('日期或时间无效。');
  }
  return d.getTime();
}

export function formatClock(timestamp) {
  const d = new Date(timestamp);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export function readableDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分`;
  return `${seconds}秒`;
}

// 返回这一天所有的片段，注意 start/end 已被裁剪到“当天”的范围。
// 例如 23:00 到次日 01:00，在前一天显示 1 小时，后一天也显示 1 小时。
export function segmentsOfDay(segments, dayKey, now = Date.now()) {
  const startOfDay = dateFromKey(dayKey).getTime();
  const endOfDay = new Date(dateFromKey(dayKey).getFullYear(),
    dateFromKey(dayKey).getMonth(), dateFromKey(dayKey).getDate() + 1).getTime();
  const results = [];
  for (const s of segments) {
    const realEnd = s.end === null ? Math.max(now, s.start) : s.end;
    const start = Math.max(s.start, startOfDay);
    const end = Math.min(realEnd, endOfDay);
    if (end > start || (s.end === null && start === end && start >= startOfDay && start < endOfDay)) {
      results.push({ ...s, displayStart: start, displayEnd: end, duration: Math.max(0, end - start) });
    }
  }
  return results;
}

export function dayTotals(parts, places) {
  const placeNames = new Map(places.map(p => [p.id, p.name]));
  const byPlace = new Map();
  let transitMs = 0;
  for (const p of parts) {
    if (p.kind === 'transit') { transitMs += p.duration; continue; }
    const prev = byPlace.get(p.placeId) || { id: p.placeId, name: '', duration: 0 };
    prev.name = placeNames.get(p.placeId) || p.placeName;
    prev.duration += p.duration;
    byPlace.set(p.placeId, prev);
  }
  const locations = [...byPlace.values()].sort((a, b) => b.duration - a.duration);
  const placeMs = locations.reduce((sum, p) => sum + p.duration, 0);
  return { locations, placeMs, transitMs, totalMs: placeMs + transitMs };
}

export function displayDayClock(timestamp, dayKey, isEnd = false) {
  const d = dateFromKey(dayKey);
  const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  if (isEnd && timestamp === nextMidnight) return '24:00';
  return formatClock(timestamp).slice(0, 5);
}
