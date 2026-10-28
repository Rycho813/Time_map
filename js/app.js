/**
 * 文件作用：应用总控制器，相当于“指挥员”。
 * 启动时读取 storage.js 的数据，把 time.js 的计算结果画到 index.html；
 * 用户点击到达、离开、修改、备份等按钮时，在这里选择对应操作并保存。
 * 无外部前端框架；只有用户显式连接服务后才同步个人记录。
 */

import { loadState, saveState, copyState, validateState, newId, STORAGE_KEY, V2_KEY } from './storage.js';
import { localDateKey, dateFromKey, moveDay, toLocalDateTime, parseLocalDateTime,
  formatClock, formatDuration, readableDuration, segmentsOfDay, dayTotals, displayDayClock } from './time.js';

import { wireRange } from './range-ui.js';
let rangeTools;

// $ 简写为“在网页里找一个带有指定 id 的元素”。
const $ = id => document.getElementById(id);
let state;
let selectedDay = localDateKey(new Date());
let lastToday = selectedDay;
let editingSegmentId = null;
let noticeTimer = null;

// 使用 textContent 显示所有用户输入，避免名称被浏览器误认为 HTML 代码。
function node(tag, className = '', text = '') {
  const item = document.createElement(tag);
  if (className) item.className = className;
  item.textContent = text;
  return item;
}
function button(text, className, action, id) {
  const b = node('button', className, text);
  b.type = 'button';
  b.dataset.action = action;
  if (id) b.dataset.id = id;
  return b;
}
function placeLabel(segment) {
  return state.places.find(p => p.id === segment.placeId)?.name || segment.placeName;
}
function activeSegment() {
  const last = state.segments.at(-1);
  return last && last.end === null ? last : null;
}
function notify(message, isError = false) {
  const n = $('notice');
  n.textContent = message;
  n.classList.toggle('error', isError);
  n.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { n.hidden = true; }, isError ? 8000 : 3500);
}

// 核心安全步骤：先在草稿上修改 -> 验证时间不重叠 -> 一次性写入手机 -> 刷新界面。
// 写入失败时，内存中的正式记录完全不变。
function commit(change, successText = '已保存') {
  try {
    const draft = copyState(state);
    change(draft);
    saveState(draft);
    state = draft;
    rangeTools?.changed();
    renderAll();
    if (successText) notify(successText);
    return true;
  } catch (error) {
    notify(error.message || '保存失败，请检查本机存储空间。', true);
    return false;
  }
}
function requireForwardTime(now, active) {
  if (active && now < active.start) throw new Error('手机时间早于当前计时起点；请先校准设备时间。');
}

function arrive(placeId) {
  const place = state.places.find(p => p.id === placeId);
  if (!place) return notify('地点不存在，请重新选择。', true);
  const active = activeSegment();
  if (active?.kind === 'place') return notify('请先点击「离开」，再点击下一地点「到达」。', true);
  const now = Date.now();
  commit(draft => {
    requireForwardTime(now, active);
    if (active?.kind === 'transit') draft.segments.at(-1).end = now;
    draft.segments.push({ id: newId(), kind: 'place', placeId: place.id,
      placeName: place.name, start: now, end: null });
  }, `已到达「${place.name}」，开始计时`);
}

function leave() {
  const active = activeSegment();
  if (!active || active.kind !== 'place') return notify('当前不在地点停留状态。', true);
  const now = Date.now();
  commit(draft => {
    requireForwardTime(now, active);
    draft.segments.at(-1).end = now;
    draft.segments.push({ id: newId(), kind: 'transit', start: now, end: null });
  }, '已离开，开始记录路程时间');
}

function renderActive() {
  const active = activeSegment();
  const badge = $('active-badge');
  badge.className = 'state-badge';
  badge.textContent = !active ? '未开始' : active.kind === 'place' ? '地点停留中' : '路程进行中';
  if (active) badge.classList.add(active.kind);
  $('active-title').textContent = !active ? '还没有开始记录' : active.kind === 'place' ? placeLabel(active) : '路程中';
  $('active-since').textContent = active ? `${formatClock(active.start)} 开始` : '选择下方地点，点击「到达」。';
  $('leave-btn').disabled = !active || active.kind !== 'place';
  $('action-hint').textContent = !active ? '第一次点击「到达」即开始；没有记录时不会计时。'
    : active.kind === 'place' ? '要去下一地点？先点「离开」，到达后再点目标地点。'
    : '到达下一地点后，直接点击该地点按钮，路程自动结束。';
  refreshClock();
}
function refreshClock() {
  const active = activeSegment();
  $('active-clock').textContent = active ? formatDuration(Math.max(0, Date.now() - active.start)) : '00:00:00';
}

