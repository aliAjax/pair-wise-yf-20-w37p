/**
 * 配乐网格与节目基础数据
 *
 * 整首配乐按「每半秒一拍」切分：拍号从 1 开始，第 1 拍对齐 0.0s。
 * 三段节目首尾相接，四个点位固定在场地坐标系中。
 */

export const BEAT_DURATION = 0.5; // 一拍 0.5 秒
export const FIRST_BEAT = 1;

export type SegmentId = "overture" | "chorusA" | "finale";
export type PadId = "P1" | "P2" | "P3" | "P4";

export interface Segment {
  id: SegmentId;
  name: string;
  /** 该段落覆盖的拍号区间（闭区间） */
  startBeat: number;
  endBeat: number;
  color: string;
  note: string;
}

export interface Pad {
  id: PadId;
  name: string;
  /** 场地平面图上的百分比坐标 */
  x: number;
  y: number;
  color: string;
}

/** 三段预置节目：序曲 0–8s、齐奏 8–20s、终章 20–30s */
export const SEGMENTS: Record<SegmentId, Segment> = {
  overture: {
    id: "overture",
    name: "序曲 · 河面初光",
    startBeat: 1,
    endBeat: 16,
    color: "#3b82f6",
    note: "低空铺底，单点位轮放",
  },
  chorusA: {
    id: "chorusA",
    name: "齐奏 · 两岸呼应",
    startBeat: 17,
    endBeat: 40,
    color: "#f59e0b",
    note: "四点位交替齐射",
  },
  finale: {
    id: "finale",
    name: "终章 · 漫天金雨",
    startBeat: 41,
    endBeat: 60,
    color: "#ef4444",
    note: "高潮连放，注意间隔",
  },
};

export const SEGMENT_ORDER: SegmentId[] = ["overture", "chorusA", "finale"];

/** 四个预置燃放点位（百分比坐标，平面图左上角为 0,0） */
export const PADS: Record<PadId, Pad> = {
  P1: { id: "P1", name: "P1 · 北岸高台", x: 18, y: 24, color: "#22d3ee" },
  P2: { id: "P2", name: "P2 · 东岸栈桥", x: 80, y: 30, color: "#a78bfa" },
  P3: { id: "P3", name: "P3 · 南岸平台", x: 72, y: 78, color: "#34d399" },
  P4: { id: "P4", name: "P4 · 西岸驳船", x: 24, y: 70, color: "#fb7185" },
};

export const PAD_ORDER: PadId[] = ["P1", "P2", "P3", "P4"];

export const TOTAL_BEATS = SEGMENTS.finale.endBeat;
export const TOTAL_DURATION = beatToTime(TOTAL_BEATS + 1); // 30s（最后一拍之后）

/** 拍号 → 时刻（秒）。第 1 拍为 0s，之后每拍 +0.5s */
export function beatToTime(beat: number): number {
  return (beat - FIRST_BEAT) * BEAT_DURATION;
}

/** 时刻（秒）→ 拍号（实数，未取整） */
export function timeToBeat(time: number): number {
  return FIRST_BEAT + time / BEAT_DURATION;
}

/** 把时刻吸附到最近拍点，返回拍号；结果限制在整首配乐范围内 */
export function snapToBeat(time: number): number {
  const rawBeat = timeToBeat(time);
  const snapped = Math.round(rawBeat);
  return Math.min(TOTAL_BEATS, Math.max(FIRST_BEAT, snapped));
}

/** 时刻（秒）→ mm:ss.f（一位小数表示半拍），例如 12.5 → "00:12.5" */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = safe - m * 60;
  const whole = Math.floor(s);
  const tenth = Math.round((s - whole) * 10);
  return `${String(m).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${tenth}`;
}

/**
 * 解析点火时刻输入。支持 "12.5" / "12,5"（秒）和 "00:12.5" / "1:12" 两种写法。
 * 非法输入返回 null，交由判定模块报错。
 */
export function parseTimeInput(raw: string): number | null {
  const text = raw.trim().replace("，", ",").replace(/秒$/, "");
  if (text === "") return null;
  let value: number;
  if (text.includes(":")) {
    const parts = text.split(":");
    if (parts.length !== 2) return null;
    const m = Number(parts[0]);
    const s = Number(parts[1].replace(",", "."));
    if (!Number.isFinite(m) || !Number.isFinite(s) || m < 0 || s < 0) return null;
    value = m * 60 + s;
  } else {
    value = Number(text.replace(",", "."));
  }
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** 拍号落在哪一段；落在段落接缝之外返回 null */
export function segmentOfBeat(beat: number): Segment | null {
  for (const id of SEGMENT_ORDER) {
    const seg = SEGMENTS[id];
    if (beat >= seg.startBeat && beat <= seg.endBeat) return seg;
  }
  return null;
}
