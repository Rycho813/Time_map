import { segmentsOfRange, toLocalDateTime, formatDuration } from './time.js';
export function exportLog(state, start, end, now = Date.now()) {
  const parts = segmentsOfRange(state.segments, start, end, now);
  const names = new Map(state.places.map(p => [p.id, p.name]));
  const lines = ['Time_map 地点日志 V1.2', '时区：Asia/Shanghai',
    `范围：${toLocalDateTime(start)} — ${toLocalDateTime(end)}`, `导出：${toLocalDateTime(now)}`];
  for (const s of parts) lines.push(`${toLocalDateTime(s.displayStart)} — ${toLocalDateTime(s.displayEnd)}｜${s.kind === 'transit' ? '路程' : names.get(s.placeId) || s.placeName}｜${formatDuration(s.duration)}${s.end === null ? '（进行中，临时终点）' : ''}`);
  // 原始记录用于去重，显示片段用于人读；保留完整边界，不把裁剪结果写回原记录。
  lines.push('', '请完整保留以下识别信息：', '```json', JSON.stringify({ format: 'time-map-log-v1.2', start, end, as_of: now, segments: parts.map(({displayStart, displayEnd, duration, ...s}) => s) }), '```');
  return lines.join('\n');
}
