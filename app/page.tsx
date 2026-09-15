'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CalendarRange, Check, ChevronDown, ChevronRight, Clock, Download, Pencil, Plus } from 'lucide-react';
import {
  DAY,
  HOUR,
  type Phase,
  type PhaseKind,
  type Project,
  type TimelineData,
  dayBounds,
  defaultData,
  endMs,
  focusPhase,
  formatDuration,
  formatPhaseTime,
  fromLocalInput,
  gaps,
  isTimelineData,
  iso,
  packLanes,
  startMs,
  toLocalInput,
  uid,
} from '@/lib/timeline';

// 建置時決定：NEXT_PUBLIC_STORAGE=file 給公開架站用，每個訪客讀寫自己電腦上的 JSON；否則走伺服器 API
const FILE_MODE = process.env.NEXT_PUBLIC_STORAGE === 'file';

// File System Access API 只有 Chromium 有，TS 的 lib.dom 也還沒收錄 picker 跟 requestPermission
type FileHandle = FileSystemFileHandle & { requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState> };
type PickerOptions = { types: { description: string; accept: Record<string, string[]> }[]; suggestedName?: string };
type FsWindow = { showOpenFilePicker(o: PickerOptions): Promise<FileHandle[]>; showSaveFilePicker(o: PickerOptions): Promise<FileHandle> };
const PICKER: PickerOptions = { types: [{ description: '任務時間軸存檔', accept: { 'application/json': ['.json'] } }] };
const fsApi = () => ('showOpenFilePicker' in window ? (window as unknown as FsWindow) : null);

async function writeFile(handle: FileHandle, data: TimelineData) {
  const w = await handle.createWritable(); // 寫到暫存檔，close 才取代原檔，中斷不會留下壞檔
  await w.write(JSON.stringify(data, null, 2));
  await w.close();
}

const LEFT = 300; // 左欄寬 px
const LANE = 36; // 每條道高 px
const LABEL_PX = 160; // 窄階段的名稱標籤佔位
const ZOOMS = [
  { label: '週', px: 96 },
  { label: '月', px: 36 },
  { label: '季', px: 14 },
];
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6', '#14b8a6', '#f97316'];
const KINDS: [PhaseKind, string][] = [
  ['range', '區間'],
  ['day', '整天'],
  ['event', '時間點'],
];

const inputCls =
  'w-full min-w-0 rounded-lg border bg-bg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25';
const btnCls = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition';
const ghostBtn = `${btnCls} border bg-panel hover:bg-subtle`;
const primaryBtn = `${btnCls} bg-accent text-white hover:opacity-90`;
const iconBtn = 'grid size-7 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg';

type Dialog =
  | { type: 'phase'; projectId: string; phase?: Phase; at?: number }
  | { type: 'project'; project?: Project; category: string }
  | { type: 'category'; name?: string };

type Drag = { mode: 'move' | 'resize'; projectId: string; phase: Phase; x0: number; moved: boolean };

