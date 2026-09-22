/**
 * 烟花燃放编排台 —— 页面业务文件
 *
 * 组合 grid（配乐网格）、validation（判定）、storage（本地存储）三块：
 * 登记表的每一行是一发待判点火节点；保存时整批送判定，
 * 通过才落本地并刷新时间轴 / 点位图，不通过则原编排不动、冲突清单报错。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BEAT_DURATION,
  PAD_ORDER,
  PADS,
  SEGMENTS,
  SEGMENT_ORDER,
  TOTAL_BEATS,
  TOTAL_DURATION,
  type PadId,
  type SegmentId,
  beatToTime,
  formatClock,
  parseTimeInput,
  segmentOfBeat,
  snapToBeat,
} from "./grid";
import { validateBatch, type DraftNode, type FiringNode } from "./validation";
import { loadShow, saveShow, clearShow, type StoredShow } from "./storage";

const PRODUCTS = [
  "75mm 礼花弹",
  "100mm 礼花弹",
  "120mm 礼花弹",
  "150mm 礼花弹",
  "30mm 扇形架",
  "罗马烛光 ×6",
  "罗马烛光 ×12",
  "冷焰火喷泉",
  "闪雷组合盆",
];

function nodesToDrafts(nodes: FiringNode[]): DraftNode[] {
  return nodes.map((n) => ({
    label: n.label,
    product: n.product,
    padId: n.padId,
    segmentId: n.segmentId,
    targetBeat: n.targetBeat,
    timeInput: Number.isInteger(n.time) ? String(n.time) : n.time.toFixed(1),
  }));
}

function timeText(t: number): string {
  return Number.isInteger(t) ? String(t) : t.toFixed(1);
}

export default function ConsolePage() {
  const [show, setShow] = useState<StoredShow>(() => loadShow());
  const [drafts, setDrafts] = useState<DraftNode[]>(() => nodesToDrafts(loadShow().nodes));
  const [submitState, setSubmitState] = useState<
    | { kind: "idle" }
    | { kind: "rejected"; count: number }
    | { kind: "accepted"; count: number; savedAt: string }
  >({ kind: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  // 实时判定：只驱动冲突清单与行内提示；真正的落盘仍以「保存」按钮为准
  const live = useMemo(() => validateBatch(drafts), [drafts]);
  const conflictRows = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const c of live.conflicts) {
      const set = map.get(c.row) ?? new Set<string>();
      set.add(c.code);
      map.set(c.row, set);
    }
    return map;
  }, [live]);

  // 预演播放头
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let startedAt: number | null = null;
    const tick = (ts: number) => {
      if (startedAt === null) startedAt = ts;
      const t = ((ts - startedAt) / 1000) % TOTAL_DURATION;
      setPlayhead(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const updateRow = (row: number, patch: Partial<DraftNode>) => {
    setDrafts((prev) => prev.map((d, i) => (i === row ? { ...d, ...patch } : d)));
    setSubmitState({ kind: "idle" });
  };

  const changeTargetBeat = (row: number, beat: number) => {
    const clamped = Math.min(TOTAL_BEATS, Math.max(1, Math.round(beat) || 1));
    const patch: Partial<DraftNode> = {
      targetBeat: clamped,
      timeInput: timeText(beatToTime(clamped)),
    };
    const seg = segmentOfBeat(clamped);
    if (seg) patch.segmentId = seg.id;
    updateRow(row, patch);
  };

  const addRow = () => {
    const usedPads = drafts.map((d) => d.padId);
    const padId = (PAD_ORDER.find((p) => !usedPads.includes(p)) ??
      PAD_ORDER[drafts.length % PAD_ORDER.length]) as PadId;
    const beat = Math.min(SEGMENTS.chorusA.endBeat, 20 + drafts.length * 2);
    const seg = segmentOfBeat(beat)!;
    setDrafts((prev) => [
      ...prev,
      {
        label: `节点 ${prev.length + 1}`,
        product: PRODUCTS[prev.length % PRODUCTS.length],
        padId,
        segmentId: seg.id,
        targetBeat: beat,
        timeInput: timeText(beatToTime(beat)),
      },
    ]);
    setSubmitState({ kind: "idle" });
  };

  const removeRow = (row: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== row));
    setSubmitState({ kind: "idle" });
  };

  const handleSave = () => {
    const result = validateBatch(drafts);
    if (!result.ok || !result.accepted) {
      // 整批拒绝：show 不更新，时间轴 / 点位图维持原编排
      setSubmitState({ kind: "rejected", count: result.conflicts.length });
      const first = result.conflicts.find((c) => c.row > 0);
      if (first) {
        setActiveRow(first.row);
        rowRefs.current[first.row - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    const saved = saveShow(result.accepted);
    setShow(saved);
    setDrafts(nodesToDrafts(saved.nodes));
    setSelectedId(null);
    setSubmitState({ kind: "accepted", count: saved.nodes.length, savedAt: saved.savedAt });
  };

  const handleReloadSaved = () => {
    setDrafts(nodesToDrafts(show.nodes));
    setSubmitState({ kind: "idle" });
    setSelectedId(null);
  };

  const handleResetPreset = () => {
    const fresh = clearShow();
    setShow(fresh);
    setDrafts(nodesToDrafts(fresh.nodes));
    setSubmitState({ kind: "idle" });
  };

  const focusConflictRow = (row: number) => {
    if (row < 1) return;
    setActiveRow(row);
    rowRefs.current[row - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const firingNow = new Set(
    show.nodes.filter((n) => Math.abs(n.time - playhead) <= BEAT_DURATION / 2).map((n) => n.id),
  );

  return (
    <main className="console">
      <header className="console-head">
        <div>
          <p className="kicker">FIREWORKS CUE CONSOLE</p>
          <h1>烟花燃放编排台</h1>
          <span>
            三段节目 · 四个点位 · 配乐每 0.5s 一拍（第 1 拍 = 0s）。保存时先把时刻吸附到最近拍点，
            再整批校验；有冲突则整批拒绝，原编排不动。
          </span>
        </div>
        <div className="head-stats">
          <div><small>节目段落</small><strong>{SEGMENT_ORDER.length}</strong></div>
          <div><small>燃放点位</small><strong>{PAD_ORDER.length}</strong></div>
          <div><small>已保存节点</small><strong>{show.nodes.length}</strong></div>
          <div className={live.ok ? "" : "stat-bad"}>
            <small>待判冲突</small><strong>{live.conflicts.length}</strong>
          </div>
        </div>
      </header>

      <Banner state={submitState} savedAt={show.savedAt} />

      <section className="panel">
        <PanelTitle
          title="配乐时间轴"
          subtitle={`总长 ${TOTAL_DURATION}s · ${TOTAL_BEATS} 拍 · 每拍 ${BEAT_DURATION}s，按点位分四道`}
          right={
            <div className="transport">
              <button className={playing ? "primary" : ""} onClick={() => setPlaying((p) => !p)}>
                {playing ? "⏸ 暂停预演" : "▶ 整场预演"}
              </button>
              <button onClick={() => { setPlaying(false); setPlayhead(0); }}>⏮ 回到开头</button>
              <span className="clock">{formatClock(playhead)}</span>
            </div>
          }
        />
        <Timeline
          nodes={show.nodes}
          selectedId={selectedId}
          onSelect={setSelectedId}
          playhead={playhead}
          playing={playing}
          firingNow={firingNow}
        />
      </section>

      <div className="two-col">
        <section className="panel">
          <PanelTitle title="燃放点位平面图" subtitle="按场地百分比摆放，预演时该点位点火会闪烁" />
          <PadMap
            nodes={show.nodes}
            selectedId={selectedId}
            onSelect={setSelectedId}
            firingNow={firingNow}
          />
        </section>

        <section className="panel conflict-panel">
          <PanelTitle
            title="冲突清单"
            subtitle={
              live.ok
                ? "当前登记表实时判定通过，保存即可落本地"
                : `实时判定发现 ${live.conflicts.length} 条问题，保存会被整批拒绝`
            }
          />
          <div className={live.ok ? "conflicts all-good" : "conflicts"}>
            {live.ok ? (
              <p className="ok-line">✓ 拍号偏离、段落区间、同点位间隔三项全部通过</p>
            ) : (
              live.conflicts.map((c, i) => (
                <button
                  key={`${c.code}-${c.row}-${i}`}
                  className={`conflict conf-${c.code} ${activeRow === c.row ? "active" : ""}`}
                  onClick={() => focusConflictRow(c.row)}
                >
                  <b>{conflictLabel(c.code)}</b>
                  <span>{c.message}</span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <PanelTitle
          title="点火节点登记表"
          subtitle="登记目标拍号与点火时刻；保存前自动吸附到最近拍点，再整批校验"
          right={
            <div className="row-actions">
              <button onClick={addRow}>＋ 加一发</button>
              <button onClick={handleReloadSaved}>撤销改动 / 取回已保存编排</button>
              <button className="primary" onClick={handleSave}>
                吸附并整批保存
              </button>
            </div>
          }
        />
        <datalist id="product-list">
          {PRODUCTS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <div className="draft-table">
          <div className="draft-row draft-head">
            <span>#</span><span>节点名称</span><span>烟花型号</span><span>点位</span>
            <span>段落</span><span>目标拍号</span><span>点火时刻</span><span>吸附预览 / 问题</span><span></span>
          </div>
          {drafts.map((d, i) => (
            <DraftRowView
              key={i}
              row={i + 1}
              draft={d}
              codes={conflictRows.get(i + 1)}
              active={activeRow === i + 1}
              refCb={(el) => { rowRefs.current[i] = el; }}
              onChange={(patch) => updateRow(i, patch)}
              onBeat={(b) => changeTargetBeat(i, b)}
              onRemove={() => removeRow(i)}
              onFocus={() => setActiveRow(i + 1)}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelTitle
          title="当前已保存编排（只读）"
          subtitle={
            show.savedAt
              ? `上次保存：${new Date(show.savedAt).toLocaleString("zh-CN")} · 数据仅存本机浏览器 localStorage`
              : "尚未保存，当前展示内置示例 · 数据仅存本机浏览器 localStorage"
          }
          right={<button onClick={handleResetPreset}>恢复内置示例</button>}
        />
        <div className="cue-list">
          {show.nodes.map((n, i) => {
            const seg = segmentOfBeat(snapToBeat(n.time));
            return (
              <button
                key={n.id}
                className={`cue ${selectedId === n.id ? "selected" : ""} ${firingNow.has(n.id) ? "firing" : ""}`}
                onClick={() => setSelectedId(n.id)}
              >
                <span className="cue-idx">{String(i + 1).padStart(2, "0")}</span>
                <span className="cue-time">{formatClock(n.time)}</span>
                <span className="cue-beat">第 {snapToBeat(n.time)} 拍</span>
                <span className="cue-label">{n.label}</span>
                <span className="cue-product">{n.product}</span>
                <span className="cue-pad" style={{ color: PADS[n.padId].color }}>
                  {n.padId}
                </span>
                <span className="cue-seg" style={{ color: seg?.color }}>{seg?.name}</span>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function conflictLabel(code: string): string {
  if (code === "beat-deviation") return "拍号偏离";
  if (code === "segment-range") return "越出段落";
  return "间隔不足 1s";
}

/* ---------------- 子组件 ---------------- */

function PanelTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="panel-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

function Banner({
  state,
  savedAt,
}: {
  state:
    | { kind: "idle" }
    | { kind: "rejected"; count: number }
    | { kind: "accepted"; count: number; savedAt: string };
  savedAt: string;
}) {
  if (state.kind === "rejected") {
    return (
      <div className="banner reject">
        <b>整批拒绝</b>
        <span>
          共 {state.count} 处冲突，本次 {state.count} 发登记全部未落盘，时间轴与点位图保持原编排。
          可在登记表修正后重新提交。
        </span>
      </div>
    );
  }
  if (state.kind === "accepted") {
    return (
      <div className="banner accept">
        <b>保存成功</b>
        <span>
          {state.count} 发节点已吸附拍点并写入本机浏览器（{new Date(savedAt).toLocaleTimeString("zh-CN")}），
          时间轴、点位图与冲突清单已同步。
        </span>
      </div>
    );
  }
  return null;
}

function Timeline({
  nodes,
  selectedId,
  onSelect,
  playhead,
  playing,
  firingNow,
}: {
  nodes: FiringNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  playhead: number;
  playing: boolean;
  firingNow: Set<string>;
}) {
  const pct = (t: number) => (t / TOTAL_DURATION) * 100;
  return (
    <div className="timeline-scroll">
      <div className="timeline">
        <div className="tl-segments">
          {SEGMENT_ORDER.map((id) => {
            const s = SEGMENTS[id];
            const left = pct(beatToTime(s.startBeat));
            const width = pct(beatToTime(s.endBeat) + BEAT_DURATION);
            return (
              <div
                key={id}
                className="tl-seg"
                style={{ left: `${left}%`, width: `${width - left}%`, borderColor: s.color, color: s.color }}
              >
                {s.name}
                <small>
                  第 {s.startBeat}–{s.endBeat} 拍 · {beatToTime(s.startBeat).toFixed(1)}–
                  {beatToTime(s.endBeat + 1).toFixed(1)}s
                </small>
              </div>
            );
          })}
        </div>

        {PAD_ORDER.map((padId) => (
          <div className="tl-lane" key={padId}>
            <div className="lane-label" style={{ color: PADS[padId].color }}>{padId}</div>
            <div className="lane-track">
              {Array.from({ length: TOTAL_BEATS + 1 }, (_, i) => (
                <i
                  key={i}
                  className={i % 2 === 0 ? "tick second" : "tick"}
                  style={{ left: `${pct(beatToTime(i + 1))}%` }}
                />
              ))}
              {Array.from({ length: TOTAL_DURATION / 2 + 1 }, (_, i) => (
                <em key={i} className="sec-label" style={{ left: `${pct(i * 2)}%` }}>
                  {i * 2}s
                </em>
              ))}
              {nodes
                .filter((n) => n.padId === padId)
                .map((n) => (
                  <button
                    key={n.id}
                    title={`${n.label} · ${n.product} · ${formatClock(n.time)}（第 ${snapToBeat(n.time)} 拍）`}
                    className={`marker ${selectedId === n.id ? "selected" : ""} ${firingNow.has(n.id) ? "firing" : ""}`}
                    style={{ left: `${pct(n.time)}%`, borderColor: PADS[padId].color }}
                    onClick={() => onSelect(n.id)}
                  />
                ))}
            </div>
          </div>
        ))}

        <div className={"playhead" + (playing ? " playing" : "")} style={{ left: `${pct(playhead)}%` }}>
          <span>{formatClock(playhead)}</span>
        </div>
      </div>
    </div>
  );
}

