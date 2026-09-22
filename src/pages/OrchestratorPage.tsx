import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  BEAT_SECONDS,
  Conflict,
  IgnitionDraft,
  IgnitionNode,
  POSITIONS,
  PRODUCTS,
  PreparedNode,
  SEGMENTS,
  TOTAL_BEATS,
  ValidateResult,
  beatToTime,
  formatTime,
  getSegment,
  parseTime,
  segmentAtBeat,
  snapTimeToBeat,
  validateBatch,
} from "../lib/schedule";
import { addNodes, clearNodes, loadNodes, removeNode, storageSummary } from "../lib/storage";

/* ------------------------------ 小工具 ------------------------------ */

let draftSeq = 0;
function newDraft(partial?: Partial<IgnitionDraft>): IgnitionDraft {
  draftSeq += 1;
  return {
    clientId: `d${Date.now().toString(36)}${draftSeq}`,
    segmentId: SEGMENTS[0].id,
    positionId: "P1",
    productName: "罗马烛光 30 发",
    targetBeatInput: "0",
    timeInput: "0",
    angleInput: "90",
    durationInput: "2",
    ...partial,
  };
}

const CONFLICT_LABEL: Record<Conflict["code"], string> = {
  BAD_FIELD: "字段无法解析",
  UNKNOWN_REF: "引用不存在",
  BEAT_OUT_OF_RANGE: "越出配乐网格",
  DRIFT_TOO_FAR: "吸附后偏离超过一拍",
  OUT_OF_SEGMENT: "越出段落区间",
  SPACING_TIGHT: "同点位间隔不足 1 秒",
};

const TIMELINE_PAD_LEFT = 64;
const BEAT_W = 8; // 每拍 8px，全场 121 拍 ≈ 968px
const TIMELINE_W = TIMELINE_PAD_LEFT + TOTAL_BEATS * BEAT_W;
const LANE_H = 52;
const PREVIEW_SPEED = 4; // 预览加速 4 倍

function beatX(beat: number): number {
  return TIMELINE_PAD_LEFT + beat * BEAT_W;
}

/* ============================== 主页面 ============================== */