export default function TimelinePage() {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState<TimelineData | null>(null); // 最後一次讀進來或成功存下去的版本
  const [writeError, setWriteError] = useState(false);
  const [fileName, setFileName] = useState('timeline.json');
  const [fileHandle, setFileHandle] = useState<FileHandle | null>(null); // 本機檔案模式且瀏覽器支援才有，有才能自動存檔
  const canAutoSave = !FILE_MODE || fileHandle !== null;
  const status = data === saved ? 'saved' : writeError ? 'error' : canAutoSave ? 'saving' : 'unsaved';
  const [now, setNow] = useState(() => Date.now());
  const [px, setPx] = useState(ZOOMS[1].px);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const openData = (next: TimelineData, name = fileName, handle: FileHandle | null = null) => {
    setFileHandle(handle);
    setFileName(name);
    setSaved(next);
    setData(next);
  };

  useEffect(() => {
    if (!FILE_MODE)
      fetch('/api/timeline')
        .then(r => (r.ok ? r.json() : Promise.reject()))
        .then(d => openData(d))
        .catch(() => setLoadError(true));
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!data || data === saved || !canAutoSave) return; // 不能自動存檔的瀏覽器，要使用者自己按下載
    const timer = setTimeout(() => {
      const write = fileHandle
        ? writeFile(fileHandle, data)
        : fetch('/api/timeline', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => {
            if (!r.ok) throw new Error(String(r.status));
          });
      write.then(
        () => {
          setSaved(data);
          setWriteError(false);
        },
        () => setWriteError(true),
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [data, saved, canAutoSave, fileHandle]);

  // 還沒存到的變更，關分頁前讓瀏覽器跳確認
  useEffect(() => {
    if (status === 'saved') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status]);

  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setSaved(data);
    setWriteError(false);
  };

  const today = new Date(now).setHours(0, 0, 0, 0);

  // 時間軸範圍：從週一開始，涵蓋今天前三週到最後一個階段之後
  const { rangeStart, days } = useMemo(() => {
    const phases = data?.projects.flatMap(p => p.phases) ?? [];
    const lo = Math.min(today - 21 * DAY, ...phases.map(startMs));
    const hi = Math.max(today + 120 * DAY, ...phases.map(endMs));
    const s = new Date(lo);
    s.setHours(0, 0, 0, 0);
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
    return { rangeStart: s.getTime(), days: Math.ceil((hi - s.getTime()) / DAY) + 30 };
  }, [data, today]);

  const x = (ms: number) => ((ms - rangeStart) / DAY) * px;

  const scrollToToday = (behavior: ScrollBehavior = 'smooth') =>
    scroller.current?.scrollTo({ left: x(today) - Math.min(3 * px, 200), behavior });

  const loaded = data !== null;
  useEffect(() => {
    if (loaded) scrollToToday('instant');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, px]);

  const updateProject = (id: string, fn: (p: Project) => Project) =>
    setData(d => d && { ...d, projects: d.projects.map(p => (p.id === id ? fn(p) : p)) });

  const updatePhases = (projectId: string, fn: (phases: Phase[]) => Phase[]) =>
    updateProject(projectId, p => ({ ...p, phases: fn(p.phases) }));

  const savePhase = (projectId: string, phase: Phase) => {
    updatePhases(projectId, phases =>
      phases.some(p => p.id === phase.id) ? phases.map(p => (p.id === phase.id ? phase : p)) : [...phases, phase],
    );
    setDialog(null);
  };

  const toggleDone = (projectId: string, phaseId: string) =>
    updatePhases(projectId, phases => phases.map(p => (p.id === phaseId ? { ...p, isCompleted: !p.isCompleted } : p)));

  // --- 拖曳：pointer capture，滑鼠與觸控通用 ---
  const onBarDown = (e: React.PointerEvent, projectId: string, phase: Phase) => {
    const target = e.target as HTMLElement;
    if (e.button !== 0 || target.closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode: target.dataset.resize ? 'resize' : 'move', projectId, phase, x0: e.clientX, moved: false };
  };

  const onBarMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    // 對齊刻度：縮放越小對齊越粗，整天階段一律對齊整天
    const snap = d.phase.kind === 'day' ? DAY : ([1, 3, 6, 12].find(h => (h * px) / 24 >= 8) ?? 24) * HOUR;
    const shift = Math.round(((dx / px) * DAY) / snap) * snap;
    const o = d.phase;
    const next: Phase =
      d.mode === 'resize'
        ? { ...o, endAt: iso(Math.max(endMs(o) + shift, startMs(o) + snap)) }
        : { ...o, startAt: iso(startMs(o) + shift), endAt: o.kind === 'event' ? undefined : iso(endMs(o) + shift) };
    updatePhases(d.projectId, phases => phases.map(p => (p.id === o.id ? next : p)));
  };

  const onBarUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) setDialog({ type: 'phase', projectId: d.projectId, phase: d.phase });
  };

  if (loadError)
    return <Centered>讀取資料失敗，請確認 data/timeline.json 格式正確後重新整理。</Centered>;
  if (!data) return FILE_MODE ? <FileGate onOpen={openData} /> : <Centered>載入中…</Centered>;

  const monthStarts: number[] = [];
  for (let d = new Date(rangeStart); d.getTime() < rangeStart + days * DAY; d.setMonth(d.getMonth() + 1, 1)) {
    monthStarts.push(d.getTime());
  }

  return (
    <main className="flex h-dvh flex-col">
      {/* 頂部工具列 */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-panel px-5 py-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="size-5 text-accent" />
          <h1 className="font-semibold tracking-tight">任務時間軸</h1>
        </div>
        <span className={`text-xs ${status === 'error' || status === 'unsaved' ? 'font-medium text-red-500' : 'text-muted'}`}>
          {FILE_MODE && `${fileName} · `}
          {
            {
              saving: '儲存中…',
              error: FILE_MODE ? '無法寫入檔案，請下載存檔' : '儲存失敗，請檢查伺服器',
              unsaved: '有變更尚未下載',
              saved: '已儲存',
            }[status]
          }
        </span>
        {FILE_MODE && (!fileHandle || status === 'error') && (
          <button className={ghostBtn} onClick={download}>
            <Download className="size-4" /> 下載存檔
          </button>
        )}
        <p className="hidden text-xs text-muted xl:block">
          拖曳移動 · 拖右緣調整長度 · 點階段編輯 · 雙擊空白處新增
        </p>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg bg-subtle p-0.5">
            {ZOOMS.map(z => (
              <button
                key={z.label}
                onClick={() => setPx(z.px)}
                className={`rounded-md px-3 py-1 text-sm ${px === z.px ? 'bg-panel font-medium shadow-sm' : 'text-muted hover:text-fg'}`}
              >
                {z.label}
              </button>
            ))}
          </div>
          <button className={ghostBtn} onClick={() => scrollToToday()}>
            今天
          </button>
          <button className={primaryBtn} onClick={() => setDialog({ type: 'category' })}>
            <Plus className="size-4" /> 分類
          </button>
        </div>
      </header>

      <div ref={scroller} className="relative flex-1 overflow-auto">
        <div
          className="relative min-h-full"
          style={{
            width: LEFT + days * px,
            backgroundImage: `linear-gradient(to right, var(--grid) 1px, transparent 1px), linear-gradient(to right, transparent ${5 * px}px, var(--weekend) ${5 * px}px)`,
            backgroundSize: `${px >= 20 ? px : 7 * px}px 100%, ${7 * px}px 100%`,
            backgroundPosition: `${LEFT}px 0`,
          }}
        >
          {/* 日期表頭 */}
          <div className="sticky top-0 z-20 flex border-b bg-panel">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-end border-r bg-panel px-4 pb-2 text-xs text-muted"
              style={{ width: LEFT }}
            >
              專案 · 最近截止
            </div>
            <div className="relative h-13" style={{ width: days * px }}>
              {monthStarts.map((m, i) => (
                <div
                  key={m}
                  className="absolute top-1.5 border-l"
                  style={{ left: x(m), width: x(monthStarts[i + 1] ?? rangeStart + days * DAY) - x(m) }}
                >
                  {/* sticky：捲動時月份標籤黏在左欄右側，永遠看得到目前月份 */}
                  <span className="sticky px-1.5 text-xs font-semibold whitespace-nowrap" style={{ left: LEFT }}>
                    {new Date(m).getFullYear()}/{new Date(m).getMonth() + 1}
                  </span>
                </div>
              ))}
              {Array.from({ length: days }, (_, i) => {
                const d = new Date(rangeStart);
                d.setDate(d.getDate() + i);
                const isToday = d.getTime() === today;
                if (px < 20 && d.getDay() !== 1 && !isToday) return null;
                return (
                  <div
                    key={i}
                    className="absolute bottom-1.5 flex justify-center text-[11px] tabular-nums"
                    style={{ left: x(d.getTime()), width: px < 20 ? undefined : px }}
                  >
                    <span
                      className={`rounded px-1 whitespace-nowrap ${isToday ? 'bg-accent font-semibold text-white' : d.getDay() % 6 === 0 ? 'text-muted/60' : 'text-muted'}`}
                    >
                      {d.getDate()}
                      {px >= 60 && ` ${'日一二三四五六'[d.getDay()]}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 今天線 */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-[5] w-0.5 bg-accent/60"
            style={{ left: LEFT + x(now) }}
          />

          {data.categories.length === 0 && (
            <div className="sticky left-0 p-10 text-sm text-muted" style={{ width: 'min(100vw, 480px)' }}>
              還沒有任何分類，先按右上角「分類」建立一個吧。
            </div>
          )}

          {data.categories.map((category, ci) => {
            const color = COLORS[ci % COLORS.length];
            const projects = data.projects.filter(p => p.category === category);
            const isCollapsed = collapsed[category];
            return (
              <section key={category}>
                <div className="flex border-b bg-subtle/80">
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r bg-subtle py-1.5 pr-2 pl-2"
                    style={{ width: LEFT }}
                  >
                    <button
                      onClick={() => setCollapsed(c => ({ ...c, [category]: !c[category] }))}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm font-semibold"
                    >
                      {isCollapsed ? <ChevronRight className="size-4 text-muted" /> : <ChevronDown className="size-4 text-muted" />}
                      <span className="h-3.5 w-1 rounded-full" style={{ background: color }} />
                      <span className="truncate">{category}</span>
                      <span className="rounded-full bg-panel px-1.5 text-xs font-normal text-muted">{projects.length}</span>
                    </button>
                    <button className={iconBtn} title="在此分類新增專案" onClick={() => setDialog({ type: 'project', category })}>
                      <Plus className="size-4" />
                    </button>
                    <button className={iconBtn} title="編輯分類" onClick={() => setDialog({ type: 'category', name: category })}>
                      <Pencil className="size-3.5" />
                    </button>
                  </div>
                </div>

                {!isCollapsed && projects.length === 0 && (
                  <div className="flex border-b">
                    <div className="sticky left-0 shrink-0 border-r bg-panel px-4 py-3 text-xs text-muted" style={{ width: LEFT }}>
                      尚無專案，按上方 + 新增
                    </div>
                  </div>
                )}

                {!isCollapsed &&
                  projects.map(project => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      color={color}
                      now={now}
                      px={px}
                      x={x}
                      onEditProject={() => setDialog({ type: 'project', project, category })}
                      onAddPhase={at => setDialog({ type: 'phase', projectId: project.id, at })}
                      onToggleDone={phaseId => toggleDone(project.id, phaseId)}
                      rangeStart={rangeStart}
                      bar={{ onBarDown, onBarMove, onBarUp, cancel: () => (drag.current = null) }}
                    />
                  ))}
              </section>
            );
          })}
        </div>
      </div>

      {dialog?.type === 'phase' && (
        <PhaseDialog
          phase={dialog.phase}
          at={dialog.at ?? today + DAY + 9 * HOUR}
          onClose={() => setDialog(null)}
          onSave={phase => savePhase(dialog.projectId, phase)}
          onDelete={
            dialog.phase &&
            (() => {
              updatePhases(dialog.projectId, phases => phases.filter(p => p.id !== dialog.phase?.id));
              setDialog(null);
            })
          }
        />
      )}

      {dialog?.type === 'project' && (
        <ProjectDialog
          project={dialog.project}
          category={dialog.category}
          categories={data.categories}
          onClose={() => setDialog(null)}
          onSave={(title, category) => {
            const editing = dialog.project;
            setData(d => d && {
              ...d,
              projects: editing
                ? d.projects.map(p => (p.id === editing.id ? { ...p, title, category } : p))
                : [...d.projects, { id: uid(), title, category, phases: [] }],
            });
            setDialog(null);
          }}
          onDelete={
            dialog.project &&
            (() => {
              setData(d => d && { ...d, projects: d.projects.filter(p => p.id !== dialog.project?.id) });
              setDialog(null);
            })
          }
        />
      )}

      {dialog?.type === 'category' && (
        <CategoryDialog
          name={dialog.name}
          categories={data.categories}
          projectCount={data.projects.filter(p => p.category === dialog.name).length}
          onClose={() => setDialog(null)}
          onSave={name => {
            const old = dialog.name;
            setData(d => d && {
              categories: old ? d.categories.map(c => (c === old ? name : c)) : [...d.categories, name],
              projects: d.projects.map(p => (old && p.category === old ? { ...p, category: name } : p)),
            });
            setDialog(null);
          }}
          onDelete={
            dialog.name !== undefined
              ? () => {
                  setData(d => d && {
                    categories: d.categories.filter(c => c !== dialog.name),
                    projects: d.projects.filter(p => p.category !== dialog.name),
                  });
                  setDialog(null);
                }
              : undefined
          }
        />
      )}
    </main>
  );
}

function ProjectRow({
  project,
  color,
  now,
  px,
  x,
  rangeStart,
  onEditProject,
  onAddPhase,
  onToggleDone,
  bar,
}: {
  project: Project;
  color: string;
  now: number;
  px: number;
  x: (ms: number) => number;
  rangeStart: number;
  onEditProject: () => void;
  onAddPhase: (at?: number) => void;
  onToggleDone: (phaseId: string) => void;
  bar: {
    onBarDown: (e: React.PointerEvent, projectId: string, phase: Phase) => void;
    onBarMove: (e: React.PointerEvent) => void;
    onBarUp: () => void;
    cancel: () => void;
  };
}) {
  const focus = focusPhase(project.phases);
  const remaining = focus ? endMs(focus) - now : 0;
  const badge =
    remaining < 0
      ? 'bg-red-500 text-white'
      : remaining <= 3 * DAY
        ? 'bg-red-500/15 text-red-600 dark:text-red-400'
        : remaining <= 7 * DAY
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';

  // 以畫面像素分道：窄階段要把旁邊的名稱標籤算進去，才不會文字互相壓到
  const spans = project.phases.map(p => {
    const s = x(startMs(p));
    const w = x(endMs(p)) - s;
    return p.kind === 'event' ? { start: s - 8, end: s + LABEL_PX } : { start: s, end: s + Math.max(w, LABEL_PX) + 4 };
  });
  const lanes = packLanes(spans);
  const laneCount = Math.max(1, ...lanes.map(l => l + 1));
  const height = Math.max(84, 14 + laneCount * LANE);
  const waits = gaps(project.phases.map(p => ({ start: startMs(p), end: endMs(p) }))).filter(g => g.end - g.start >= HOUR);

  return (
    <div className="group flex border-b">
      <div
        className="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1.5 border-r bg-panel py-2 pr-2 pl-4"
        style={{ width: LEFT, minHeight: height }}
      >
        <div className="flex items-center gap-1">
          <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
          <button onClick={onEditProject} className="ml-1 min-w-0 truncate text-left text-sm font-medium hover:text-accent" title="編輯專案">
            {project.title}
          </button>
          <button className={`${iconBtn} ml-auto shrink-0`} title="新增階段" onClick={() => onAddPhase()}>
            <Plus className="size-4" />
          </button>
        </div>
        {focus ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
              <button
                onClick={() => onToggleDone(focus.id)}
                title="標記完成"
                className="grid size-3.5 shrink-0 place-items-center rounded-full border border-current hover:text-emerald-500"
              />
              <span className="truncate">{focus.name}</span>
            </div>
            <span className={`inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${badge}`}>
              <Clock className="size-3" />
              {remaining < 0 ? '已逾期' : '剩'} {formatDuration(remaining)}
            </span>
          </>
        ) : (
          <span className="text-xs text-muted">{project.phases.length ? '✓ 全部階段已完成' : '尚無階段'}</span>
        )}
      </div>

      <div
        className="relative flex-1"
        style={{ height }}
        onDoubleClick={e => {
          if ((e.target as HTMLElement).closest('[data-phase]')) return;
          const ms = rangeStart + ((e.clientX - e.currentTarget.getBoundingClientRect().left) / px) * DAY;
          onAddPhase(new Date(ms).setMinutes(0, 0, 0));
        }}
      >
        {waits.map(g => {
          const w = x(g.end) - x(g.start);
          return (
            <div
              key={g.start}
              className="pointer-events-none absolute flex items-center justify-center border-t border-dashed border-muted/40"
              style={{ left: x(g.start), width: w, top: 7 + LANE / 2 }}
            >
              {w > 70 && (
                <span className="-translate-y-1/2 rounded bg-bg px-1 text-[10px] text-muted">
                  等待 {g.end - g.start >= DAY ? `${Math.round((g.end - g.start) / DAY)} 天` : `${Math.round((g.end - g.start) / HOUR)} 小時`}
                </span>
              )}
            </div>
          );
        })}

        {project.phases.map((phase, i) => {
          const s = x(startMs(phase));
          const w = x(endMs(phase)) - s;
          const isEvent = phase.kind === 'event';
          const inside = !isEvent && w >= LABEL_PX;
          const overdue = !phase.isCompleted && endMs(phase) < now;
          const tone = overdue ? '#ef4444' : color;
          const label = (
            <span className={`flex min-w-0 items-center gap-1.5 px-1.5 text-xs ${phase.isCompleted ? 'line-through' : ''}`}>
              <button
                onClick={() => onToggleDone(phase.id)}
                title={phase.isCompleted ? '取消完成' : '標記完成'}
                className="grid size-3.5 shrink-0 place-items-center rounded-full border"
                style={{ borderColor: tone, background: phase.isCompleted ? tone : undefined }}
              >
                {phase.isCompleted && <Check className="size-2.5 text-white" strokeWidth={3} />}
              </button>
              <span className={`truncate font-medium ${overdue ? 'text-red-500' : ''}`}>{phase.name}</span>
            </span>
          );
          return (
            <div
              key={phase.id}
              data-phase
              title={`${phase.name}\n${formatPhaseTime(phase)}${overdue ? '\n⚠ 已逾期' : ''}`}
              onPointerDown={e => bar.onBarDown(e, project.id, phase)}
              onPointerMove={bar.onBarMove}
              onPointerUp={bar.onBarUp}
              onPointerCancel={bar.cancel}
              className={`absolute flex h-7 cursor-grab touch-none items-center select-none active:cursor-grabbing ${phase.isCompleted ? 'opacity-50' : ''}`}
              style={{ left: isEvent ? s - 7 : s, top: 11 + lanes[i] * LANE, maxWidth: inside ? undefined : LABEL_PX + Math.max(w, 0) }}
            >
              {isEvent ? (
                <>
                  <span className="size-3.5 shrink-0 rotate-45 rounded-[3px] border-2 bg-panel" style={{ borderColor: tone }} />
                  {label}
                </>
              ) : (
                <>
                  <span
                    className="relative flex h-full shrink-0 items-center overflow-hidden rounded-md border shadow-xs"
                    style={{ width: Math.max(w, 6), borderColor: tone, background: `color-mix(in srgb, ${tone} 16%, var(--panel))` }}
                  >
                    {inside && label}
                    {phase.kind === 'range' && (
                      <span data-resize="1" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-black/10" />
                    )}
                  </span>
                  {!inside && label}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const noSubscribe = () => () => {};

/** 本機檔案模式的起始畫面：匯入既有存檔，或建立新的 */
function FileGate({ onOpen }: { onOpen: (data: TimelineData, name: string, handle: FileHandle | null) => void }) {
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const canAutoSave = useSyncExternalStore(noSubscribe, () => fsApi() !== null, () => true);

  const load = async (file: File, handle: FileHandle | null) => {
    const parsed = await file.text().then(JSON.parse).catch(() => null);
    if (!isTimelineData(parsed)) return setError(`「${file.name}」不是任務時間軸的存檔`);
    onOpen(parsed, file.name, handle);
  };

  // 使用者關掉檔案選擇視窗會丟 AbortError，不算錯誤
  const run = (fn: () => Promise<void>) => {
    setError('');
    fn().catch(e => e?.name !== 'AbortError' && setError(`開啟失敗：${e?.message ?? e}`));
  };

  const importFile = async () => {
    const fs = fsApi();
    if (!fs) return input.current?.click();
    const [handle] = await fs.showOpenFilePicker(PICKER);
    // 開檔只拿到讀取權限；趁還在點擊流程裡要寫入權限，被拒就退回手動下載
    const granted = await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
    await load(await handle.getFile(), granted === 'granted' ? handle : null);
  };

  const createFile = async () => {
    const fs = fsApi();
    if (!fs) return onOpen(defaultData, 'timeline.json', null);
    const handle = await fs.showSaveFilePicker({ ...PICKER, suggestedName: 'timeline.json' });
    await writeFile(handle, defaultData);
    onOpen(defaultData, handle.name, handle);
  };

  return (
    <Centered>
      <div className="grid w-[min(92vw,380px)] gap-4 rounded-2xl border bg-panel p-6 text-center text-fg shadow-sm">
        <CalendarRange className="mx-auto size-8 text-accent" />
        <div className="grid gap-1">
          <h1 className="font-semibold">任務時間軸</h1>
          <p className="text-sm text-muted">資料只存在你自己的電腦，不會上傳到伺服器。</p>
        </div>
        <div className="grid gap-2">
          <button className={`${primaryBtn} justify-center py-2`} onClick={() => run(importFile)}>
            匯入存檔
          </button>
          <button className={`${ghostBtn} justify-center py-2`} onClick={() => run(createFile)}>
            建立新的
          </button>
        </div>
        {!canAutoSave && (
          <p className="text-xs text-muted">
            這個瀏覽器不支援直接存回檔案，修改後請按右上角「下載存檔」，下次再匯入。用 Chrome 或 Edge 可以自動存檔。
          </p>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) run(() => load(file, null));
          }}
        />
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid h-dvh place-items-center p-6 text-sm text-muted">{children}</div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={e => e.target === ref.current && onClose()}
      className="m-auto w-[min(92vw,520px)] overflow-visible rounded-2xl border bg-panel text-fg shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-5">
        <h2 className="mb-4 font-semibold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted">
      {label}
      {children}
    </label>
  );
}

function DeleteButton({ onConfirm, confirmText = '再按一次確認刪除' }: { onConfirm: () => void; confirmText?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      onBlur={() => setArmed(false)}
      className={`${btnCls} ${armed ? 'bg-red-500 text-white' : 'text-red-500 hover:bg-red-500/10'}`}
    >
      {armed ? confirmText : '刪除'}
    </button>
  );
}

function DialogActions({ onClose, onDelete, confirmText }: { onClose: () => void; onDelete?: () => void; confirmText?: string }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      {onDelete && <DeleteButton onConfirm={onDelete} confirmText={confirmText} />}
      <button type="button" onClick={onClose} className={`${ghostBtn} ml-auto`}>
        取消
      </button>
      <button className={primaryBtn}>儲存</button>
    </div>
  );
}

function PhaseDialog({
  phase,
  at,
  onSave,
  onDelete,
  onClose,
}: {
  phase?: Phase;
  at: number;
  onSave: (phase: Phase) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<PhaseKind>(phase?.kind ?? 'range');
  const [error, setError] = useState('');
  const start0 = phase ? startMs(phase) : at;
  const end0 = phase?.kind === 'range' ? endMs(phase) : start0 + 3 * DAY;

  return (
    <Modal title={phase ? '編輯階段' : '新增階段'} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={e => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const name = String(f.get('name')).trim();
          let start = fromLocalInput(String(f.get('start')));
          let end = kind === 'range' ? fromLocalInput(String(f.get('end'))) : null;
          if (!name || start === null) return setError('請填寫名稱與時間');
          if (kind === 'range' && (end === null || end <= start)) return setError('結束時間必須晚於開始時間');
          if (kind === 'day') [start, end] = dayBounds(start);
          onSave({
            id: phase?.id ?? uid(),
            name,
            kind,
            startAt: iso(start),
            endAt: end === null ? undefined : iso(end),
            isCompleted: f.get('done') === 'on',
          });
        }}
      >
        <Field label="名稱">
          <input name="name" defaultValue={phase?.name} autoFocus required className={inputCls} placeholder="例如：初賽報名截止" />
        </Field>
        <Field label="類型">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-subtle p-1">
            {KINDS.map(([k, label]) => (
              <button
                type="button"
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-md py-1.5 text-sm ${kind === k ? 'bg-panel font-medium text-fg shadow-sm' : 'font-normal text-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        {kind === 'day' ? (
          <Field label="日期">
            <input key="day" type="date" name="start" required defaultValue={toLocalInput(start0, true)} className={inputCls} />
          </Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={kind === 'event' ? '時間' : '開始'}>
              <input key="dt" type="datetime-local" name="start" required defaultValue={toLocalInput(start0)} className={inputCls} />
            </Field>
            {kind === 'range' && (
              <Field label="結束">
                <input type="datetime-local" name="end" required defaultValue={toLocalInput(end0)} className={inputCls} />
              </Field>
            )}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="done" defaultChecked={phase?.isCompleted} className="size-4 accent-[var(--accent)]" />
          已完成
        </label>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <DialogActions onClose={onClose} onDelete={onDelete} />
      </form>
    </Modal>
  );
}

function ProjectDialog({
  project,
  category,
  categories,
  onSave,
  onDelete,
  onClose,
}: {
  project?: Project;
  category: string;
  categories: string[];
  onSave: (title: string, category: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={project ? '編輯專案' : '新增專案'} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={e => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const title = String(f.get('title')).trim();
          if (title) onSave(title, String(f.get('category')));
        }}
      >
        <Field label="名稱">
          <input name="title" defaultValue={project?.title} autoFocus required className={inputCls} placeholder="例如：NASA Space Apps" />
        </Field>
        <Field label="分類">
          <select name="category" defaultValue={category} className={inputCls}>
            {categories.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <DialogActions
          onClose={onClose}
          onDelete={onDelete}
          confirmText={project?.phases.length ? `連同 ${project.phases.length} 個階段刪除？` : undefined}
        />
      </form>
    </Modal>
  );
}

function CategoryDialog({
  name,
  categories,
  projectCount,
  onSave,
  onDelete,
  onClose,
}: {
  name?: string;
  categories: string[];
  projectCount: number;
  onSave: (name: string) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  return (
    <Modal title={name ? '編輯分類' : '新增分類'} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={e => {
          e.preventDefault();
          const next = String(new FormData(e.currentTarget).get('name')).trim();
          if (!next) return;
          if (next !== name && categories.includes(next)) return setError('已有同名分類');
          onSave(next);
        }}
      >
        <Field label="名稱">
          <input name="name" defaultValue={name} autoFocus required className={inputCls} placeholder="例如：研究所申請" />
        </Field>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <DialogActions
          onClose={onClose}
          onDelete={onDelete}
          confirmText={projectCount ? `連同 ${projectCount} 個專案刪除？` : undefined}
        />
      </form>
    </Modal>
  );
}
