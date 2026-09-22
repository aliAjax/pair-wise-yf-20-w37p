/**
 * 点火节点判定模块
 *
 * 保存流程：
 *   1. 每一发先把「登记时刻」吸附到最近拍点（0.5s 网格）；
 *   2. 用吸附后的时刻逐发做三类校验；
 *   3. 任一发出错 → 整批拒绝（all-or-nothing），原编排保持不动；
 *   4. 全部通过 → 返回吸附后的新一批节点，交给存储层落盘。
 *
 * 三类冲突：
 *   - beat-deviation：吸附拍点偏离登记的目标拍号超过一拍（> 1 拍，即 > 0.5s）；
 *   - segment-range ：点火拍点越出所选段落的拍号区间；
 *   - pad-gap       ：同一新批次内部，同点位相邻两发间隔不足一秒（< 1s）。
 */

import {
  BEAT_DURATION,
  PADS,
  SEGMENTS,
  type PadId,
  type SegmentId,
  beatToTime,
  parseTimeInput,
  segmentOfBeat,
  snapToBeat,
  timeToBeat,
} from "./grid";

export interface FiringNode {
  id: string;
  label: string;
  product: string;
  padId: PadId;
  segmentId: SegmentId;
  /** 编排师登记的目标拍号（1 起） */
  targetBeat: number;
  /** 经吸附确认的点火时刻（秒，必落在 0.5s 网格上） */
  time: number;
}

/** 表单里尚未判定的一发（时刻是原始输入，秒） */
export interface DraftNode {
  label: string;
  product: string;
  padId: PadId;
  segmentId: SegmentId;
  targetBeat: number;
  timeInput: string;
}

export type ConflictCode = "beat-deviation" | "segment-range" | "pad-gap";

export interface Conflict {
  code: ConflictCode;
  /** 批次内序号（从 1 起，对应表单行号） */
  row: number;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  conflicts: Conflict[];
  /** 校验通过时的吸附结果；失败时为 null，调用方必须整批丢弃 */
  accepted: FiringNode[] | null;
}

/** 同点位最小安全间隔（秒） */
export const MIN_PAD_GAP = 1;

/** 允许偏离目标拍号的最大拍数：超过一拍即拒绝 */
export const MAX_BEAT_DEVIATION = 1;

function makeId(): string {
  return `fire-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface SnappedRow {
  row: number;
  draft: DraftNode;
  snappedBeat: number;
  snappedTime: number;
  deviation: number; // |吸附拍号 - 目标拍号|
}

/**
 * 校验一整批登记。已有节点不参与新批次判定——新批次通过后会整体替换
 * 当前编排（本工具一次保存一场节目），因此只需对批次内部做间隔校验。
 */
export function validateBatch(drafts: DraftNode[]): ValidationResult {
  const conflicts: Conflict[] = [];

  if (drafts.length === 0) {
    return { ok: false, conflicts: [{ code: "segment-range", row: 0, message: "批次为空：至少登记一发再保存。" }], accepted: null };
  }

  // ---- 第 1 步：逐发吸附 ----
  const rows: SnappedRow[] = drafts.map((draft, index) => {
    const row = index + 1;
    const parsed = parseTimeInput(draft.timeInput);
    if (parsed === null) {
      conflicts.push({
        code: "beat-deviation",
        row,
        message: `第 ${row} 发：时刻「${draft.timeInput || "空"}」无法解析，请填秒数（如 12.5）或 mm:ss.f。`,
      });
      // 占位，后续跳过该发的拍点校验
      return { row, draft, snappedBeat: NaN, snappedTime: NaN, deviation: Infinity };
    }
    const snappedBeat = snapToBeat(parsed);
    const snappedTime = beatToTime(snappedBeat);
    return {
      row,
      draft,
      snappedBeat,
      snappedTime,
      deviation: Math.abs(snappedBeat - draft.targetBeat),
    };
  });

  // ---- 第 2 步：拍号偏离 & 段落区间 ----
  for (const r of rows) {
    if (!Number.isFinite(r.snappedBeat)) continue;
    const { draft, snappedBeat, snappedTime, deviation } = r;
    const clock = `${snappedTime.toFixed(1)}s（第 ${snappedBeat} 拍）`;

    if (deviation > MAX_BEAT_DEVIATION) {
      conflicts.push({
        code: "beat-deviation",
        row: r.row,
        message: `第 ${r.row} 发「${draft.label || draft.product}」：吸附到 ${clock}，偏离目标第 ${draft.targetBeat} 拍 ${deviation} 拍，超过 ${MAX_BEAT_DEVIATION} 拍。`,
      });
    }

    const seg = SEGMENTS[draft.segmentId];
    if (snappedBeat < seg.startBeat || snappedBeat > seg.endBeat) {
      conflicts.push({
        code: "segment-range",
        row: r.row,
        message: `第 ${r.row} 发「${draft.label || draft.product}」：${clock} 越出段落「${seg.name}」区间（第 ${seg.startBeat}–${seg.endBeat} 拍）。`,
      });
    }
  }

  // ---- 第 3 步：同点位间隔（按点位分组、按时刻排序后两两比较） ----
  const byPad = new Map<PadId, SnappedRow[]>();
  for (const r of rows) {
    if (!Number.isFinite(r.snappedBeat)) continue;
    const list = byPad.get(r.draft.padId) ?? [];
    list.push(r);
    byPad.set(r.draft.padId, list);
  }
  for (const [padId, list] of byPad) {
    list.sort((a, b) => a.snappedTime - b.snappedTime || a.row - b.row);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      const gap = cur.snappedTime - prev.snappedTime;
      if (gap < MIN_PAD_GAP) {
        conflicts.push({
          code: "pad-gap",
          row: cur.row,
          message: `第 ${cur.row} 发「${cur.draft.label || cur.draft.product}」：点位 ${padId}（${PADS[padId].name}）与第 ${prev.row} 发仅隔 ${gap.toFixed(1)}s，不足 ${MIN_PAD_GAP}s。`,
        });
      }
    }
  }

  if (conflicts.length > 0) {
    // 整批拒绝：不返回任何吸附结果，调用方保留原编排
    return { ok: false, conflicts, accepted: null };
  }

  const accepted: FiringNode[] = rows.map((r) => ({
    id: makeId(),
    label: r.draft.label.trim(),
    product: r.draft.product.trim(),
    padId: r.draft.padId,
    segmentId: r.draft.segmentId,
    targetBeat: r.draft.targetBeat,
    time: Number(r.snappedTime.toFixed(3)),
  }));
  accepted.sort((a, b) => a.time - b.time);

  return { ok: true, conflicts: [], accepted };
}

export function actualSegmentOf(node: FiringNode) {
  return segmentOfBeat(Math.round(timeToBeat(node.time)));
}
