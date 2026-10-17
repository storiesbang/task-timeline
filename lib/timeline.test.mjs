// 執行：node --test lib/timeline.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY, HOUR, dayBounds, priorities, defaultData, focusPhase, formatDuration, fromLocalInput, gaps, isTimelineData, packLanes } from './timeline.ts';

test('isTimelineData 擋掉亂七八糟的匯入檔', () => {
  const ph = { id: 'x', name: 'x', kind: 'event', startAt: '2026-01-01T00:00:00Z', isCompleted: false };
  assert.ok(isTimelineData(defaultData));
  assert.ok(isTimelineData({ categories: ['a'], projects: [{ id: 'p', title: 'p', category: 'a', phases: [ph] }] }));
  const todo = { id: 't', text: '寫摘要', done: false };
  assert.ok(isTimelineData({ categories: ['a'], projects: [{ id: 'p', title: 'p', category: 'a', phases: [{ ...ph, todos: [todo] }] }] }));
  assert.ok(!isTimelineData({ categories: ['a'], projects: [{ id: 'p', title: 'p', category: 'a', phases: [{ ...ph, todos: [{ ...todo, done: 'no' }] }] }] }));
  const proj = { id: 'p', title: 'p', category: '已刪分類', phases: [ph] };
  assert.ok(isTimelineData({ ...defaultData, archive: [{ at: '2026-01-01T00:00:00Z', how: 'done', project: proj }] }));
  assert.ok(!isTimelineData({ ...defaultData, archive: [{ at: '2026-01-01T00:00:00Z', how: 'gone', project: proj }] }));
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

test('priorities 融合 CR、重要度、阻塞', () => {
  const now = Date.parse('2026-01-10T00:00:00Z');
  const ph = (id, start, end, extra = {}) => ({ id, name: id, kind: 'range', startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), isCompleted: false, ...extra });
  const todos = (done, total) => Array.from({ length: total }, (_, i) => ({ id: String(i), text: 'x', done: i < done }));
  const order = phases => priorities([{ id: 'p', title: 'p', category: 'a', phases }], now).map(r => r.phase.id);
  // 同樣 2 天後截止、都排 4 天：待辦快做完的往後排
  assert.deepEqual(order([ph('快完成', now - 2 * DAY, now + 2 * DAY, { todos: todos(3, 4) }), ph('還沒做', now - 2 * DAY, now + 2 * DAY)]), ['還沒做', '快完成']);
  // 逾期一律最前；完成的不列入
  assert.deepEqual(order([ph('閒', now, now + 30 * DAY), ph('逾期', now - 3 * DAY, now - HOUR), ph('完成', now, now + DAY, { isCompleted: true })]), ['逾期', '閒']);
  // CR 一樣時，重要度高的先
  assert.deepEqual(order([ph('低', now, now + 4 * DAY, { importance: 1 }), ph('高', now, now + 4 * DAY, { importance: 3 })]), ['高', '低']);
  // 時間點階段不會除以 0
  assert.ok(Number.isFinite(priorities([{ id: 'p', title: 'p', category: 'a', phases: [{ id: 'e', name: 'e', kind: 'event', startAt: new Date(now + DAY).toISOString(), isCompleted: false }] }], now)[0].cr));
});
