import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSyncTime, toLocalDateTime, parseLocalDateTime, dateFromKey, segmentsOfDay } from '../js/time.js';

test('同步 UTC 和带偏移时间显示为北京时间，不修改持久化值', () => {
  const iso = '2026-10-30T02:17:00.000Z';
  assert.equal(formatSyncTime(iso), '2026-10-30 10:17:00（北京时间 Asia/Shanghai）');
  assert.equal(formatSyncTime('2026-10-30T10:17:00+08:00'), formatSyncTime(iso));
  assert.equal(iso, '2026-10-30T02:17:00.000Z');
  assert.equal(formatSyncTime(null), '已核对云端，无待上传变更');
  for (const bad of ['bad', '2026-10-30T02:17:00', 123]) assert.equal(formatSyncTime(bad), '同步时间不可用');
});

test('北京时间跨午夜、跨年和报告边界使用同一时刻', () => {
  for (const [iso, local] of [['2026-10-30T16:00:00Z', '2026-10-31T00:00:00'], ['2026-12-31T16:00:00Z', '2027-01-01T00:00:00']]) {
    const stamp = Date.parse(iso);
    assert.equal(toLocalDateTime(stamp), local);
    assert.equal(parseLocalDateTime(local), stamp);
    assert.equal(dateFromKey(local.slice(0, 10)).getTime(), stamp);
    assert.equal(formatSyncTime(iso), `${local.replace('T', ' ')}（北京时间 Asia/Shanghai）`);
  }
  const segment = {start:Date.parse('2026-10-30T15:30:00Z'), end:Date.parse('2026-10-30T16:30:00Z')};
  assert.equal(segmentsOfDay([segment], '2026-10-30')[0].duration, 1800000);
  assert.equal(segmentsOfDay([segment], '2026-10-31')[0].duration, 1800000);
  assert.deepEqual(segmentsOfDay([segment], '2026-11-01'), []);
});

test('同步显示不依赖手机或宿主时区', () => {
  const original = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Shanghai']) {
      process.env.TZ = timezone;
      assert.equal(formatSyncTime('2026-10-30T16:00:00Z'), '2026-10-31 00:00:00（北京时间 Asia/Shanghai）');
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
