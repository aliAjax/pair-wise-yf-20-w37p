/**
 * 本地存储模块
 *
 * 数据只存浏览器 localStorage，不发任何网络请求。
 * 首次打开载入一场内置示例编排；保存通过判定后整体替换。
 */

import type { FiringNode } from "./validation";

const STORAGE_KEY = "fireworks-console:show:v1";

export interface StoredShow {
  version: 1;
  savedAt: string;
  nodes: FiringNode[];
}

/** 首次进入时的内置示例：9 发，分布在三段节目、四个点位上，全部合规 */
export function presetNodes(): FiringNode[] {
  const rows: Array<[string, string, FiringNode["padId"], FiringNode["segmentId"], number, number]> = [
    // label, product, pad, segment, targetBeat, time
    ["河面初光", "75mm 礼花弹", "P1", "overture", 2, 0.5],
    ["西岸冷焰", "冷焰火喷泉", "P4", "overture", 8, 3.5],
    ["东岸扇形", "30mm 扇形架", "P2", "chorusA", 20, 9.5],
    ["南岸烛光", "罗马烛光 ×6", "P3", "chorusA", 26, 12.5],
    ["北岸再响", "100mm 礼花弹", "P1", "chorusA", 34, 16.5],
    ["栈桥金柳", "120mm 礼花弹", "P2", "finale", 44, 21.5],
    ["驳船银闪", "闪雷组合盆", "P4", "finale", 48, 23.5],
    ["平台连珠", "罗马烛光 ×12", "P3", "finale", 54, 26.5],
    ["高台收官", "150mm 礼花弹", "P1", "finale", 58, 28.5],
  ];
  return rows.map(([label, product, padId, segmentId, targetBeat, time], i) => ({
    id: `preset-${i + 1}`,
    label,
    product,
    padId,
    segmentId,
    targetBeat,
    time,
  }));
}

export function loadShow(): StoredShow {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as StoredShow;
      if (data && data.version === 1 && Array.isArray(data.nodes)) {
        return data;
      }
    }
  } catch {
    // 存储损坏时静默回落到内置示例，不阻塞页面
  }
  return {
    version: 1,
    savedAt: "",
    nodes: presetNodes(),
  };
}

/** 整批替换当前编排；调用方必须已通过 validateBatch。 */
export function saveShow(nodes: FiringNode[]): StoredShow {
  const data: StoredShow = {
    version: 1,
    savedAt: new Date().toISOString(),
    nodes,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

export function clearShow(): StoredShow {
  localStorage.removeItem(STORAGE_KEY);
  return { version: 1, savedAt: "", nodes: presetNodes() };
}
