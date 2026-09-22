import { validateBatch, type DraftNode } from "../src/fireworks/validation";
import { snapToBeat, parseTimeInput, beatToTime } from "../src/fireworks/grid";
import { loadShow, saveShow, presetNodes } from "../src/fireworks/storage";

let failures = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name} ${extra}`);
  }
}

// 网格工具
check("snap 12.6 -> 拍 26 (12.5s)", snapToBeat(12.6) === 26 && beatToTime(26) === 12.5);
check("snap 12.75 -> 拍 27", snapToBeat(12.75) === 27);
check("parse mm:ss.f", parseTimeInput("00:12.5") === 12.5);
check("parse 秒数逗号", parseTimeInput("12,5") === 12.5);
check("parse 非法", parseTimeInput("abc") === null);

const base = (patch: Partial<DraftNode>): DraftNode => ({
  label: "测试",
  product: "75mm 礼花弹",
  padId: "P1",
  segmentId: "chorusA",
  targetBeat: 20,
  timeInput: "9.5",
  ...patch,
});

// 1) 合规批次
let r = validateBatch([
  base({}),
  base({ padId: "P2", targetBeat: 22, timeInput: "10.5" }),
  base({ padId: "P1", targetBeat: 24, timeInput: "11.5" }), // 同点位间隔 2s
]);
check("合规批次通过", r.ok && r.accepted !== null && r.accepted.length === 3);

// 2) 拍号偏离：目标 20 拍(9.5s)，时刻 11.0s -> 吸附拍 23，偏离 3 拍
r = validateBatch([base({ targetBeat: 20, timeInput: "11.0" })]);
check(
  "偏离超过一拍被拒",
  !r.ok && r.conflicts.some((c) => c.code === "beat-deviation") && r.accepted === null,
  JSON.stringify(r.conflicts),
);

// 恰好偏离一拍：目标 20，时刻 10.0 -> 拍 22，偏离 2 拍？ 20->22 = 2 拍，换一个
// 目标 20，时刻 10.0 = 拍 22，偏差 2。改用时刻 9.0 -> 拍 19，偏差 1，边界应通过
r = validateBatch([base({ targetBeat: 20, timeInput: "9.0", segmentId: "chorusA" })]);
check("恰好偏离一拍（=1）不拒", r.ok, JSON.stringify(r.conflicts));

// 时刻 8.6 -> 吸附 8.5 拍 18，偏离 2 拍 → 拒
r = validateBatch([base({ targetBeat: 20, timeInput: "8.6" })]);
check("吸附后偏离 2 拍被拒", !r.ok && r.conflicts.some((c) => c.code === "beat-deviation"));

// 3) 越出段落：登记在序曲(1-16 拍)，时刻 9.5s -> 拍 20
r = validateBatch([base({ segmentId: "overture", targetBeat: 20, timeInput: "9.5" })]);
check(
  "越出段落被拒",
  !r.ok && r.conflicts.some((c) => c.code === "segment-range"),
  JSON.stringify(r.conflicts),
);

// 4) 同点位间隔不足 1s：吸附到同一拍（间隔 0）与相邻拍（0.5s）
r = validateBatch([
  base({ targetBeat: 20, timeInput: "9.5", padId: "P3" }),
  base({ targetBeat: 21, timeInput: "10.0", padId: "P3" }),
]);
check(
  "同点位 0.5s 间隔被拒",
  !r.ok && r.conflicts.some((c) => c.code === "pad-gap"),
  JSON.stringify(r.conflicts),
);

// 间隔恰好 1s（两拍）应通过
r = validateBatch([
  base({ targetBeat: 20, timeInput: "9.5", padId: "P3" }),
  base({ targetBeat: 22, timeInput: "10.5", padId: "P3" }),
]);
check("同点位恰好 1s 通过", r.ok, JSON.stringify(r.conflicts));

// 不同点位 0.5s 间隔不冲突
r = validateBatch([
  base({ targetBeat: 20, timeInput: "9.5", padId: "P3" }),
  base({ targetBeat: 21, timeInput: "10.0", padId: "P4" }),
]);
check("不同点位 0.5s 不冲突", r.ok, JSON.stringify(r.conflicts));

// 5) 整批拒绝：一发坏，好的一发也不能被接受
r = validateBatch([
  base({ targetBeat: 20, timeInput: "9.5", padId: "P1" }),
  base({ targetBeat: 38, timeInput: "21.5", padId: "P2", segmentId: "chorusA" }), // 拍 44 落在终章，越出齐奏段
]);
check("一批中一发坏 -> accepted 为 null", !r.ok && r.accepted === null && r.conflicts.length >= 1);

// 6) 非法时刻输入
r = validateBatch([base({ timeInput: "九点五" })]);
check("非法时刻被拒", !r.ok && r.conflicts[0]?.code === "beat-deviation");

// 7) 空批次
check("空批次被拒", !validateBatch([]).ok);

// 8) 存储：localStorage shim
class LS {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
(globalThis as Record<string, unknown>).localStorage = new LS();
const initial = loadShow();
check("首次载入为内置示例 9 发", initial.nodes.length === 9);

const valid = validateBatch([
  base({ targetBeat: 20, timeInput: "9.5" }),
]);
check("存储前判定通过", valid.ok && valid.accepted !== null);
if (valid.accepted) {
  saveShow(valid.accepted);
  const again = loadShow();
  check("保存后可读回且数量一致", again.nodes.length === valid.accepted.length);
}
check("presetNodes 全部落在各自段落", presetNodes().every((n) => {
  const seg = n.segmentId === "overture" ? [1, 16] : n.segmentId === "chorusA" ? [17, 40] : [41, 60];
  const beat = Math.round(n.time / 0.5) + 1;
  return beat >= seg[0] && beat <= seg[1];
}));

console.log(failures === 0 ? "\n全部测试通过" : `\n${failures} 个失败`);
process.exit(failures === 0 ? 0 : 1);
