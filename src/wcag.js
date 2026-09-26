'use strict';

// WCAG 2.x 相对亮度与对比度（sRGB）
// 参考: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance

/**
 * 规范化并校验 #RRGGBB 颜色，返回 { r, g, b }（0-255）。
 * 非法值抛错（错误信息面向最终用户）。
 */
function parseHex(value) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error('颜色必须是 #RRGGBB 形式（如 #1A2B3C）');
  }
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  };
}

function channelLuminance(c) {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/** 相对亮度 L = 0.2126 R + 0.7152 G + 0.0722 B */
function relativeLuminance(hex) {
  const { r, g, b } = parseHex(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** 对比度 (L1 + 0.05) / (L2 + 0.05)，结果 >= 1 */
function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

module.exports = { parseHex, relativeLuminance, contrastRatio };
