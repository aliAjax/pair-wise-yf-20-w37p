/**
 * schedule.ts —— 编排判定业务（纯逻辑，无 React、无浏览器存储依赖）
 *
 * 职责：
 * 1. 预置三段节目、四个点位、半秒一拍的配乐网格常量
 * 2. 时刻 <-> 拍号换算、时刻向最近拍点吸附
 * 3. 登记批次的统一校验（整批通过 / 整批拒绝）
 */

export const BEAT_SECONDS = 0.5; // 每半秒一拍
export const TOTAL_BEATS = 120; // 0..120，共 60.0 秒

/** 节目段落（区间均为闭区间，单位：拍号） */
export interface Segment {
  id: string;
  name: string;
  /** 音乐情绪标记，用于时间轴展示 */
  mood: string;
  startBeat: number;
  endBeat: number;
  /** 段落主题色（时间轴 / 清单共用） */
  color: string;
}

/** 燃放点位（点位图按百分比坐标摆放） */
export interface Position {
  id: string;
  name: string;
  /** 平面图位置（百分比） */
  x: number;
  y: number;
  /** 与观众的安全距离（米） */
  safetyMeters: number;
  note: string;
}

export const SEGMENTS: Segment[] = [
  {
    id: "seg-prelude",
    name: "序幕·星落",
    mood: "舒缓 · 弦乐铺底",
    startBeat: 0,
    endBeat: 31,
    color: "#4f8cff",
  },
  {
    id: "seg-rising",
    name: "中篇·涌潮",
    mood: "渐强 · 鼓点进入",
    startBeat: 32,
    endBeat: 63,
    color: "#f59e0b",
  },
  {
    id: "seg-finale",
    name: "终章·满天红",
    mood: "快板 · 齐奏高潮",
    startBeat: 64,
    endBeat: 120,
    color: "#e0453a",
  },
];

export const POSITIONS: Position[] = [
  { id: "P1", name: "一号位 · 东岸", x: 16, y: 70, safetyMeters: 35, note: "临水区，顺风向" },
  { id: "P2", name: "二号位 · 西岸", x: 84, y: 70, safetyMeters: 35, note: "临水区，顺风向" },
  { id: "P3", name: "三号位 · 中央高台", x: 50, y: 30, safetyMeters: 60, note: "大口径礼花专位" },
  { id: "P4", name: "四号位 · 前场扇形架", x: 50, y: 78, safetyMeters: 25, note: "近景区，仅限冷焰火" },
];

/** 烟花型号（型号清单） */
export interface Product {
  id: string;
  name: string;
  caliber: string;
  /** 允许使用的点位，空数组表示全部点位可用 */
  allowedPositions: string[];
  /** 最低安全距离（米） */
  minSafetyMeters: number;
}

export const PRODUCTS: Product[] = [
  { id: "k01", name: "75mm 礼花弹", caliber: "75mm", allowedPositions: ["P3"], minSafetyMeters: 60 },
  { id: "k02", name: "罗马烛光 30 发", caliber: "38mm", allowedPositions: ["P1", "P2"], minSafetyMeters: 35 },
  { id: "k03", name: "30mm 扇形架", caliber: "30mm", allowedPositions: ["P1", "P2", "P4"], minSafetyMeters: 25 },
  { id: "k04", name: "冷焰火瀑布", caliber: "—", allowedPositions: [], minSafetyMeters: 15 },
];

/** 已登记的点火节点（“原编排”，保存成功后才会变化） */
export interface IgnitionNode {
  id: string;
  segmentId: string;
  positionId: string;
  productName: string;
  /** 登记的目标拍号 */
  targetBeat: number;
  /** 吸附到最近拍点后的实际点火时刻（秒），始终是 0.5 的整数倍 */
  beat: number;
  /** 登记时填写的原始时刻（秒），保留以便审计偏差 */
  rawTime: number;
  angleDeg: number;
  durationSec: number;
}

/** 登记行输入（表单草稿），时刻用字符串承载便于解析 00:12.500 这类写法 */
export interface IgnitionDraft {
  clientId: string;
  segmentId: string;
  positionId: string;
  productName: string;
  targetBeatInput: string;
  timeInput: string;
  angleInput: string;
  durationInput: string;
}

export type ConflictCode =
  | "BAD_FIELD" // 表单字段无法解析
  | "UNKNOWN_REF" // 段落 / 点位不存在
  | "BEAT_OUT_OF_RANGE" // 目标拍号越出整场网格
  | "DRIFT_TOO_FAR" // 吸附后偏离目标拍号超过一拍
  | "OUT_OF_SEGMENT" // 吸附后越出所属段落区间
  | "SPACING_TIGHT"; // 与同点位上一发间隔不足一秒