function PadMap({
  nodes,
  selectedId,
  onSelect,
  firingNow,
}: {
  nodes: FiringNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  firingNow: Set<string>;
}) {
  return (
    <div className="padmap">
      <div className="river" />
      {PAD_ORDER.map((id) => {
        const pad = PADS[id];
        const cues = nodes.filter((n) => n.padId === id);
        return (
          <div className="pad" key={id} style={{ left: `${pad.x}%`, top: `${pad.y}%` }}>
            <div className="pad-dot" style={{ background: pad.color }}>
              <span>{id}</span>
            </div>
            <div className="pad-card">
              <b style={{ color: pad.color }}>{pad.name}</b>
              {cues.length === 0 && <small>本点位暂无节点</small>}
              {cues.map((n) => (
                <button
                  key={n.id}
                  className={
                    "pad-cue" +
                    (selectedId === n.id ? " selected" : "") +
                    (firingNow.has(n.id) ? " firing" : "")
                  }
                  style={{ borderColor: pad.color }}
                  onClick={() => onSelect(n.id)}
                >
                  <em>{formatClock(n.time)}</em>
                  {n.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DraftRowView({
  row,
  draft,
  codes,
  active,
  refCb,
  onChange,
  onBeat,
  onRemove,
  onFocus,
}: {
  row: number;
  draft: DraftNode;
  codes?: Set<string>;
  active: boolean;
  refCb: (el: HTMLDivElement | null) => void;
  onChange: (patch: Partial<DraftNode>) => void;
  onBeat: (beat: number) => void;
  onRemove: () => void;
  onFocus: () => void;
}) {
  const parsed = parseTimeInput(draft.timeInput);
  let snap: { beat: number; time: number } | null = null;
  if (parsed !== null) {
    const beat = snapToBeat(parsed);
    snap = { beat, time: beatToTime(beat) };
  }
  const deviation = snap ? Math.abs(snap.beat - draft.targetBeat) : null;
  const inSegment =
    snap && draft.segmentId
      ? snap.beat >= SEGMENTS[draft.segmentId as SegmentId].startBeat &&
        snap.beat <= SEGMENTS[draft.segmentId as SegmentId].endBeat
      : true;

  return (
    <div
      ref={refCb}
      className={
        "draft-row" +
        (codes && codes.size ? " has-conflict" : "") +
        (active ? " active" : "")
      }
      onFocus={onFocus}
    >
      <span className="row-no">{row}</span>
      <input value={draft.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="节点名称" />
      <input
        value={draft.product}
        onChange={(e) => onChange({ product: e.target.value })}
        list="product-list"
        placeholder="烟花型号"
      />
      <select value={draft.padId} onChange={(e) => onChange({ padId: e.target.value as PadId })}>
        {PAD_ORDER.map((p) => (
          <option key={p} value={p}>{p} {PADS[p].name.split(" · ")[1]}</option>
        ))}
      </select>
      <select
        value={draft.segmentId}
        onChange={(e) => onChange({ segmentId: e.target.value as SegmentId })}
      >
        {SEGMENT_ORDER.map((id) => (
          <option key={id} value={id}>
            {SEGMENTS[id].name}（{SEGMENTS[id].startBeat}–{SEGMENTS[id].endBeat}拍）
          </option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        max={TOTAL_BEATS}
        value={draft.targetBeat}
        onChange={(e) => onBeat(Number(e.target.value))}
        title="修改目标拍号会把时刻对齐到该拍，随后可再手动微调时刻"
      />
      <input
        className="time-input"
        value={draft.timeInput}
        onChange={(e) => onChange({ timeInput: e.target.value })}
        placeholder="如 9.5 或 00:09.5"
      />
      <span className={"snap-preview" + (codes && codes.size ? " bad" : "")}>
        {snap === null ? (
          <em>时刻无法解析</em>
        ) : (
          <>
            吸附到 {snap.time.toFixed(1)}s · 第 {snap.beat} 拍
            {deviation !== null && deviation > 0 && (
              <em className={deviation > 1 ? "bad" : ""}> · 偏离目标 {deviation} 拍</em>
            )}
            {!inSegment && <em className="bad"> · 不在所选段落</em>}
          </>
        )}
      </span>
      <button className="del" onClick={onRemove} title="删除这一发">✕</button>
    </div>
  );
}
