export type PhaseKind = 'range' | 'day' | 'event';

export interface Phase {
  id: string;
  name: string;
  kind: PhaseKind;
  startAt: string;
  endAt?: string;
  isCompleted: boolean;
}

export interface Project {
  id: string;
  title: string;
  category: string;
  phases: Phase[];
}

export interface TimelineData {
  categories: string[];
  projects: Project[];
}

export const defaultData: TimelineData = { categories: ['競賽', '研究', '課業'], projects: [] };

const isStr = (v: unknown): v is string => typeof v === 'string';
const isDate = (v: unknown) => isStr(v) && !Number.isNaN(Date.parse(v));

/** 伺服器 PUT 與匯入本機檔案共用的格式檢查 */
export function isTimelineData(d: TimelineData) {
  return (
    Array.isArray(d?.categories) &&
    d.categories.every(isStr) &&
    Array.isArray(d.projects) &&
    d.projects.every(
      p =>
        isStr(p?.id) &&
        isStr(p.title) &&
        d.categories.includes(p.category) &&
        Array.isArray(p.phases) &&
        p.phases.every(
          ph =>
            isStr(ph?.id) &&
            isStr(ph.name) &&
            ['range', 'day', 'event'].includes(ph.kind) &&
            isDate(ph.startAt) &&
            (ph.kind === 'event' || isDate(ph.endAt)) &&
            typeof ph.isCompleted === 'boolean',
        ),
    )
  );
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// ponytail: 不用 crypto.randomUUID，它在非 https（例如用區網 IP 開）時不存在
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const iso = (ms: number) => new Date(ms).toISOString();
export const startMs = (p: Phase) => Date.parse(p.startAt);
export const endMs = (p: Phase) => (p.kind === 'event' ? startMs(p) : Date.parse(p.endAt ?? p.startAt));

/** 整天階段：當地 00:00 到隔天 00:00 */
export function dayBounds(ms: number): [number, number] {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  d.setDate(d.getDate() + 1);
  return [start, d.getTime()];
}

/** 最近一個未完成階段（依截止時間，逾期的排最前） */
export const focusPhase = (phases: Phase[]) =>
  phases.filter(p => !p.isCompleted).sort((a, b) => endMs(a) - endMs(b))[0];

export function formatDuration(ms: number) {
  const total = Math.floor(Math.abs(ms) / 60_000);
  return `${Math.floor(total / 1440)}天 ${Math.floor((total % 1440) / 60)}小時 ${total % 60}分鐘`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 轉成 <input type="datetime-local|date"> 的當地時間字串 */
export function toLocalInput(ms: number, dateOnly = false) {
  const d = new Date(ms);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return dateOnly ? date : `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 'YYYY-MM-DD' 補成當地午夜（new Date('YYYY-MM-DD') 會被當 UTC） */
export function fromLocalInput(value: string) {
  const ms = new Date(value.includes('T') ? value : `${value}T00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

const fmtDate = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`;
const fmtTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function formatPhaseTime(p: Phase) {
  const s = new Date(startMs(p));
  if (p.kind === 'event') return `${fmtDate(s)} ${fmtTime(s)}`;
  if (p.kind === 'day') return `${fmtDate(s)} 整天`;
  const e = new Date(endMs(p));
  return `${fmtDate(s)} ${fmtTime(s)} → ${fmtDate(e)} ${fmtTime(e)}`;
}

type Span = { start: number; end: number };

/** 貪婪分道：重疊的項目往下一條道放，回傳每個項目的道編號 */
export function packLanes(items: Span[]) {
  const laneEnds: number[] = [];
  const lanes: number[] = [];
  items
    .map((_, i) => i)
    .sort((a, b) => items[a].start - items[b].start)
    .forEach(i => {
      let lane = laneEnds.findIndex(end => end <= items[i].start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = items[i].end;
      lanes[i] = lane;
    });
  return lanes;
}

/** 所有階段合併後的空檔（等待期） */
export function gaps(items: Span[]) {
  const out: Span[] = [];
  let reach = -Infinity;
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    if (reach !== -Infinity && it.start > reach) out.push({ start: reach, end: it.start });
    reach = Math.max(reach, it.end);
  }
  return out;
}