export default function OrchestratorPage() {
  const [nodes, setNodes] = useState<IgnitionNode[]>([]);
  const [drafts, setDrafts] = useState<IgnitionDraft[]>([newDraft()]);
  const [submitState, setSubmitState] = useState<
    | { kind: "rejected"; conflicts: Conflict[] }
    | { kind: "accepted"; prepared: PreparedNode[] }
    | null
  >(null);
  const [highlightDraft, setHighlightDraft] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);

  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setNodes(loadNodes());
  }, []);

  // 编辑后清除上一次提交结论，冲突清单本身走实时校验，始终同步
  useEffect(() => {
    setSubmitState(null);
  }, [drafts]);

  // 实时校验（保存时复用同一结果）：吸附 + 全部规则
  const live: ValidateResult = useMemo(
    () => validateBatch(drafts, nodes),
    [drafts, nodes],
  );

  const pendingConflicts: Conflict[] = live.ok ? [] : live.conflicts;
  const shownConflicts = submitState?.kind === "rejected" ? submitState.conflicts : pendingConflicts;

  function patchDraft(clientId: string, patch: Partial<IgnitionDraft>) {
    setDrafts((ds) => ds.map((d) => (d.clientId === clientId ? { ...d, ...patch } : d)));
  }

  function focusRow(clientId: string) {
    setHighlightDraft(clientId);
    rowRefs.current.get(clientId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setHighlightDraft(null), 1600);
  }

  /* 保存：先吸附再判定；不通过则整批拒绝，既有编排不动 */
  function handleSave() {
    if (live.ok) {
      const next = addNodes(live.prepared, nodes);
      setNodes(next);
      setSubmitState({ kind: "accepted", prepared: live.prepared });
      setDrafts([newDraft()]);
    } else {
      setSubmitState({ kind: "rejected", conflicts: live.conflicts });
      const first = live.conflicts[0]?.draftIds[0];
      if (first) focusRow(first);
    }
  }

  function handleDeleteNode(id: string) {
    setNodes((cur) => removeNode(id, cur));
  }

  function handleClearAll() {
    if (nodes.length === 0) return;
    if (window.confirm("确定清空本地全部点火节点？此操作只影响本机浏览器数据。")) {
      setNodes(clearNodes());
    }
  }

  function togglePreview() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setPlayhead(null);
      return;
    }
    const startFrom = playhead !== null && playhead < beatToTime(TOTAL_BEATS) ? playhead : 0;
    const startedAt = performance.now();
    setPlayhead(startFrom);
    const tick = (now: number) => {
      const t = startFrom + ((now - startedAt) / 1000) * PREVIEW_SPEED;
      if (t >= beatToTime(TOTAL_BEATS)) {
        setPlayhead(beatToTime(TOTAL_BEATS));
        rafRef.current = null;
        return;
      }
      setPlayhead(t);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const committedByPosition = useMemo(() => {
    const map = new Map<string, IgnitionNode[]>();
    for (const n of nodes) {
      const arr = map.get(n.positionId) ?? [];
      arr.push(n);
      map.set(n.positionId, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.beat - b.beat);
    return map;
  }, [nodes]);

  const stats = useMemo(() => {
    const usedProducts = new Set(nodes.map((n) => n.productName));
    return {
      nodes: nodes.length,
      positions: POSITIONS.length,
      products: usedProducts.size,
      conflicts: pendingConflicts.length,
    };
  }, [nodes, pendingConflicts.length]);

  return (
    <main className="orch">
      <header className="topbar">
        <div>
          <p className="eyebrow">FIREWORKS CUE CONSOLE · 本地数据 · {BEAT_SECONDS * 1000}ms/拍</p>
          <h1>烟花燃放编排台</h1>
          <p className="sub">
            三段节目 / 四个点位 / 半秒一拍配乐网格；保存前时刻自动吸附最近拍点，
            偏差超一拍、越段或同点位移间隔不足 1 秒将整批拒绝。
          </p>
        </div>
        <div className="stat-grid">
          <Stat label="节目段落" value={SEGMENTS.length} />
          <Stat label="点火节点" value={stats.nodes} accent />
          <Stat label="冲突条目" value={stats.conflicts} danger={stats.conflicts > 0} />
          <Stat label="弹种在用" value={stats.products} />
        </div>
      </header>

      {submitState?.kind === "accepted" && (
        <div className="banner ok">
          <b>✓ 整批登记成功（{submitState.prepared.length} 发），已写入本地。</b>
          <span>
            {submitState.prepared
              .map((p) => `${p.positionId} ${formatTime(p.time)}（目标第${p.targetBeat}拍）`)
              .join("　")}
          </span>
        </div>
      )}
      {submitState?.kind === "rejected" && (
        <div className="banner bad">
          <b>✗ 整批拒绝：{submitState.conflicts.length} 项冲突，原编排未做任何改动。</b>
          <span>请按下方冲突清单修正登记行后重新提交。</span>
        </div>
      )}

      <section className="panel">
        <PanelHead
          kick="TIMELINE"
          title="配乐时间轴"
          desc="色块为三段节目，四道泳道对应四个点位；◆ 为已编排节点，◇ 为待保存行吸附后的位置，琥珀色小竖线是输入的原始时刻。"
          right={
            <button className="btn" onClick={togglePreview}>
              {playhead === null ? "▶ 整场预览（4×加速）" : "■ 停止预览"}
            </button>
          }
        />
        <Timeline
          nodes={nodes}
          drafts={drafts}
          prepared={live.prepared}
          conflicts={pendingConflicts}
          playhead={playhead}
        />
      </section>

      <div className="two-col">
        <section className="panel">
          <PanelHead
            kick="SITE MAP"
            title="燃放点位平面图"
            desc="方块为四个点位，数字为已编排发数；预览时正在点火的点位会亮起。"
          />
          <SiteMap committedByPosition={committedByPosition} playhead={playhead} />
        </section>

        <section className="panel">
          <PanelHead
            kick="CONFLICTS"
            title="冲突清单"
            desc={
              shownConflicts.length === 0
                ? "当前登记行实时校验通过，可以保存。"
                : `实时校验发现 ${shownConflicts.length} 项问题，点击条目可定位到登记行。`
            }
          />
          <ConflictList
            conflicts={shownConflicts}
            drafts={drafts}
            nodes={nodes}
            onFocus={focusRow}
          />
        </section>
      </div>

      <section className="panel">
        <PanelHead
          kick="REGISTRATION"
          title="点火节点登记"
          desc="登记目标拍号与点火时刻（支持秒数 12.4 或 00:12.5）；保存时时刻先吸附到最近拍点，再对整批做统一校验。"
          right={
            <div className="btn-row">
              <button className="btn" onClick={() => setDrafts((ds) => [...ds, newDraft()])}>
                ＋ 添加一发
              </button>
              <button className="btn primary" onClick={handleSave}>
                保存整批（吸附后校验）
              </button>
            </div>
          }
        />
        <div className="draft-list">
          {drafts.map((d, i) => (
            <DraftRow
              key={d.clientId}
              index={i}
              draft={d}
              nodes={nodes}
              conflicts={pendingConflicts.filter((c) => c.draftIds.includes(d.clientId))}
              onChange={(patch) => patchDraft(d.clientId, patch)}
              onRemove={
                drafts.length > 1
                  ? () => setDrafts((ds) => ds.filter((x) => x.clientId !== d.clientId))
                  : undefined
              }
              registerRef={(el) => {
                if (el) rowRefs.current.set(d.clientId, el);
                else rowRefs.current.delete(d.clientId);
              }}
              highlighted={highlightDraft === d.clientId}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelHead
          kick="COMMITTED"
          title="已编排点火节点"
          desc={`共 ${nodes.length} 发，按点火时刻排序；删除即时写入本地。`}
          right={
            <button className="btn danger-ghost" onClick={handleClearAll} disabled={nodes.length === 0}>
              清空本地编排
            </button>
          }
        />
        <NodeTable nodes={nodes} onDelete={handleDeleteNode} />
      </section>

      <footer className="footer">{storageSummary(nodes)} · 数据不离开本机浏览器</footer>
    </main>
  );
}

/* ------------------------------ 通用小组件 ------------------------------ */

function Stat({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: number;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className={`stat ${accent ? "accent" : ""} ${danger ? "danger" : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function PanelHead({
  kick,
  title,
  desc,
  right,
}: {
  kick: string;
  title: string;
  desc: string;
  right?: ReactNode;
}) {
  return (
    <div className="panel-head">
      <div>
        <p className="eyebrow">{kick}</p>
        <h2>{title}</h2>
        <p className="desc">{desc}</p>
      </div>
      {right}
    </div>
  );
}

/* ------------------------------ 时间轴 ------------------------------ */

function Timeline({
  nodes,
  drafts,
  prepared,
  conflicts,
  playhead,
}: {
  nodes: IgnitionNode[];
  drafts: IgnitionDraft[];
  prepared: PreparedNode[];
  conflicts: Conflict[];
  playhead: number | null;
}) {
  const badDraftIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) c.draftIds.forEach((id) => s.add(id));
    return s;
  }, [conflicts]);

  const seconds = Array.from({ length: TOTAL_BEATS / 2 + 1 }, (_, i) => i);

  return (
    <div className="timeline-scroll">
      <div className="timeline" style={{ width: TIMELINE_W }}>
        {/* 段落色带 */}
        {SEGMENTS.map((s) => (
          <div
            key={s.id}
            className="seg-band"
            style={{
              left: beatX(s.startBeat),
              width: (s.endBeat - s.startBeat + 1) * BEAT_W,
              background: `linear-gradient(180deg, ${s.color}22, ${s.color}0c)`,
              borderTop: `2px solid ${s.color}`,
            }}
            title={`${s.name}：第 ${s.startBeat}–${s.endBeat} 拍（${formatTime(
              beatToTime(s.startBeat),
            )} – ${formatTime(beatToTime(s.endBeat))}）· ${s.mood}`}
          >
            <span style={{ color: s.color }}>
              {s.name} · {s.mood}
            </span>
          </div>
        ))}

        {/* 网格与秒刻度 */}
        {seconds.map((sec) => (
          <div key={sec} className="grid-line" style={{ left: beatX(sec * 2) }}>
            <small>{sec}s</small>
          </div>
        ))}
        {Array.from({ length: TOTAL_BEATS }, (_, b) => (
          <div key={b} className="half-beat" style={{ left: beatX(b + 0.5) }} />
        ))}

        {/* 点位泳道 */}
        {POSITIONS.map((p, laneIdx) => {
          const laneNodes = nodes.filter((n) => n.positionId === p.id);
          const lanePending = prepared.filter((q) => q.positionId === p.id);
          return (
            <div
              key={p.id}
              data-lane={p.id}
              className="lane"
              style={{ top: 30 + laneIdx * LANE_H, height: LANE_H }}
            >
              <div className="lane-label">
                <b>{p.id}</b>
                <small>{p.name.split(" · ")[1] ?? p.name}</small>
              </div>
              {laneNodes.map((n) => {
                const seg = getSegment(n.segmentId);
                const firing =
                  playhead !== null && Math.abs(beatToTime(n.beat) - playhead) < 0.22;
                return (
                  <div
                    key={n.id}
                    className={`marker committed ${firing ? "firing" : ""}`}
                    style={{
                      left: beatX(n.beat),
                      background: seg?.color ?? "#4f8cff",
                      borderColor: seg?.color ?? "#4f8cff",
                    }}
                    title={`${p.id} · ${n.productName}
点火 ${formatTime(beatToTime(n.beat))}（第 ${n.beat} 拍，登记目标第 ${n.targetBeat} 拍）
原始输入 ${formatTime(n.rawTime)} · 仰角 ${n.angleDeg}° · 持续 ${n.durationSec}s`}
                  />
                );
              })}
              {lanePending.map((q) => {
                const draft = drafts.find((d) => d.clientId === q.clientId);
                const raw = parseTime(draft?.timeInput ?? "");
                const seg = getSegment(q.segmentId);
                const bad = badDraftIds.has(q.clientId);
                return (
                  <div key={q.clientId} className="pending-wrap" style={{ left: beatX(q.beat) }}>
                    {raw !== null && raw >= 0 && raw <= beatToTime(TOTAL_BEATS) && (
                      <div
                        className="raw-tick"
                        style={{ left: ((raw - q.time) / BEAT_SECONDS) * BEAT_W }}
                        title={`原始输入时刻 ${formatTime(raw)}`}
                      />
                    )}
                    <div
                      className={`marker pending ${bad ? "bad" : ""}`}
                      style={{ borderColor: bad ? "#e0453a" : seg?.color }}
                      title={`待保存：吸附到第 ${q.beat} 拍（${formatTime(q.time)}），偏离目标 ${q.driftBeats.toFixed(1)} 拍`}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}

        {playhead !== null && (
          <div
            className="playhead"
            style={{ left: TIMELINE_PAD_LEFT + (playhead / BEAT_SECONDS) * BEAT_W }}
          >
            <div className="playhead-line" />
            <small>{formatTime(playhead)}</small>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ 点位图 ------------------------------ */

function SiteMap({
  committedByPosition,
  playhead,
}: {
  committedByPosition: Map<string, IgnitionNode[]>;
  playhead: number | null;
}) {
  return (
    <div className="sitemap">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="site-svg">
        <rect x="0" y="0" width="100" height="100" rx="2" className="map-bg" />
        <path d="M0,66 C20,62 30,70 50,66 C70,62 82,70 100,66 L100,100 L0,100 Z" className="river" />
        <text x="6" y="92" className="map-text">
          水域
        </text>
        <rect x="30" y="92" width="40" height="5" rx="1" className="audience" />
        <text x="50" y="89.5" textAnchor="middle" className="map-text dark">
          观众区
        </text>
      </svg>
      {POSITIONS.map((p) => {
        const list = committedByPosition.get(p.id) ?? [];
        const firingNow =
          playhead !== null && list.some((n) => Math.abs(beatToTime(n.beat) - playhead) < 0.22);
        const next = playhead === null ? list[0] : list.find((n) => beatToTime(n.beat) >= playhead);
        return (
          <button
            key={p.id}
            className={`site-point ${firingNow ? "firing" : ""}`}
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            onClick={() =>
              document
                .querySelector(`[data-lane="${p.id}"]`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
            }
            title={`${p.name} · 安全距离 ${p.safetyMeters}m · ${p.note}`}
          >
            <span className="dot" />
            <b>{p.id}</b>
            <small>
              {list.length} 发{next ? ` · 下一发 ${formatTime(beatToTime(next.beat))}` : ""}
            </small>
            <em>{p.safetyMeters}m</em>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------ 冲突清单 ------------------------------ */

function ConflictList({
  conflicts,
  drafts,
  nodes,
  onFocus,
}: {
  conflicts: Conflict[];
  drafts: IgnitionDraft[];
  nodes: IgnitionNode[];
  onFocus: (clientId: string) => void;
}) {
  if (conflicts.length === 0) {
    return (
      <div className="conflict-empty">
        <span className="ok-dot" /> 无冲突。保存前仍会再次执行同样的整批校验。
      </div>
    );
  }
  const order: Conflict["code"][] = [
    "DRIFT_TOO_FAR",
    "OUT_OF_SEGMENT",
    "SPACING_TIGHT",
    "BEAT_OUT_OF_RANGE",
    "BAD_FIELD",
    "UNKNOWN_REF",
  ];
  const sorted = [...conflicts].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  return (
    <ul className="conflict-list">
      {sorted.map((c, i) => {
        const rowIdx = c.draftIds
          .map((id) => drafts.findIndex((d) => d.clientId === id) + 1)
          .filter((n) => n > 0);
        const nodeNames = c.nodeIds
          .map((id) => nodes.find((n) => n.id === id))
          .filter((n): n is IgnitionNode => Boolean(n))
          .map((n) => `${n.positionId} ${formatTime(beatToTime(n.beat))}`);
        return (
          <li key={`${c.code}-${i}`}>
            <button
              className="conflict-item"
              onClick={() => c.draftIds[0] && onFocus(c.draftIds[0])}
            >
              <span className={`tag tag-${c.code}`}>{CONFLICT_LABEL[c.code]}</span>
              <span className="conflict-msg">{c.message}</span>
              <span className="conflict-ref">
                {rowIdx.length > 0 && `登记行 ${rowIdx.join("、")}`}
                {rowIdx.length > 0 && nodeNames.length > 0 && "；"}
                {nodeNames.length > 0 && `触及已编排：${nodeNames.join("、")}`}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------ 登记行 ------------------------------ */

function DraftRow({
  index,
  draft,
  nodes,
  conflicts,
  onChange,
  onRemove,
  registerRef,
  highlighted,
}: {
  index: number;
  draft: IgnitionDraft;
  nodes: IgnitionNode[];
  conflicts: Conflict[];
  onChange: (patch: Partial<IgnitionDraft>) => void;
  onRemove?: () => void;
  registerRef: (el: HTMLDivElement | null) => void;
  highlighted: boolean;
}) {
  const targetBeat = Number(draft.targetBeatInput);
  const rawTime = parseTime(draft.timeInput);
  const snappedBeat = rawTime === null ? null : snapTimeToBeat(rawTime);
  const targetSeg = getSegment(draft.segmentId);
  const beatSeg = Number.isInteger(targetBeat) ? segmentAtBeat(targetBeat) : undefined;
  const product = PRODUCTS.find((p) => p.name === draft.productName);
  const position = POSITIONS.find((p) => p.id === draft.positionId);

  const productBlocked =
    product && position && product.allowedPositions.length > 0
      ? !product.allowedPositions.includes(position.id)
      : false;

  return (
    <div
      ref={registerRef}
      className={`draft-row ${conflicts.length > 0 ? "has-conflict" : ""} ${
        highlighted ? "highlight" : ""
      }`}
    >
      <div className="draft-no">
        <b>#{index + 1}</b>
        {snappedBeat !== null && (
          <small className={conflicts.length > 0 ? "bad-text" : "ok-text"}>
            吸附 → 第 {snappedBeat} 拍
            <br />
            {formatTime(beatToTime(snappedBeat))}
          </small>
        )}
      </div>

      <label className="f-seg">
        <span>节目段落</span>
        <select
          value={draft.segmentId}
          onChange={(e) => onChange({ segmentId: e.target.value })}
        >
          {SEGMENTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}（{s.startBeat}–{s.endBeat}拍）
            </option>
          ))}
        </select>
      </label>

      <label className="f-pos">
        <span>点位</span>
        <select
          value={draft.positionId}
          onChange={(e) => onChange({ positionId: e.target.value })}
        >
          {POSITIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="f-prod">
        <span>烟花型号</span>
        <select
          value={draft.productName}
          onChange={(e) => onChange({ productName: e.target.value })}
        >
          {PRODUCTS.map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}（{p.caliber}）
            </option>
          ))}
        </select>
        {productBlocked && <small className="warn-text">该型号限 {product?.allowedPositions.join("/")} 位使用</small>}
      </label>

      <label className="f-beat">
        <span>目标拍号</span>
        <input
          type="number"
          min={0}
          max={TOTAL_BEATS}
          step={1}
          value={draft.targetBeatInput}
          onChange={(e) => onChange({ targetBeatInput: e.target.value })}
        />
        {Number.isInteger(targetBeat) && (
          <small className={beatSeg && beatSeg.id === draft.segmentId ? "ok-text" : "warn-text"}>
            {formatTime(beatToTime(targetBeat))}
            {beatSeg ? ` · 属「${beatSeg.name}」` : " · 网格外"}
            {beatSeg && targetSeg && beatSeg.id !== targetSeg.id && "（与所选段落不一致）"}
          </small>
        )}
      </label>

      <label className="f-time">
        <span>点火时刻（秒或 mm:ss.f）</span>
        <input
          placeholder="如 8.6 或 00:08.5"
          value={draft.timeInput}
          onChange={(e) => onChange({ timeInput: e.target.value })}
        />
        {rawTime !== null && snappedBeat !== null && (
          <small className={conflicts.some((c) => c.code === "DRIFT_TOO_FAR") ? "bad-text" : "ok-text"}>
            原始 {formatTime(rawTime)} → 最近拍点 {formatTime(beatToTime(snappedBeat))}，偏离{" "}
            {Math.abs(snappedBeat - (Number.isInteger(targetBeat) ? targetBeat : snappedBeat)).toFixed(1)} 拍
          </small>
        )}
      </label>

      <label className="f-angle">
        <span>仰角°</span>
        <input
          type="number"
          min={0}
          max={180}
          value={draft.angleInput}
          onChange={(e) => onChange({ angleInput: e.target.value })}
        />
      </label>

      <label className="f-dur">
        <span>持续 s</span>
        <input
          type="number"
          min={0.5}
          step={0.5}
          value={draft.durationInput}
          onChange={(e) => onChange({ durationInput: e.target.value })}
        />
      </label>

      <div className="f-actions">
        {conflicts.length > 0 && (
          <small className="bad-text" title={conflicts.map((c) => c.message).join("\n")}>
            {conflicts.length} 项冲突
          </small>
        )}
        {onRemove && (
          <button className="btn mini" onClick={onRemove} aria-label="移除该行">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ 已编排表 ------------------------------ */

function NodeTable({ nodes, onDelete }: { nodes: IgnitionNode[]; onDelete: (id: string) => void }) {
  const [refSeg, setRefSeg] = useState<string>("all");
  const [refPos, setRefPos] = useState<string>("all");
  const rows = nodes.filter(
    (n) =>
      (refSeg === "all" || n.segmentId === refSeg) &&
      (refPos === "all" || n.positionId === refPos),
  );

  return (
    <div className="node-table-wrap">
      <div className="table-filters">
        <select value={refSeg} onChange={(e) => setRefSeg(e.target.value)}>
          <option value="all">全部段落</option>
          {SEGMENTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={refPos} onChange={(e) => setRefPos(e.target.value)}>
          <option value="all">全部点位</option>
          {POSITIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} {p.name}
            </option>
          ))}
        </select>
        <span className="muted">共 {rows.length} 发</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted empty-hint">暂无已编排节点，在上方登记后保存。</p>
      ) : (
        <table className="node-table">
          <thead>
            <tr>
              <th>点火时刻</th>
              <th>拍号</th>
              <th>段落</th>
              <th>点位</th>
              <th>型号</th>
              <th>目标拍</th>
              <th>吸附偏差</th>
              <th>仰角/持续</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const seg = getSegment(n.segmentId);
              const drift = Math.abs(n.beat - n.targetBeat);
              return (
                <tr key={n.id}>
                  <td>
                    <b>{formatTime(beatToTime(n.beat))}</b>
                    <small className="muted"> 原始 {formatTime(n.rawTime)}</small>
                  </td>
                  <td>{n.beat}</td>
                  <td>
                    <span className="seg-chip" style={{ color: seg?.color, borderColor: seg?.color }}>
                      {seg?.name}
                    </span>
                  </td>
                  <td>{n.positionId}</td>
                  <td>{n.productName}</td>
                  <td>{n.targetBeat}</td>
                  <td className={drift > 0 ? "warn-text" : "ok-text"}>
                    {drift.toFixed(1)} 拍
                  </td>
                  <td>
                    {n.angleDeg}° / {n.durationSec}s
                  </td>
                  <td>
                    <button className="btn mini danger-ghost" onClick={() => onDelete(n.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
