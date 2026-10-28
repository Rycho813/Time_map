import { dateFromKey, localDateKey, moveDay, parseLocalDateTime, toLocalDateTime, segmentsOfRange, dayTotals, formatDuration } from './time.js';
import { exportLog } from './log-export.js';
import { SyncClient, createApi, reconcile } from './sync.js';
import { syncEnvelope, newId } from './storage.js';
export function wireRange(getState) {
  const $ = id => document.getElementById(id);
  let client, api, identity, retryTimer, delay = 1000;
  function selectDay(offset) {
    const day = moveDay(localDateKey(new Date()), offset);
    const start = dateFromKey(day).getTime();
    $('range-start').value = toLocalDateTime(start); $('range-end').value = toLocalDateTime(start + 86400000);
  }
  selectDay(-1);
  function bounds() { return [parseLocalDateTime($('range-start').value), parseLocalDateTime($('range-end').value)]; }
  function connected() {
    const next = `${$('api-base').value}\n${$('api-token').value}`;
    if (!client || next !== identity) {
      api = createApi($('api-base').value, $('api-token').value);
      client = new SyncClient(api); identity = next;
    }
    return client;
  }
  async function sync() {
    $('sync-status').textContent = '同步中…';
    try {
      const e = await connected().sync(); delay = 1000; clearTimeout(retryTimer);
      $('sync-status').textContent = `已同步，版本${e.revision}，${e.lastSync || '暂无变更'}`;
      return e;
    } catch (error) { $('sync-status').textContent = `同步失败：${error.message}；本地记录已保留。`; throw error; }
  }
  function changed() {
    if (!$('api-base').value || !$('api-token').value) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => sync().catch(() => { delay = Math.min(delay * 2, 60000); changed(); }), delay);
  }
  function show() {
    const [start,end] = bounds(); const state = getState();
    if ($('range-mode').value === 'efficiency') {
      $('range-output').textContent = '活动效率需点击“生成新报告”，读取分析服务；本地地点记录不会被自动当作有效活动。'; return;
    }
    const parts = segmentsOfRange(state.segments,start,end);const totals = dayTotals(parts,state.places);
    $('range-output').textContent = exportLog(state,start,end).split('请完整保留以下识别信息：')[0] + '\n' + totals.locations.map(p => `${p.name}累计：${formatDuration(p.duration)}`).join('\n') + `\n路程总计：${formatDuration(totals.transitMs)}`;
  }
  function run(action) { return async () => { try { await action(); } catch(e) { $('range-status').textContent = e.message; } }; }
  $('range-show').addEventListener('click',run(show));
  $('range-copy').addEventListener('click',run(async () => {
    const text = exportLog(getState(),...bounds());
    $('range-output').textContent = text;
    if (navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(text); $('range-status').textContent = '已复制，请完整粘贴到Notion备用页面。'; return; } catch {} }
    $('range-status').textContent = '自动复制不可用，请长按下方文本选择并复制。';
  }));
  $('sync-now').addEventListener('click',run(sync));
  for (const [id,offset] of [['range-yesterday',-1],['range-before',-2],['range-three',-3]]) $(id).addEventListener('click',() => {selectDay(offset);});
  $('range-report').addEventListener('click',run(async () => {
    const [start,end] = bounds(); segmentsOfRange(getState().segments,start,end);
    let e, stale = false;
    try { e = await sync(); }
    catch (error) {
      if (!api || !confirm('同步失败，默认暂停。是否明确使用云端已有数据继续？报告将标记数据可能不是最新。')) return;
      e = {revision: syncEnvelope().revision}; stale = true;
    }
    $('range-status').textContent = '正在生成独立报告…';
    let report = await api('/v1/analysis-jobs',{ request_id:newId(), mode:$('range-mode').value, start,end, expected_revision:e.revision, allow_stale:stale });
    while (['queued','running'].includes(report.status)) {
      $('range-status').textContent = report.status === 'queued' ? '任务排队中…' : '正在分析…';
      await new Promise(resolve => setTimeout(resolve,500));
      report = await api(`/v1/analysis-jobs/${encodeURIComponent(report.id)}`);
    }
    if (report.status !== 'succeeded') throw new Error(report.error || '分析失败');
    $('range-status').textContent = `${report.mock ? '模拟数据报告（未调用Notion/AI/飞书）' : '报告'}，云端版本${report.data_revision}${stale ? '；使用已有云端数据，可能不完整' : ''}`;
    renderReport(report);
  }));
  function renderReport(report) {
    const lines = [`报告区间：${toLocalDateTime(report.start)} — ${toLocalDateTime(report.end)}`, '时区：Asia/Shanghai'];
    for (const day of report.days) {
      lines.push('', day.date);
      for (const p of day.locations) {
        lines.push(`${p.name}：停留${formatDuration(p.stay_ms)}${report.mode === 'efficiency' ? `，已确认有效${formatDuration(p.effective_ms)}，利用率${p.utilization === null ? '无法准确确定' : (p.utilization * 100).toFixed(1) + '%'}` : ''}`);
        for (const a of p.activities || []) lines.push(`  ${a.event_name}：${a.time_type === 'effective' ? '有效' : a.time_type === 'buffer' ? '缓冲' : '未计入'}${a.matched_start !== undefined ? '，匹配' + formatDuration(a.matched_end-a.matched_start) : '，' + a.duration_min + '分钟'}`);
      }
      lines.push(`路程：${formatDuration(day.transit_ms)}`);
      for (const a of day.unknown) lines.push(`待确认：${a.event_name}，${a.reason}`);
      lines.push(...day.warnings);
    }
    lines.push('', '区间汇总');
    for (const p of report.locations) lines.push(`${p.name}：停留${formatDuration(p.stay_ms)}${report.mode === 'efficiency' ? `，有效${formatDuration(p.effective_ms)}，利用率${p.utilization === null ? '无法准确确定' : (p.utilization*100).toFixed(1)+'%'}` : ''}`);
    lines.push(`全部路程：${formatDuration(report.transit_ms)}`, ...report.warnings);
    $('range-output').textContent = lines.join('\n');
  }
  $('report-history').addEventListener('click',run(async () => {
    connected();
    const history = await api('/v1/reports');
    const list = $('history-list'); list.replaceChildren();
    for (const item of history.items) {
      const button = document.createElement('button'); button.className = 'button secondary';
      button.textContent = `${toLocalDateTime(item.start)} — ${toLocalDateTime(item.end)} · ${item.mode === 'location' ? '地点时间流' : '活动效率'}`;
      button.addEventListener('click',() => { renderReport(item); $('range-status').textContent = '已有报告原样展示，未读取Notion或重新分析。'; });
      list.append(button);
    }
    if (!history.items.length) list.textContent = '暂无已生成报告。';
  }));
  $('restore-deleted').addEventListener('click',run(async () => {
    if (!confirm('只在你确认要恢复备份中已删除的记录时使用。建议先导出当前备份。是否授权下一批恢复？')) return;
    connected(); backupLocal(); await reconcile(api); await sync();
  }));
  function backupLocal() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({format:'time-map-backup-v2',state:getState()})],{type:'application/json'}));
    const a = document.createElement('a');a.href=url;a.download='恢复前本地备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('use-cloud').addEventListener('click',run(async () => {
    if (!confirm('将先导出本地备份，再用云端副本替换本机记录并清除待上传项。确认采用云端？')) return;
    connected();backupLocal();await reconcile(api,true);location.reload();
  }));
  $('rotate-token').addEventListener('click',run(async () => {
    connected(); const result = await api('/v1/device/rotate',{});
    $('api-token').value = result.token; client = null;
    $('sync-status').textContent = '旧凭据已撤销，新凭据已填入本次页面，请安全保存。';
  }));
  window.addEventListener('online',changed);
  document.addEventListener('visibilitychange',() => { if (!document.hidden) changed(); });
  return { changed };
}
