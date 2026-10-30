/**
 * 文件作用：处理全部日期与时长计算；不操作页面、不读写数据。
 * 尤其负责：把跨过午夜的记录切成当天那一段，以及生成每天的地点/路程汇总。
 */

const pad2 = (number) => String(number).padStart(2, '0');

// Only presentation changes: persisted sync instants remain ISO UTC.
export function formatSyncTime(iso) {
  if (!iso) return '已核对云端，无待上传变更';
  // Do not interpret a timezone-less string in the device's local timezone.
  if (typeof iso !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(iso)) return '同步时间不可用';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '同步时间不可用';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}（北京时间 Asia/Shanghai）`;
}

export function localDateKey(date) {
  const d = new Date(date.getTime() + 8 * 3600000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function dateFromKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('日期格式不正确。');
  const [year, month, day] = key.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day) - 8 * 3600000);
  if (localDateKey(d) !== key) throw new Error('日期不存在。');
  return d;
}

export function moveDay(key, step) {
  return localDateKey(new Date(dateFromKey(key).getTime() + step * 86400000));
}

export function toLocalDateTime(timestamp) {
  const d = new Date(timestamp + 8 * 3600000);
  return `${localDateKey(new Date(timestamp))}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

export function parseLocalDateTime(text) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) throw new Error('请填写完整的日期时间。');
  const d = new Date(`${text}+08:00`);
  if (!Number.isFinite(d.getTime()) || toLocalDateTime(d.getTime()).slice(0, 16) !== text.slice(0, 16)) {
    throw new Error('日期或时间无效。');
  }
  return d.getTime();
}

export function formatClock(timestamp) {
  const d = new Date(timestamp + 8 * 3600000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
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
  const endOfDay = startOfDay + 86400000;
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
  const nextMidnight = d.getTime() + 86400000;
  if (isEnd && timestamp === nextMidnight) return '24:00';
  return formatClock(timestamp).slice(0, 5);
}

// 所有区间使用北京时间、左闭右开；不修改原记录。
export function validateRange(start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end - start > 7 * 86400000)
    throw new Error('请选择有效起止时间，最多连续7天。');
}
export function segmentsOfRange(segments, start, end, now = Date.now()) {
  validateRange(start, end);
  return segments.flatMap(s => {
    const left = Math.max(start, s.start);
    const right = Math.min(end, s.end === null ? Math.max(now, s.start) : s.end);
    return right > left ? [{ ...s, displayStart: left, displayEnd: right, duration: right - left }] : [];
  });
}