function renderPlaces() {
  const active = activeSegment();
  const wrap = $('quick-places');
  wrap.replaceChildren();
  if (!state.places.length) {
    wrap.append(node('div', 'empty', '还没有常用地点，先在下方添加。'));
  }
  for (const place of state.places) {
    const b = button(place.name, 'quick-place', 'arrive', place.id);
    const mini = node('span', 'quick-mini', active?.kind === 'place'
      ? (active.placeId === place.id ? '当前地点' : '请先离开') : '点击到达');
    b.append(mini);
    b.disabled = active?.kind === 'place';
    wrap.append(b);
  }
  $('quick-hint').textContent = active?.kind === 'transit' ? '路程进行中：点一下目的地，即可结束路程。'
    : active?.kind === 'place' ? '当前地点计时中：离开后才能选择下一地点。'
    : '新增地点后点击一次，即可开始。';

  const manager = $('manage-places');
  manager.replaceChildren();
  if (!state.places.length) manager.append(node('p', 'helper', '暂无地点。'));
  for (const place of state.places) {
    const row = node('div', 'manage-place');
    row.append(node('span', 'manage-name', place.name),
      button('改名', 'link-action', 'rename', place.id),
      button('删除', 'link-action remove', 'remove-place', place.id));
    manager.append(row);
  }
}

function stat(name, value) {
  const box = node('div', 'stat');
  box.append(node('div', 'stat-value', value), node('div', 'stat-label', name));
  return box;
}
function renderDay() {
  $('day-select').value = selectedDay;
  let parts;
  try { parts = segmentsOfDay(state.segments, selectedDay); }
  catch (error) { return notify(error.message, true); }
  const totals = dayTotals(parts, state.places);
  const summary = $('day-summary');
  summary.replaceChildren();
  const overview = node('div', 'summary-overview');
  overview.append(stat('已记录', readableDuration(totals.totalMs)),
    stat('地点停留', readableDuration(totals.placeMs)),
    stat('全部路程', readableDuration(totals.transitMs)));
  summary.append(overview);
  if (!parts.length) summary.append(node('div', 'empty', '这一天还没有记录。'));
  else {
    summary.append(node('p', 'summary-title', '地点及路程时间汇总'));
    for (const entry of [
      ...totals.locations.map(p => ({ name: p.name, duration: p.duration, transit: false })),
      { name: '全部路程（合并）', duration: totals.transitMs, transit: true }
    ]) {
      const row = node('div', 'summary-row');
      row.append(node('div', 'summary-name', entry.name),
        node('div', 'summary-duration', readableDuration(entry.duration)));
      const meter = node('div', 'meter');
      const fill = node('div', entry.transit ? 'meter-fill transit' : 'meter-fill');
      fill.style.width = `${totals.totalMs ? entry.duration / totals.totalMs * 100 : 0}%`;
      meter.append(fill); row.append(meter); summary.append(row);
    }
  }

  const timeline = $('timeline');
  timeline.replaceChildren();
  if (!parts.length) {
    timeline.append(node('div', 'empty', '暂无时间轴。'));
    return;
  }
  for (const part of parts) {
    const card = node('article', `timeline-item ${part.kind === 'transit' ? 'transit' : ''}`);
    const top = node('div', 'timeline-top');
    const start = displayDayClock(part.displayStart, selectedDay);
    const end = part.end === null && selectedDay === localDateKey(new Date())
      ? '进行中' : displayDayClock(part.displayEnd, selectedDay, true);
    top.append(node('span', 'timeline-times', `${start}–${end}`),
      node('span', 'timeline-title', part.kind === 'transit' ? '路程' : placeLabel(part)),
      node('span', 'timeline-duration', readableDuration(part.duration)));
    const actions = node('div', 'timeline-actions');
    actions.append(button('修改', 'link-action', 'edit', part.id),
      button('删除', 'link-action remove', 'remove-segment', part.id));
    card.append(top, actions);
    timeline.append(card);
  }
}
function renderAll() { renderActive(); renderPlaces(); renderDay(); }

