'use strict';

const assert = require('assert');
const cv = require('../src/colorvision');
const sa = require('../src/screenshot');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function rgbaOf(...pixels) {
  return new Uint8ClampedArray(pixels.flat());
}

// ---- 缩放规则 ----
check('最长边超过 256 时保持宽高比缩至 256', () => {
  assert.deepStrictEqual(sa.scaledSize(512, 256), { width: 256, height: 128 });
  assert.deepStrictEqual(sa.scaledSize(512, 512), { width: 256, height: 256 });
  assert.deepStrictEqual(sa.scaledSize(500, 333), { width: 256, height: 170 });
  assert.deepStrictEqual(sa.scaledSize(3, 4000), { width: 1, height: 256 });
});

check('最长边不足 256 时不放大', () => {
  assert.deepStrictEqual(sa.scaledSize(200, 100), { width: 200, height: 100 });
  assert.deepStrictEqual(sa.scaledSize(256, 256), { width: 256, height: 256 });
  assert.deepStrictEqual(sa.scaledSize(1, 1), { width: 1, height: 1 });
});

check('非法尺寸抛错', () => {
  assert.throws(() => sa.scaledSize(0, 100));
  assert.throws(() => sa.scaledSize(-5, 100));
  assert.throws(() => sa.scaledSize(NaN, 100));
});

// ---- 文件格式嗅探 ----
check('按文件头魔数识别 PNG / JPEG', () => {
  assert.strictEqual(sa.sniffImageFormat([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x1A]), 'png');
  assert.strictEqual(sa.sniffImageFormat([0xFF, 0xD8, 0xFF, 0xE0, 0x00]), 'jpeg');
  assert.strictEqual(sa.sniffImageFormat([0xFF, 0xD8, 0xFF, 0xDB]), 'jpeg');
});

check('其它格式或过短内容返回 null', () => {
  assert.strictEqual(sa.sniffImageFormat([0x47, 0x49, 0x46, 0x38]), null); // GIF
  assert.strictEqual(sa.sniffImageFormat([0x89]), null);
  assert.strictEqual(sa.sniffImageFormat([]), null);
  assert.strictEqual(sa.sniffImageFormat(null), null);
});

// ---- 逐像素最近色 ΔE76 ----
check('仅统计完全不透明（alpha = 255）的像素，其余距离为 NaN', () => {
  const rgba = rgbaOf(
    [29, 78, 216, 255],
    [29, 78, 216, 254],
    [29, 78, 216, 0],
  );
  const { validCount, distances } = sa.pixelDeltaE(rgba, [cv.hexToLab('#1D4ED8')]);
  assert.strictEqual(validCount, 1);
  assert.strictEqual(distances.length, 3);
  assert(Math.abs(distances[0]) < 1e-9);
  assert(Number.isNaN(distances[1]));
  assert(Number.isNaN(distances[2]));
});

check('逐像素取最近色的 ΔE76', () => {
  const palette = [cv.hexToLab('#FF0000'), cv.hexToLab('#0000FF')];
  const rgba = rgbaOf([0, 0, 255, 255], [254, 0, 0, 255]);
  const { validCount, distances } = sa.pixelDeltaE(rgba, palette);
  assert.strictEqual(validCount, 2);
  assert(Math.abs(distances[0]) < 1e-9); // 纯蓝精确命中色板
  assert(distances[1] < 1); // 254 红更接近红色而非蓝色
});

check('无有效像素时 validCount 为 0', () => {
  const rgba = rgbaOf([255, 0, 0, 0], [0, 255, 0, 128]);
  const { validCount } = sa.pixelDeltaE(rgba, [cv.hexToLab('#FF0000')]);
  assert.strictEqual(validCount, 0);
});

// ---- 容差汇总 ----
check('未舍入距离大于容差才判偏离（等于容差不判）', () => {
  const distances = new Float64Array([0, 19.999, 20, 20.0001, NaN]);
  const s = sa.summarizeDeviation(distances, 20);
  assert.strictEqual(s.validPixels, 4);
  assert.strictEqual(s.deviantPixels, 1);
  assert.deepStrictEqual(Array.from(s.deviant), [0, 0, 0, 1, 0]);
  assert(Math.abs(s.deviationRatio - 0.25) < 1e-12);
});

check('容差边界 5～40 内均可设定', () => {
  const distances = new Float64Array([5, 40]);
  assert.strictEqual(sa.summarizeDeviation(distances, 5).deviantPixels, 1); // 40 > 5
  assert.strictEqual(sa.summarizeDeviation(distances, 40).deviantPixels, 0); // 均不大于 40
});

check('无有效像素时偏离比例为 0', () => {
  const s = sa.summarizeDeviation(new Float64Array([NaN, NaN]), 20);
  assert.strictEqual(s.validPixels, 0);
  assert.strictEqual(s.deviantPixels, 0);
  assert.strictEqual(s.deviationRatio, 0);
});

// ---- 端到端（小图） ----
check('端到端：2×2 图像的有效像素数与偏离统计', () => {
  const palette = [cv.hexToLab('#FF0000'), cv.hexToLab('#0000FF')];
  const rgba = rgbaOf(
    [255, 0, 0, 255], // 命中色板
    [0, 0, 255, 255], // 命中色板
    [255, 255, 255, 255], // 白色，远离色板
    [0, 0, 0, 0], // 全透明，不统计
  );
  const { validCount, distances } = sa.pixelDeltaE(rgba, palette);
  assert.strictEqual(validCount, 3);
  const s = sa.summarizeDeviation(distances, sa.DEFAULT_TOLERANCE);
  assert.strictEqual(s.validPixels, 3);
  assert.strictEqual(s.deviantPixels, 1);
  assert.strictEqual(s.deviant[2], 1);
  assert(Math.abs(s.deviationRatio - 1 / 3) < 1e-12);
});

console.log(`\n全部 ${passed} 项断言通过`);
