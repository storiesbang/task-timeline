// 執行：node --test lib/timeline.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY, dayBounds, defaultData, focusPhase, formatDuration, fromLocalInput, gaps, isTimelineData, packLanes } from './timeline.ts';

test('isTimelineData 擋掉亂七八糟的匯入檔', () => {
  const ph = { id: 'x', name: 'x', kind: 'event', startAt: '2026-01-01T00:00:00Z', isCompleted: false };
  assert.ok(isTimelineData(defaultData));
  assert.ok(isTimelineData({ categories: ['a'], projects: [{ id: 'p', title: 'p', category: 'a', phases: [ph] }] }));
  assert.ok(!isTimelineData(null));
  assert.ok(!isTimelineData([]));
  assert.ok(!isTimelineData({ categories: ['a'], projects: [{ id: 'p', title: 'p', category: 'b', phases: [] }] }));
  assert.ok(!isTimelineData({ categories: ['a'], projects: [{ id: 'p', title: 'p', category: 'a', phases: [{ ...ph, kind: 'range' }] }] }));
});

test('packLanes 重疊才換道，首尾相接同道', () => {
  assert.deepEqual(packLanes([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 10, end: 20 }, { start: 16, end: 30 }]), [0, 1, 0, 1]);
});

test('gaps 合併重疊後找空檔', () => {
  assert.deepEqual(gaps([{ start: 20, end: 30 }, { start: 0, end: 10 }, { start: 5, end: 12 }, { start: 30, end: 30 }]), [{ start: 12, end: 20 }]);
});

test('formatDuration 與逾期取絕對值', () => {
  assert.equal(formatDuration(DAY + 2 * 3_600_000 + 5 * 60_000), '1天 2小時 5分鐘');
  assert.equal(formatDuration(-90 * 60_000), '0天 1小時 30分鐘');
});

test('日期字串以當地時間解析', () => {
  assert.equal(fromLocalInput('2026-10-23'), new Date(2026, 9, 23).getTime());
  assert.equal(fromLocalInput('2026-10-23T23:59'), new Date(2026, 9, 23, 23, 59).getTime());
  assert.equal(fromLocalInput(''), null);
  assert.deepEqual(dayBounds(new Date(2026, 9, 23, 15).getTime()), [new Date(2026, 9, 23).getTime(), new Date(2026, 9, 24).getTime()]);
});

test('focusPhase 取最早截止的未完成階段', () => {
  const p = (id, endAt, isCompleted = false) => ({ id, name: id, kind: 'range', startAt: '2026-01-01T00:00:00Z', endAt, isCompleted });
  assert.equal(focusPhase([p('a', '2026-03-01T00:00:00Z'), p('b', '2026-02-01T00:00:00Z', true), p('c', '2026-02-15T00:00:00Z')]).id, 'c');
});