function addPlace(name) {
  const clean = name.trim();
  if (!clean) return notify('地点名称不能为空。', true);
  if (clean.length > 36) return notify('地点名称不能超过 36 字符。', true);
  const ok = commit(draft => {
    if (draft.places.some(p => p.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
      throw new Error('这个地点已经存在。');
    }
    draft.places.push({ id: newId(), name: clean });
  }, `已添加「${clean}」`);
  if (ok) $('new-place').value = '';
}
function renamePlace(id) {
  const p = state.places.find(place => place.id === id);
  if (!p) return;
  const input = prompt('修改地点名称：', p.name);
  if (input === null) return;
  const clean = input.trim();
  if (!clean || clean.length > 36) return notify('地点名必须在 1～36 字符之间。', true);
  commit(draft => {
    if (draft.places.some(place => place.id !== id && place.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
      throw new Error('已有同名地点。');
    }
    draft.places.find(place => place.id === id).name = clean;
    // 也更新每段的名称快照，删除地点后仍能留下最后改过的名称。
    for (const s of draft.segments) if (s.kind === 'place' && s.placeId === id) s.placeName = clean;
  }, '地点名称已修改');
}
function deletePlace(id) {
  const p = state.places.find(place => place.id === id);
  if (!p || !confirm(`删除常用地点「${p.name}」？\n已有历史记录会保留；但以后不再能从快捷按钮选择此地点。`)) return;
  commit(draft => { draft.places = draft.places.filter(place => place.id !== id); }, '常用地点已删除，历史记录保留');
}

function openEditor(id) {
  const s = state.segments.find(segment => segment.id === id);
  if (!s) return;
  editingSegmentId = id;
  $('edit-kind').value = s.kind;
  const selector = $('edit-place');
  selector.replaceChildren();
  for (const p of state.places) {
    const option = node('option', '', p.name);
    option.value = p.id;
    selector.append(option);
  }
  if (s.kind === 'place' && !state.places.some(p => p.id === s.placeId)) {
    const option = node('option', '', `${s.placeName}（原地点，已从快捷入口删除）`);
    option.value = s.placeId;
    selector.append(option);
  }
  if (s.kind === 'place') selector.value = s.placeId;
  $('edit-start').value = toLocalDateTime(s.start);
  $('edit-end').value = s.end === null ? '' : toLocalDateTime(s.end);
  $('edit-end-row').hidden = s.end === null;
  $('edit-note').textContent = s.end === null
    ? '正在计时的记录没有结束时间；可以修改开始时间及地点。'
    : '如修改了两段相连接的交界时间，将自动同步相邻段的时间，避免重复。';
  updateEditorKind();
  $('edit-dialog').showModal();
}
function updateEditorKind() {
  $('edit-place-row').hidden = $('edit-kind').value !== 'place';
}
function submitEditor() {
  const s = state.segments.find(segment => segment.id === editingSegmentId);
  if (!s) return;
  try {
    const newKind = $('edit-kind').value;
    const chosen = $('edit-place').value;
    const selectedPlace = state.places.find(p => p.id === chosen);
    if (newKind === 'place' && !selectedPlace && !(s.kind === 'place' && s.placeId === chosen)) {
      throw new Error('先添加一个地点，才能把本段改为地点停留。');
    }
    // 未改变的输入保留原始毫秒值，避免编辑精确到秒时损失相邻段边界的小数部分。
    const newStart = $('edit-start').value === toLocalDateTime(s.start)
      ? s.start : parseLocalDateTime($('edit-start').value);
    const newEnd = s.end === null ? null : ($('edit-end').value === toLocalDateTime(s.end)
      ? s.end : parseLocalDateTime($('edit-end').value));
    if (newEnd !== null && newEnd < newStart) throw new Error('结束时间不能早于开始时间。');
    if (newEnd === null && newStart > Date.now()) throw new Error('计时开始时间不能在未来。');

    const success = commit(draft => {
      const i = draft.segments.findIndex(part => part.id === editingSegmentId);
      const original = draft.segments[i];
      const prev = draft.segments[i - 1], next = draft.segments[i + 1];
      // 如果原来两段正好首尾相接，改边界时自动同步相邻段。
      if (prev && prev.end === original.start && newStart !== original.start) prev.end = newStart;
      if (next && original.end !== null && next.start === original.end && newEnd !== original.end) next.start = newEnd;
      original.start = newStart;
      original.end = newEnd;
      original.kind = newKind;
      if (newKind === 'place') {
        original.placeId = chosen;
        original.placeName = selectedPlace?.name || s.placeName;
      } else {
        delete original.placeId;
        delete original.placeName;
      }
    }, '时间记录已修改');
    if (success) { $('edit-dialog').close(); editingSegmentId = null; }
  } catch (error) { notify(error.message, true); }
}
function deleteSegment(id) {
  const s = state.segments.find(part => part.id === id);
  if (!s) return;
  const activeWarning = s.end === null ? '\n这会结束当前计时，并回到「未开始」状态。' : '';
  if (!confirm(`删除这段${s.kind === 'place' ? '地点停留' : '路程'}记录？删除后不会自动补齐空白时间。${activeWarning}`)) return;
  commit(draft => { draft.segments = draft.segments.filter(part => part.id !== id); }, '记录已删除');
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportBackup() {
  download(`时间去向-备份-${localDateKey(new Date())}.json`, JSON.stringify({format: 'time-map-backup-v2', state}, null, 2));
  notify('已生成备份，请确认文件保存到了设备或云盘。');
}
async function importBackup(file) {
  if (!file) return;
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error('备份大于 30 MB，请检查文件是否正确。');
    const parsed = JSON.parse(await file.text());
    const data = parsed.format === 'time-map-backup-v2' ? parsed.state : parsed;
    validateState(data);
    if (!confirm(`此备份包含 ${data.places.length} 个地点、${data.segments.length} 段记录。\n导入会完全覆盖本机现有记录，建议先导出当前备份。\n确定覆盖吗？`)) return;
    // 写入成功后才替换界面内数据；没有联网步骤。
    saveState(data);
    state = data;
    rangeTools?.changed();
    renderAll();
    notify('备份已恢复');
  } catch (error) { notify(`导入失败：${error.message}`, true); }
  finally { $('import-file').value = ''; }
}

function wireEvents() {
  $('leave-btn').addEventListener('click', leave);
  $('quick-places').addEventListener('click', event => {
    const target = event.target.closest('button[data-action="arrive"]');
    if (target) arrive(target.dataset.id);
  });
  $('add-place-form').addEventListener('submit', event => {
    event.preventDefault(); addPlace($('new-place').value);
  });
  $('manage-places').addEventListener('click', event => {
    const target = event.target.closest('button[data-action]');
    if (!target) return;
    if (target.dataset.action === 'rename') renamePlace(target.dataset.id);
    if (target.dataset.action === 'remove-place') deletePlace(target.dataset.id);
  });
  $('today-btn').addEventListener('click', () => { selectedDay = localDateKey(new Date()); renderDay(); });
  $('prev-day').addEventListener('click', () => { selectedDay = moveDay(selectedDay, -1); renderDay(); });
  $('next-day').addEventListener('click', () => { selectedDay = moveDay(selectedDay, 1); renderDay(); });
  $('day-select').addEventListener('change', event => {
    try { dateFromKey(event.target.value); selectedDay = event.target.value; renderDay(); }
    catch (error) { notify(error.message, true); $('day-select').value = selectedDay; }
  });
  $('timeline').addEventListener('click', event => {
    const target = event.target.closest('button[data-action]');
    if (!target) return;
    if (target.dataset.action === 'edit') openEditor(target.dataset.id);
    if (target.dataset.action === 'remove-segment') deleteSegment(target.dataset.id);
  });
  $('edit-kind').addEventListener('change', updateEditorKind);
  $('edit-form').addEventListener('submit', event => { event.preventDefault(); submitEditor(); });
  for (const id of ['close-dialog', 'cancel-edit']) {
    $(id).addEventListener('click', () => { $('edit-dialog').close(); editingSegmentId = null; });
  }
  $('export-btn').addEventListener('click', exportBackup);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', event => importBackup(event.target.files?.[0]));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderAll(); });
}

function start() {
  try {
    state = loadState();
  } catch (error) {
    $('app').hidden = true;
    $('fatal').hidden = false;
    $('fatal-message').textContent = `为避免覆盖历史记录，应用已停止写入。原因：${error.message}`;
    $('fatal-export').addEventListener('click', () => {
      try { download('时间去向-原始故障数据.json', localStorage.getItem(V2_KEY) || localStorage.getItem(STORAGE_KEY) || ''); }
      catch (e) { alert(`无法下载：${e.message}`); }
    });
    return;
  }
  wireEvents();
  rangeTools = wireRange(() => state);
  renderAll();
  setInterval(() => {
    const today = localDateKey(new Date());
    if (today !== lastToday) {
      if (selectedDay === lastToday) selectedDay = today;
      lastToday = today;
      renderAll();
    } else {
      refreshClock();
    }
  }, 1000);
  setInterval(() => { if (!document.hidden) renderDay(); }, 15000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(error => {
      console.warn('离线缓存未启用：', error);
      notify('离线缓存未启用。联网仍可使用；请确认通过 HTTPS 或 localhost 打开。', true);
    });
  }
}
start();