export interface Conflict {
  code: ConflictCode;
  /** 涉及的草稿行 clientId（BAD_FIELD 等行级问题）；跨行为 spacing 时两行都列出 */
  draftIds: string[];
  /** 涉及的既有节点 id（spacing 命中既有编排时出现） */
  nodeIds: string[];
  message: string;
}

export interface PreparedNode {
  clientId: string;
  segmentId: string;
  positionId: string;
  productName: string;
  targetBeat: number;
  rawTime: number;
  beat: number;
  time: number;
  angleDeg: number;
  durationSec: number;
  driftBeats: number;
}

export interface ValidateResult {
  ok: boolean;
  conflicts: Conflict[];
  /** 仅 ok 时有值：通过校验、可落库的节点（吸附后） */
  prepared: PreparedNode[];
}

/* ------------------------------ 基础换算 ------------------------------ */

export function beatToTime(beat: number): number {
  return beat * BEAT_SECONDS;
}

/** 把任意秒数吸附到最近拍点，返回拍号 */
export function snapTimeToBeat(timeSec: number): number {
  return Math.round(timeSec / BEAT_SECONDS);
}

/** mm:ss.fff 或纯秒数 -> 秒；非法返回 null */
export function parseTime(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  let value: number;
  if (t.includes(":")) {
    const m = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(t);
    if (!m) return null;
    value = Number(m[1]) * 60 + Number(m[2]);
  } else {
    value = Number(t);
  }
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** 秒 -> mm:ss.d（d 为拍内 0/5，即整拍显示 .0/.5） */
export function formatTime(timeSec: number): string {
  const total = Math.max(0, timeSec);
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

export function getSegment(segmentId: string): Segment | undefined {
  return SEGMENTS.find((s) => s.id === segmentId);
}

export function getPosition(positionId: string): Position | undefined {
  return POSITIONS.find((p) => p.id === positionId);
}

/** 拍号落在哪个段落（闭区间归属，先到先得：相邻段落边界归后段） */
export function segmentAtBeat(beat: number): Segment | undefined {
  return SEGMENTS.find((s, i) => {
    const start = i === 0 ? s.startBeat : s.startBeat;
    return beat >= start && beat <= s.endBeat;
  });
}

let idCounter = 0;
export function makeNodeId(): string {
  idCounter += 1;
  return `n${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/* ------------------------------ 批次校验 ------------------------------ */

function pushConflict(list: Conflict[], c: Conflict) {
  list.push(c);
}

/**
 * 校验一整批登记草稿。
 * 规则（任一不满足即整批拒绝，既有编排保持不动）：
 *  - 字段可解析、段落/点位存在
 *  - 目标拍号在整场网格内
 *  - 时刻吸附到最近拍点后，偏离目标拍号不得超过一拍（>1.0 拍拒绝，恰好 1.0 拍放行）
 *  - 吸附时刻必须落在所属段落闭区间内
 *  - 同一点位任意两发（含与既有节点）间隔不得少于 1 秒（<1.0s 拒绝）
 */
export function validateBatch(drafts: IgnitionDraft[], existing: IgnitionNode[]): ValidateResult {
  const conflicts: Conflict[] = [];
  const prepared: PreparedNode[] = [];

  // 1) 逐行解析与吸附
  for (const d of drafts) {
    const segment = getSegment(d.segmentId);
    const position = getPosition(d.positionId);

    const targetBeat = Number(d.targetBeatInput);
    const rawTime = parseTime(d.timeInput);
    const angle = d.angleInput.trim() === "" ? 90 : Number(d.angleInput);
    const duration = d.durationInput.trim() === "" ? 2 : Number(d.durationInput);

    if (!Number.isFinite(targetBeat) || targetBeat < 0 || !Number.isInteger(targetBeat)) {
      pushConflict(conflicts, {
        code: "BAD_FIELD",
        draftIds: [d.clientId],
        nodeIds: [],
        message: `目标拍号必须是 ≥ 0 的整数（当前为“${d.targetBeatInput || "空"}”）`,
      });
      continue;
    }
    if (rawTime === null) {
      pushConflict(conflicts, {
        code: "BAD_FIELD",
        draftIds: [d.clientId],
        nodeIds: [],
        message: `点火时刻无法识别：“${d.timeInput || "空"}”，请填秒数（如 12.4）或 mm:ss.f`,
      });
      continue;
    }
    if (!Number.isFinite(angle) || angle < 0 || angle > 180) {
      pushConflict(conflicts, {
        code: "BAD_FIELD",
        draftIds: [d.clientId],
        nodeIds: [],
        message: `发射角度需在 0–180° 之间（当前为“${d.angleInput || "空"}”）`,
      });
      continue;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      pushConflict(conflicts, {
        code: "BAD_FIELD",
        draftIds: [d.clientId],
        nodeIds: [],
        message: `持续时间需为正数秒（当前为“${d.durationInput || "空"}”）`,
      });
      continue;
    }
    if (!segment) {
      pushConflict(conflicts, {
        code: "UNKNOWN_REF",
        draftIds: [d.clientId],
        nodeIds: [],
        message: `引用的段落不存在：${d.segmentId}`,
      });
      continue;
    }
    if (!position) {
      pushConflict(conflicts, {
        code: "UNKNOWN_REF",
        draftIds: [d.clientId],
        nodeIds: [],
        message: `引用的点位不存在：${d.positionId}`,
      });
      continue;
    }
    if (targetBeat < 0 || targetBeat > TOTAL_BEATS) {
      pushConflict(conflicts, {
        code: "BEAT_OUT_OF_RANGE",
        draftIds: [d.clientId],
        nodeIds: [],
        message: `目标拍号 ${targetBeat} 越出配乐网格（0–${TOTAL_BEATS}）`,
      });
      continue;
    }

    const beat = snapTimeToBeat(rawTime);
    const time = beatToTime(beat);
    const driftBeats = Math.abs(beat - targetBeat);

    if (driftBeats > 1) {
      pushConflict(conflicts, {
        code: "DRIFT_TOO_FAR",
        draftIds: [d.clientId],
        nodeIds: [],
        message: `${position.id} 位登记拍号 ${targetBeat}（${formatTime(
          beatToTime(targetBeat),
        )}），时刻 ${formatTime(rawTime)} 吸附到 ${formatTime(time)}（第 ${beat} 拍），偏离 ${
          driftBeats.toFixed(1)} 拍，超过一拍`,
      });
    }
    if (beat < segment.startBeat || beat > segment.endBeat) {
      pushConflict(conflicts, {
        code: "OUT_OF_SEGMENT",
        draftIds: [d.clientId],
        nodeIds: [],
        message: `吸附时刻 ${formatTime(time)}（第 ${beat} 拍）越出段落「${segment.name}」区间（第 ${
          segment.startBeat}–${segment.endBeat} 拍）`,
      });
    }
    if (beat < 0 || beat > TOTAL_BEATS) {
      pushConflict(conflicts, {
        code: "BEAT_OUT_OF_RANGE",
        draftIds: [d.clientId],
        nodeIds: [],
        message: `吸附时刻 ${formatTime(time)} 越出整场配乐网格`,
      });
    }

    prepared.push({
      clientId: d.clientId,
      segmentId: segment.id,
      positionId: position.id,
      productName: d.productName.trim() || "未命名弹种",
      targetBeat,
      rawTime,
      beat,
      time,
      angleDeg: angle,
      durationSec: duration,
      driftBeats,
    });
  }

  // 2) 同点位最小间隔：新-新 与 新-旧 都要查；旧-旧属于既有编排，不在本次登记范围内
  const spacingSec = 2 * BEAT_SECONDS; // 1 秒 = 2 拍

  const byPosition = new Map<string, PreparedNode[]>();
  for (const p of prepared) {
    const arr = byPosition.get(p.positionId) ?? [];
    arr.push(p);
    byPosition.set(p.positionId, arr);
  }
  for (const arr of byPosition.values()) {
    arr.sort((a, b) => a.beat - b.beat);
    for (let i = 1; i < arr.length; i += 1) {
      const gap = (arr[i].beat - arr[i - 1].beat) * BEAT_SECONDS;
      if (gap < spacingSec) {
        pushConflict(conflicts, {
          code: "SPACING_TIGHT",
          draftIds: [arr[i - 1].clientId, arr[i].clientId],
          nodeIds: [],
          message: `${arr[i].positionId} 位相邻两发间隔仅 ${gap.toFixed(1)} 秒（${formatTime(
            arr[i - 1].time)} 与 ${formatTime(arr[i].time)}），不足 1 秒`,
        });
      }
    }
  }

  for (const pnode of prepared) {
    for (const node of existing) {
      if (node.positionId !== pnode.positionId) continue;
      const gap = Math.abs(node.beat - pnode.beat) * BEAT_SECONDS;
      if (gap < spacingSec) {
        pushConflict(conflicts, {
          code: "SPACING_TIGHT",
          draftIds: [pnode.clientId],
          nodeIds: [node.id],
          message: `${pnode.positionId} 位新发 ${formatTime(pnode.time)} 与已编排的 ${formatTime(
            beatToTime(node.beat))}（${node.productName}）间隔仅 ${gap.toFixed(1)} 秒，不足 1 秒`,
        });
      }
    }
  }

  return { ok: conflicts.length === 0, conflicts, prepared: conflicts.length === 0 ? prepared : [] };
}
