import { hasConnection, rememberConnection, unlockConnection, forgetConnection } from './connection-vault.js';
import { dateFromKey, localDateKey, moveDay, parseLocalDateTime, toLocalDateTime, segmentsOfRange, dayTotals, formatDuration, formatSyncTime } from './time.js';
import { exportLog } from './log-export.js';
import { SyncClient, createApi, reconcile } from './sync.js';
import { syncEnvelope, newId } from './storage.js';
export function wireRange(getState, onRestored = () => {}) {
  const $ = id => document.getElementById(id);
  let client, api, identity, retryTimer, delay = 1000;
  let paused = false, recovering = false, backupSignature = null;
  function selectDay(offset) {
    const day = moveDay(localDateKey(new Date()), offset);
    const start = dateFromKey(day).getTime();
    $('range-start').value = toLocalDateTime(start); $('range-end').value = toLocalDateTime(start + 86400000);
  }
  selectDay(-1);
  function bounds() { return [parseLocalDateTime($('range-start').value), parseLocalDateTime($('range-end').value)]; }
  let unlocked = !hasConnection();
  let saved;
  try { saved=JSON.parse(sessionStorage.getItem('time-map-connection') || 'null'); } catch { sessionStorage.removeItem('time-map-connection'); }
  if (!unlocked) { saved = null; sessionStorage.removeItem('time-map-connection'); }
  if (saved) { $('api-base').value=saved.base; $('api-token').value=saved.token; }
  function connected() {
    if (!unlocked) throw new Error('请先用本机PIN解锁连接。');
    const base = $('api-base').value.trim(), token = $('api-token').value.trim();
    const next = `${base}\n${token}`;
    if (!client || next !== identity) {
      api = createApi(base, token);
      client = new SyncClient(api); identity = next;
      if (!hasConnection()) sessionStorage.setItem('time-map-connection',JSON.stringify({base,token}));
    }
    return client;
  }
  async function sync() {
    if (recovering) throw new Error('正在恢复，请等待完成后再同步。');
    $('sync-status').textContent = '同步中…';
    try {
      const e = await connected().sync(); delay = 1000; clearTimeout(retryTimer);
      paused = false;
      $('sync-status').textContent = `已同步，版本${e.revision}，${formatSyncTime(e.lastSync)}`;
      return e;
    } catch (error) { showSyncError(error); throw error; }
  }
  function showSyncError(error) {
    if ([401,409].includes(error.status)) { paused = true; clearTimeout(retryTimer); }
    $('sync-status').textContent = `${paused ? '自动同步已暂停' : '同步失败'}：${error.message}；本地记录已保留。`;
  }
  function backupMatches() {
    if (!backupSignature) return false;
    try { return backupSignature === JSON.stringify(getState()) && backupSignature === JSON.stringify(syncEnvelope().state); }
    catch { return false; }
  }
  function changed() {
    if (backupSignature && !backupMatches()) {
      backupSignature = null; $('recovery-saved').checked = false;
      $('recovery-status').textContent = '本机记录已改变，请重新导出当前备份。';
    }
    if (paused || recovering) return;
    if (!$('api-base').value || !$('api-token').value) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => sync().catch(() => { if (!paused) { delay = Math.min(delay * 2, 60000); changed(); } }), delay);
  }
  function show() {
    const [start,end] = bounds(); const state = getState();
    if ($('range-mode').value === 'efficiency') {
      $('range-output').textContent = '活动效率需点击“生成新报告”，读取分析服务；本地地点记录不会被自动当作有效活动。'; return;
    }
    const parts = segmentsOfRange(state.segments,start,end);const totals = dayTotals(parts,state.places);
    $('range-output').textContent = exportLog(state,start,end).split('请完整保留以下识别信息：')[0] + '\n' + totals.locations.map(p => `${p.name}累计：${formatDuration(p.duration)}`).join('\n') + `\n路程总计：${formatDuration(totals.transitMs)}`;
  }
  function run(action) { return async () => { try { await action(); } catch(e) {
    $('range-status').textContent = e.message;
    if ([401,409].includes(e.status)) showSyncError(e);
  } }; }
  $('range-show').addEventListener('click',run(show));
  $('range-copy').addEventListener('click',run(async () => {
    const text = exportLog(getState(),...bounds());
    $('range-output').textContent = text;
    if (navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(text); $('range-status').textContent = '已复制，请完整粘贴到Notion备用页面。'; return; } catch {} }
    $('range-status').textContent = '自动复制不可用，请长按下方文本选择并复制。';
  }));
  $('pin-save').addEventListener('click',run(async () => {
    if (!unlocked) throw new Error('请先解锁已有连接。');
    connected();
    await rememberConnection($('connection-pin').value, {base:$('api-base').value.trim(), token:$('api-token').value.trim()});
    sessionStorage.removeItem('time-map-connection'); $('connection-pin').value = '';
    $('connection-status').textContent = '已加密保存本机连接；以后进入页面用PIN解锁。不影响计时数据。';
  }));
  $('pin-unlock').addEventListener('click',run(async () => {
    const saved = await unlockConnection($('connection-pin').value);
    $('api-base').value = saved.base; $('api-token').value = saved.token;
    $('connection-pin').value = ''; unlocked = true; client = null; $('range-status').textContent = '';
    $('connection-status').textContent = '连接已解锁；可正常同步。';
    changed();
  }));
  $('pin-lock').addEventListener('click',run(() => {
    if (!hasConnection()) throw new Error('请先设置本机PIN保存连接。');
    clearTimeout(retryTimer); unlocked = false; client = null; api = null; identity = null;
    $('api-token').value = ''; $('api-base').value = ''; $('connection-pin').value = '';
    sessionStorage.removeItem('time-map-connection');
    $('connection-status').textContent = '连接已锁定；已发出的请求可能仍会完成，本机计时继续。';
  }));
  $('pin-forget').addEventListener('click',run(() => {
    if (!confirm('仅忘记本机保存的连接，之后需重新填写长令牌。计时记录保留。确认？')) return;
    forgetConnection(); unlocked = true; clearTimeout(retryTimer); client = null; api = null;
    $('api-token').value = ''; $('api-base').value = ''; $('connection-pin').value = '';
    sessionStorage.removeItem('time-map-connection');
    $('connection-status').textContent = '已忘记本机连接；计时记录未改变。';
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
        lines.push(`${p.name}：停留${formatDuration(p.stay_ms)}${report.mode === 'efficiency' ? `，已归属有效${formatDuration(p.effective_ms)}，利用率${p.utilization === null ? '无法准确确定' : (p.utilization * 100).toFixed(1) + '%'}` : ''}`);
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
  async function loadHistory(offset=0) {
    connected();
    const history = await api(`/v1/reports?offset=${offset}&limit=20`);
    const list = $('history-list'); if (!offset) list.replaceChildren();
    for (const item of history.items) {
      const button = document.createElement('button'); button.className = 'button secondary';
      button.textContent = `${toLocalDateTime(item.start)} — ${toLocalDateTime(item.end)} · ${item.mode === 'location' ? '地点时间流' : '活动效率'}`;
      button.addEventListener('click',() => { renderReport(item); $('range-status').textContent = '已有报告原样展示，未读取Notion或重新分析。'; });
      list.append(button);
    }
    if (!history.items.length && !offset) list.textContent = '暂无已生成报告。';
    if (history.items.length===20) {
      const more=document.createElement('button');more.className='button secondary';more.textContent='加载更多报告';
      more.addEventListener('click',run(async()=>{more.remove();await loadHistory(offset+20);}));list.append(more);
    }
  }
  $('report-history').addEventListener('click',run(()=>loadHistory()));
  function backupLocal() {
    const state = getState();
    if (JSON.stringify(state) !== JSON.stringify(syncEnvelope().state)) throw new Error('另一个页面已修改本机记录，请先刷新后再导出备份。');
    const url = URL.createObjectURL(new Blob([JSON.stringify({format:'time-map-backup-v2',state})],{type:'application/json'}));
    const a = document.createElement('a');a.href=url;a.download='恢复前本地备份.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    backupSignature = JSON.stringify(state); $('recovery-saved').checked = false;
    $('recovery-status').textContent = '已发起备份下载；请先在“文件”中确认保存，再勾选下方确认框。';
  }
  $('recovery-backup').addEventListener('click',run(backupLocal));
  $('recovery-saved').addEventListener('change',() => {
    if ($('recovery-saved').checked && !backupMatches()) {
      $('recovery-saved').checked = false;
      $('recovery-status').textContent = '请先单独导出当前备份，确认保存后再勾选。';
    }
  });
  async function recover(useCloud) {
    if (recovering) return;
    if (!$('recovery-saved').checked || !backupMatches()) {
      $('recovery-status').textContent = '尚未恢复：先点“导出恢复前备份”，确认文件保存后勾选确认框。';
      return;
    }
    const warning = useCloud ? '将用云端副本替换本机记录并清除尚未上传的修改。只影响当前测试页。确认继续？'
      : '将按本机快照恢复并修改云端，可能恢复已删除记录或删除本机没有的云端记录。确认执行？';
    if (!confirm(warning)) return;
    recovering = true; paused = true; clearTimeout(retryTimer);
    const controls = ['sync-now','use-cloud','restore-deleted','recovery-backup','rotate-token','range-report','report-history','recovery-saved'];
    for (const id of controls) $(id).disabled = true;
    $('recovery-status').textContent = '正在读取云端并核对版本，请等待…';
    try {
      connected();
      if (client.running) await client.running.catch(() => {});
      if (!backupMatches()) throw new Error('本机记录已改变，请重新保存备份后恢复。');
      let result = await reconcile(api,useCloud);
      client = null;
      if (!useCloud) result = await connected().sync();
      onRestored();
      paused = false; backupSignature = null; $('recovery-saved').checked = false;
      $('sync-status').textContent = `已同步，版本${result.revision}，已采用${useCloud ? '云端' : '本机'}恢复结果。`;
      $('recovery-status').textContent = '恢复完成，页面数据已更新，无需重新加载。';
      $('range-status').textContent = '恢复完成；请仅用一个设备新增和修改记录。';
    } catch (error) {
      paused = true;
      $('recovery-status').textContent = `恢复未完成：${error.message}；请保留备份，停止重复点击并反馈此提示。`;
      $('sync-status').textContent = '自动同步已暂停，请先处理恢复提示。';
      throw error;
    } finally {
      recovering = false;
      for (const id of controls) $(id).disabled = false;
    }
  }
  $('restore-deleted').addEventListener('click',run(()=>recover(false)));
  $('use-cloud').addEventListener('click',run(()=>recover(true)));
  $('rotate-token').addEventListener('click',run(async () => {
    connected(); const result = await api('/v1/device/rotate',{});
    if (hasConnection()) { forgetConnection(); $('connection-status').textContent = '凭据已更换，请重新设置PIN保存新连接。'; }
    $('api-token').value = result.token; client = null;connected();
    $('sync-status').textContent = '旧凭据已撤销，新凭据已填入本次页面，请安全保存。';
  }));
  window.addEventListener('online',changed);
  document.addEventListener('visibilitychange',() => { if (!document.hidden) changed(); });
  if (!unlocked) $('connection-status').textContent = '请输入本机PIN解锁连接；本机计时不受影响。';
  changed();
  return { changed };
}
