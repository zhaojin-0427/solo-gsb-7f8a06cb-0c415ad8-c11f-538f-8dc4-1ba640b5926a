'use strict';

// 色觉模拟与 CIE Lab ΔE76 辨识风险审查
//
// 色觉模拟矩阵取自：
//   Gustavo M. Machado, Manuel M. Oliveira, Leandro A. F. Fernandes,
//   "A Physiologically-based Model for Simulation of Color Vision Deficiency",
//   IEEE Transactions on Visualization and Computer Graphics, 15(6), 2009.
// 下列为严重度 100%（protanopia / deuteranopia）矩阵，作用于【线性 sRGB】。
//
// 本文件同时以 CommonJS（Node 测试/服务端）和浏览器全局 ColorVision 方式使用。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ColorVision = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Machado 2009，Table I（线性 sRGB 空间），severity = 1.0
  const MACHADO_PROTANOPIA = [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ];
  const MACHADO_DEUTERANOPIA = [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.011820, 0.042940, 0.968881],
  ];

  const VIEWS = {
    normal: { key: 'normal', label: '正常视觉', matrix: null },
    protanopia: { key: 'protanopia', label: '红色盲', matrix: MACHADO_PROTANOPIA },
    deuteranopia: { key: 'deuteranopia', label: '绿色盲', matrix: MACHADO_DEUTERANOPIA },
  };

  // ΔE76 小于该值（未舍入）视为“易混淆”。仅为辨识风险提示阈值。
  const CONFUSABLE_THRESHOLD = 20;

  // 截图配色核查的容差（ΔE76）范围与默认值：未舍入最近距离 > 容差 视为偏离
  const AUDIT_TOLERANCE = { MIN: 5, MAX: 40, DEFAULT: 20 };

  // 线性 sRGB -> XYZ（sRGB 原色，D65）
  const RGB_TO_XYZ = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
  ];
  // CIE 标准照明体 D65
  const WHITE_D65 = [0.95047, 1.0, 1.08883];
  const LAB_DELTA = 6 / 29;
  const LAB_DELTA_3 = LAB_DELTA * LAB_DELTA * LAB_DELTA;

  function clamp01(x) {
    return x < 0 ? 0 : (x > 1 ? 1 : x);
  }

  // sRGB 传递函数：编码值 -> 线性光
  function srgbDecode(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  // 线性光 -> sRGB 编码值
  function srgbEncode(c) {
    const x = clamp01(c);
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  }

  function hexToRgb01(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
      throw new Error('颜色必须是 #RRGGBB 形式');
    }
    return [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];
  }

  function rgb01ToHex(rgb) {
    return `#${rgb.map((c) => {
      const v = Math.round(clamp01(c) * 255);
      return v.toString(16).padStart(2, '0');
    }).join('').toUpperCase()}`;
  }

  function applyMatrix(matrix, rgb) {
    return matrix.map((row) => (
      row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]
    ));
  }

  /**
   * 色觉模拟：sRGB 线性化 -> Machado 100% 矩阵 -> 裁剪 [0,1] -> 重新编码 sRGB。
   * normal 视图直接返回原色（仅做规范化为大写 #RRGGBB）。
   */
  function simulateHex(hex, view) {
    if (view === 'normal') return rgb01ToHex(hexToRgb01(hex));
    const def = VIEWS[view];
    if (!def || !def.matrix) throw new Error(`未知色觉视图：${view}`);

    const linear = hexToRgb01(hex).map(srgbDecode);
    const simulated = applyMatrix(def.matrix, linear).map(clamp01);
    return rgb01ToHex(simulated.map(srgbEncode));
  }

  function labF(t) {
    return t > LAB_DELTA_3
      ? Math.cbrt(t)
      : t / (3 * LAB_DELTA * LAB_DELTA) + 4 / 29;
  }

  /** 线性 sRGB（0-1）-> CIE Lab（白点 D65） */
  function linearRgbToLab(lin) {
    const xyz = RGB_TO_XYZ.map((row) => (
      row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]
    ));
    const fx = labF(xyz[0] / WHITE_D65[0]);
    const fy = labF(xyz[1] / WHITE_D65[1]);
    const fz = labF(xyz[2] / WHITE_D65[2]);
    return {
      L: 116 * fy - 16,
      a: 500 * (fx - fy),
      b: 200 * (fy - fz),
    };
  }

  /** sRGB 色块（#RRGGBB）-> CIE Lab（白点 D65） */
  function hexToLab(hex) {
    return linearRgbToLab(hexToRgb01(hex).map(srgbDecode));
  }

  /** 0-255 的 sRGB 通道 -> CIE Lab（白点 D65），供截图逐像素核查使用 */
  function rgbToLab(r, g, b) {
    return linearRgbToLab([r, g, b].map((v) => srgbDecode(clamp01(v / 255))));
  }

  /** CIE76 色差 ΔE*ab（欧氏距离） */
  function deltaE76(lab1, lab2) {
    return Math.sqrt(
      (lab1.L - lab2.L) ** 2
      + (lab1.a - lab2.a) ** 2
      + (lab1.b - lab2.b) ** 2,
    );
  }

  // 用未舍入距离判定，避免 19.96 显示为 20.0 却漏标的情况
  function isConfusable(distance) {
    return distance < CONFUSABLE_THRESHOLD;
  }

  function formatDistance(distance) {
    return distance.toFixed(1);
  }

  /**
   * 截图配色核查：逐像素取调色板最近色的 ΔE76，统计偏离像素。
   *
   * @param {ArrayLike<number>} pixels 连续 [r, g, b, ...]，每通道 0～255；
   *   调用方需先筛除半透明像素（本函数不处理 alpha）
   * @param {string[]} palette 本次方案选中的 #RRGGBB 色值（至少 1 个）
   * @param {number} tolerance 容差，须在 [AUDIT_TOLERANCE.MIN, AUDIT_TOLERANCE.MAX]；
   *   未舍入最近距离 > 容差 视为偏离
   * @returns {{ total: number, deviant: number, ratio: number, distances: number[] }}
   *   distances 为每个像素的未舍入最近 ΔE76（供遮罩绘制与复核）；
   *   total 为 0 时 ratio 为 0
   */
  function auditPixels(pixels, palette, tolerance) {
    if (!Array.isArray(palette) || palette.length === 0) {
      throw new Error('调色板至少需要 1 个颜色');
    }
    if (typeof tolerance !== 'number' || Number.isNaN(tolerance)
      || tolerance < AUDIT_TOLERANCE.MIN || tolerance > AUDIT_TOLERANCE.MAX) {
      throw new Error(`容差须在 ${AUDIT_TOLERANCE.MIN}～${AUDIT_TOLERANCE.MAX} 之间`);
    }
    const paletteLabs = palette.map(hexToLab);
    const total = Math.floor(pixels.length / 3);
    const distances = new Array(total);
    let deviant = 0;
    for (let i = 0; i < total; i += 1) {
      const lab = rgbToLab(pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2]);
      let nearest = Infinity;
      for (let j = 0; j < paletteLabs.length; j += 1) {
        const d = deltaE76(lab, paletteLabs[j]);
        if (d < nearest) nearest = d;
      }
      distances[i] = nearest;
      if (nearest > tolerance) deviant += 1;
    }
    return { total, deviant, ratio: total === 0 ? 0 : deviant / total, distances };
  }

  /**
   * 对求解结果中的选中颜色做指定视图的逐对辨识审查。
   * picks: [{ name, value }]（value 为求解选中的 #RRGGBB）
   * 返回 { view, items, pairs }：
   *   items: 每个颜色的原色/模拟色/Lab
   *   pairs: 全部两两配对（按距离升序），含未舍入 distance 与 confusable 标记
   */
  function pairReview(picks, view) {
    if (!VIEWS[view]) throw new Error(`未知色觉视图：${view}`);
    const items = picks.map((pick) => {
      const simulated = simulateHex(pick.value, view);
      return {
        name: pick.name,
        original: rgb01ToHex(hexToRgb01(pick.value)),
        simulated,
        lab: hexToLab(simulated),
      };
    });

    const pairs = [];
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const distance = deltaE76(items[i].lab, items[j].lab);
        pairs.push({
          a: { name: items[i].name, original: items[i].original, simulated: items[i].simulated },
          b: { name: items[j].name, original: items[j].original, simulated: items[j].simulated },
          distance,
          confusable: isConfusable(distance),
        });
      }
    }
    pairs.sort((x, y) => x.distance - y.distance);
    return { view, items, pairs };
  }

  return {
    VIEWS,
    CONFUSABLE_THRESHOLD,
    AUDIT_TOLERANCE,
    simulateHex,
    hexToLab,
    rgbToLab,
    deltaE76,
    isConfusable,
    formatDistance,
    pairReview,
    auditPixels,
  };
}));
