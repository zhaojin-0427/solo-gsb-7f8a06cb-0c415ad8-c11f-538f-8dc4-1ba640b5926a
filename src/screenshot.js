'use strict';

// 截图配色核查：本地截图像素与本次选中色值的 ΔE76 偏离统计
//
// 规则：
//   - 图片在浏览器内解码（不上传），保持宽高比把最长边缩至 MAX_SIDE 像素
//     （最长边不足 MAX_SIDE 时不放大，按原尺寸统计）；
//   - 仅统计完全不透明（alpha = 255）的像素；
//   - 像素与色板色值都转换到 D65 CIE Lab，逐像素取最近色的 ΔE76；
//   - 未舍入距离 > 容差（TOLERANCE_MIN～TOLERANCE_MAX）判为偏离，等于容差不判。
//
// 本文件同时以 CommonJS（Node 测试）和浏览器全局 ScreenshotAudit 方式使用，
// 颜色转换复用 colorvision.js（与色觉审查同一份 D65 Lab 实现）。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./colorvision'));
  } else {
    root.ScreenshotAudit = factory(root.ColorVision);
  }
}(typeof self !== 'undefined' ? self : this, function (ColorVision) {
  'use strict';

  const MAX_SIDE = 256; // 缩放后最长边（像素）
  const TOLERANCE_MIN = 5;
  const TOLERANCE_MAX = 40;
  const DEFAULT_TOLERANCE = 20;

  /**
   * 保持宽高比，把最长边缩至 maxSide 像素；最长边不足 maxSide 时不放大。
   * 返回整数像素尺寸（至少 1×1）。尺寸非法时抛错。
   */
  function scaledSize(width, height, maxSide = MAX_SIDE) {
    const w = Math.floor(Number(width));
    const h = Math.floor(Number(height));
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
      throw new Error('图片尺寸非法');
    }
    const longest = Math.max(w, h);
    if (longest <= maxSide) return { width: w, height: h };
    const scale = maxSide / longest;
    return {
      width: Math.max(1, Math.round(w * scale)),
      height: Math.max(1, Math.round(h * scale)),
    };
  }

  /**
   * 按文件头魔数嗅探图片格式（与扩展名无关）。
   * @param {Uint8Array|number[]} bytes 文件起始字节（至少 4 个）
   * @returns {'png'|'jpeg'|null}
   */
  function sniffImageFormat(bytes) {
    if (!bytes || bytes.length < 4) return null;
    // PNG: 89 50 4E 47（‰PNG）
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'png';
    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpeg';
    return null;
  }

  /**
   * 逐像素计算到色板的最近 ΔE76（仅统计 alpha = 255 的完全不透明像素）。
   * @param {Uint8ClampedArray|number[]} rgba RGBA 像素序列（每像素 4 字节）
   * @param {Array<{L:number,a:number,b:number}>} paletteLabs 本次选中色值的 D65 Lab
   * @returns {{ validCount: number, distances: Float64Array }}
   *   distances 与像素一一对应（未舍入）；非完全不透明像素为 NaN
   */
  function pixelDeltaE(rgba, paletteLabs) {
    const count = Math.floor(rgba.length / 4);
    const distances = new Float64Array(count);
    let validCount = 0;
    for (let i = 0; i < count; i += 1) {
      const o = i * 4;
      if (rgba[o + 3] !== 255) {
        distances[i] = NaN;
        continue;
      }
      validCount += 1;
      const lab = ColorVision.rgbToLab(rgba[o], rgba[o + 1], rgba[o + 2]);
      let best = Infinity;
      for (let j = 0; j < paletteLabs.length; j += 1) {
        const d = ColorVision.deltaE76(lab, paletteLabs[j]);
        if (d < best) best = d;
      }
      distances[i] = best;
    }
    return { validCount, distances };
  }

  /**
   * 按容差汇总偏离情况：未舍入距离 > 容差 判为偏离（等于容差不判偏离）。
   * @param {Float64Array|number[]} distances pixelDeltaE 的输出（NaN = 无效像素）
   * @returns {{ validPixels: number, deviantPixels: number, deviationRatio: number, deviant: Uint8Array }}
   *   deviant 与像素一一对应，1 表示该有效像素偏离；无有效像素时比例为 0
   */
  function summarizeDeviation(distances, tolerance) {
    let validPixels = 0;
    let deviantPixels = 0;
    const deviant = new Uint8Array(distances.length);
    for (let i = 0; i < distances.length; i += 1) {
      const d = distances[i];
      if (Number.isNaN(d)) continue;
      validPixels += 1;
      if (d > tolerance) {
        deviantPixels += 1;
        deviant[i] = 1;
      }
    }
    return {
      validPixels,
      deviantPixels,
      deviationRatio: validPixels === 0 ? 0 : deviantPixels / validPixels,
      deviant,
    };
  }

  return {
    MAX_SIDE,
    TOLERANCE_MIN,
    TOLERANCE_MAX,
    DEFAULT_TOLERANCE,
    scaledSize,
    sniffImageFormat,
    pixelDeltaE,
    summarizeDeviation,
  };
}));
