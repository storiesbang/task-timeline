export type PhaseKind = 'range' | 'day' | 'event';

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

export interface Phase {
  id: string;
  name: string;
  kind: PhaseKind;
  startAt: string;
  endAt?: string;
  isCompleted: boolean;
  todos?: Todo[]; // 舊存檔沒有這欄
  importance?: Importance; // 舊存檔沒有這欄，當「中」
}

export type Importance = 1 | 2 | 3; // 低、中、高

export interface Project {
  id: string;
  title: string;
  category: string;
  phases: Phase[];
}

/** 完成或刪除的東西搬來這裡留歷史；刪單一階段時 project 只帶那個階段 */
export interface ArchiveEntry {
  at: string;
  how: 'done' | 'deleted';
  project: Project;
}

export interface TimelineData {
  categories: string[];
  projects: Project[];
  archive?: ArchiveEntry[]; // 舊存檔沒有這欄
}

export const defaultData: TimelineData = { categories: ['競賽', '研究', '課業'], projects: [] };

const isStr = (v: unknown): v is string => typeof v === 'string';
const isDate = (v: unknown) => isStr(v) && !Number.isNaN(Date.parse(v));

const isPhase = (ph: Phase) =>
  isStr(ph?.id) &&
  isStr(ph.name) &&
  ['range', 'day', 'event'].includes(ph.kind) &&
  isDate(ph.startAt) &&
  (ph.kind === 'event' || isDate(ph.endAt)) &&
  typeof ph.isCompleted === 'boolean' &&
  (ph.todos === undefined ||
    (Array.isArray(ph.todos) && ph.todos.every(t => isStr(t?.id) && isStr(t.text) && typeof t.done === 'boolean'))) &&
  (ph.importance === undefined || [1, 2, 3].includes(ph.importance));

const isProject = (p: Project) => isStr(p?.id) && isStr(p.title) && isStr(p.category) && Array.isArray(p.phases) && p.phases.every(isPhase);

/** 伺服器 PUT 與匯入本機檔案共用的格式檢查 */
export function isTimelineData(d: TimelineData) {
  return (
    Array.isArray(d?.categories) &&
    d.categories.every(isStr) &&
    Array.isArray(d.projects) &&
    d.projects.every(p => isProject(p) && d.categories.includes(p.category)) &&
    // 歷史裡的分類可能已經刪掉，不檢查是否存在
    (d.archive === undefined ||
      (Array.isArray(d.archive) && d.archive.every(a => isDate(a?.at) && ['done', 'deleted'].includes(a.how) && isProject(a.project))))
  );
}

/** 把專案搬進歷史 */
export const archived = (d: TimelineData, how: ArchiveEntry['how'], ...projects: Project[]): ArchiveEntry[] => [
  ...(d.archive ?? []),
  ...projects.map(project => ({ at: new Date().toISOString(), how, project })),
];

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

const IMPORTANCE_WEIGHT = { 1: 0.6, 2: 1, 3: 1.6 };

/**
 * 建議優先順序，融合三個法則：
 * - CR 臨界比 =（截止 − 現在）/ 剩餘工作量；剩餘工作量 = 階段長度 × 未完成待辦比例，沒待辦當全部沒做
 * - 重要度（WSJF 的價值項）
 * - 同專案後面還卡著幾個階段（阻塞權重）
 * 權重除在 CR 上（越小越先做）；逾期的 CR 是負的，改乘上去，讓重要的逾期排更前面。
 */
export function priorities(projects: Project[], now: number) {
  return projects
    .flatMap(project =>
      project.phases
        .filter(p => !p.isCompleted)
        .map(phase => {
          const todos = phase.todos ?? [];
          const left = todos.length ? todos.filter(t => !t.done).length / todos.length : 1;
          // ponytail: 至少算 1 小時，時間點階段和待辦全勾的才不會除以 0
          const work = Math.max(HOUR, (endMs(phase) - startMs(phase)) * left);
          const cr = (endMs(phase) - now) / work;
          const blocks = project.phases.filter(o => o !== phase && !o.isCompleted && startMs(o) >= endMs(phase)).length;
          const weight = IMPORTANCE_WEIGHT[phase.importance ?? 2] * (1 + 0.2 * blocks);
          return { project, phase, cr, score: cr < 0 ? cr * weight : cr / weight };
        }),
    )
    .sort((a, b) => a.score - b.score);
}

/** CR 判讀：<0 逾期、<1 照原估工作量已經來不及、<1.5 沒什麼餘裕 */
export const crStatus = (cr: number) => (cr < 0 ? '已逾期' : cr < 1 ? '落後' : cr < 1.5 ? '緊繃' : null);

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
