/**
 * storage.ts —— 本地存储业务
 *
 * 数据只存本地（localStorage），不发任何网络请求。
 * 负责：已登记节点的读取、整批追加、删除、清空，以及读取时的结构兜底。
 */

import {
  BEAT_SECONDS,
  IgnitionNode,
  PreparedNode,
  SEGMENTS,
  POSITIONS,
  makeNodeId,
} from "./schedule";

const STORAGE_KEY = "fireworks-orchestration:nodes:v1";

/** 首次进入时的预置编排（key 不存在才写入；用户清空后保持为空，不再补种） */
const SEED_NODES: IgnitionNode[] = [
  { id: "seed-1", segmentId: "seg-prelude", positionId: "P1", productName: "罗马烛光 30 发", targetBeat: 4, beat: 4, rawTime: 2, angleDeg: 90, durationSec: 3 },
  { id: "seed-2", segmentId: "seg-prelude", positionId: "P2", productName: "罗马烛光 30 发", targetBeat: 4, beat: 4, rawTime: 2, angleDeg: 90, durationSec: 3 },
  { id: "seed-3", segmentId: "seg-prelude", positionId: "P3", productName: "75mm 礼花弹", targetBeat: 20, beat: 20, rawTime: 10.1, angleDeg: 88, durationSec: 4 },
  { id: "seed-4", segmentId: "seg-rising", positionId: "P4", productName: "冷焰火瀑布", targetBeat: 36, beat: 36, rawTime: 18, angleDeg: 90, durationSec: 6 },
  { id: "seed-5", segmentId: "seg-rising", positionId: "P1", productName: "30mm 扇形架", targetBeat: 44, beat: 44, rawTime: 22, angleDeg: 75, durationSec: 4 },
  { id: "seed-6", segmentId: "seg-finale", positionId: "P2", productName: "30mm 扇形架", targetBeat: 68, beat: 68, rawTime: 34.1, angleDeg: 75, durationSec: 5 },
  { id: "seed-7", segmentId: "seg-finale", positionId: "P3", productName: "75mm 礼花弹", targetBeat: 96, beat: 96, rawTime: 48, angleDeg: 90, durationSec: 5 },
  { id: "seed-8", segmentId: "seg-finale", positionId: "P4", productName: "冷焰火瀑布", targetBeat: 100, beat: 100, rawTime: 50, angleDeg: 90, durationSec: 8 },
];

function isValidNode(v: unknown): v is IgnitionNode {
  if (typeof v !== "object" || v === null) return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.segmentId === "string" &&
    SEGMENTS.some((s) => s.id === n.segmentId) &&
    typeof n.positionId === "string" &&
    POSITIONS.some((p) => p.id === n.positionId) &&
    typeof n.productName === "string" &&
    typeof n.targetBeat === "number" &&
    Number.isFinite(n.targetBeat) &&
    typeof n.beat === "number" &&
    Number.isFinite(n.beat) &&
    typeof n.rawTime === "number" &&
    Number.isFinite(n.rawTime) &&
    typeof n.angleDeg === "number" &&
    typeof n.durationSec === "number"
  );
}

/** 读取本地编排；首次访问写入预置示例；数据损坏时返回空数组（不抛错，保证页面可用） */
export function loadNodes(): IgnitionNode[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      persist(SEED_NODES);
      return [...SEED_NODES].sort((a, b) => a.beat - b.beat);
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidNode).sort((a, b) => a.beat - b.beat);
  } catch {
    return [];
  }
}

function persist(nodes: IgnitionNode[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
}

/**
 * 把一批已通过判定的登记落库。
 * 注意：调用方必须先经 validateBatch 校验通过；本函数只负责存储，
 * 采用“先构造完整新数组、再一次性写入”的方式，失败不会留下半截数据。
 */
export function addNodes(prepared: PreparedNode[], existing: IgnitionNode[]): IgnitionNode[] {
  const incoming: IgnitionNode[] = prepared.map((p) => ({
    id: makeNodeId(),
    segmentId: p.segmentId,
    positionId: p.positionId,
    productName: p.productName,
    targetBeat: p.targetBeat,
    beat: p.beat,
    rawTime: p.rawTime,
    angleDeg: p.angleDeg,
    durationSec: p.durationSec,
  }));
  const next = [...existing, ...incoming].sort((a, b) => a.beat - b.beat);
  persist(next);
  return next;
}

export function removeNode(id: string, existing: IgnitionNode[]): IgnitionNode[] {
  const next = existing.filter((n) => n.id !== id);
  persist(next);
  return next;
}

export function clearNodes(): IgnitionNode[] {
  persist([]);
  return [];
}

/** 本地存储占用概览（页脚展示，证明数据只在本地） */
export function storageSummary(nodes: IgnitionNode[]): string {
  const bytes = new Blob([JSON.stringify(nodes)]).size;
  return `localStorage · ${nodes.length} 个点火节点 · 约 ${bytes} 字节 · 节拍 ${BEAT_SECONDS}s`;
}
