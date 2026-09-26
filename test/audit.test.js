'use strict';

const assert = require('assert');
const cv = require('../src/colorvision');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ---- rgbToLab（0-255 通道 -> D65 Lab）----
check('rgbToLab 与 hexToLab 结果一致', () => {
  ['#000000', '#FFFFFF', '#1D4ED8', '#F8FAFC', '#FF0000', '#00FF00', '#123456'].forEach((hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    assert.deepStrictEqual(cv.rgbToLab(r, g, b), cv.hexToLab(hex));
  });
});

check('rgbToLab 白/黑锚点（D65）', () => {
  const white = cv.rgbToLab(255, 255, 255);
  assert(Math.abs(white.L - 100) < 1e-3);
  assert(Math.abs(white.a) < 1e-3);
  assert(Math.abs(white.b) < 1e-3);
  assert.deepStrictEqual(cv.rgbToLab(0, 0, 0), { L: 0, a: 0, b: 0 });
});

check('rgbToLab 将越界通道裁剪到 [0,255]', () => {
  assert.deepStrictEqual(cv.rgbToLab(300, -5, 128), cv.rgbToLab(255, 0, 128));
});

// ---- auditPixels 基本统计 ----
check('像素全部命中调色板时偏离为 0', () => {
  const res = cv.auditPixels([29, 78, 216, 248, 250, 252], ['#1D4ED8', '#F8FAFC'], 20);
  assert.strictEqual(res.total, 2);
  assert.strictEqual(res.deviant, 0);
  assert.strictEqual(res.ratio, 0);
  assert.strictEqual(res.distances.length, 2);
  assert(res.distances.every((d) => d === 0));
});

check('远离调色板的像素全部偏离（黑调色板 vs 白像素，ΔE76 = 100）', () => {
  const res = cv.auditPixels([255, 255, 255, 255, 255, 255], ['#000000'], 40);
  assert.strictEqual(res.total, 2);
  assert.strictEqual(res.deviant, 2);
  assert.strictEqual(res.ratio, 1);
});

check('混合像素按比例统计', () => {
  const res = cv.auditPixels([0, 0, 0, 255, 255, 255, 0, 0, 0], ['#000000'], 40);
  assert.strictEqual(res.total, 3);
  assert.strictEqual(res.deviant, 1);
  assert(Math.abs(res.ratio - 1 / 3) < 1e-12);
});

check('逐像素取最近色：灰像素 (48,48,48) 更靠近黑而非白', () => {
  const res = cv.auditPixels([48, 48, 48], ['#000000', '#FFFFFF'], 20);
  const dBlack = cv.deltaE76(cv.rgbToLab(48, 48, 48), cv.hexToLab('#000000'));
  const dWhite = cv.deltaE76(cv.rgbToLab(48, 48, 48), cv.hexToLab('#FFFFFF'));
  assert(dBlack < dWhite);
  assert(Math.abs(res.distances[0] - dBlack) < 1e-12);
});

check('偏离判定使用未舍入距离：大于容差才算偏离', () => {
  // (48,48,48) 对 #000000 的 ΔE76 ≈ 19.87（未舍入）
  const probe = cv.auditPixels([48, 48, 48], ['#000000'], 20);
  const d = probe.distances[0];
  assert(d > 19 && d < 20, `预期距离在 19～20 之间，实际 ${d}`);
  assert.strictEqual(cv.auditPixels([48, 48, 48], ['#000000'], 19).deviant, 1);
  assert.strictEqual(cv.auditPixels([48, 48, 48], ['#000000'], 20).deviant, 0);
  // 任意容差下 deviant 与 distances 自洽
  [5, 20, 40].forEach((tol) => {
    const r = cv.auditPixels([48, 48, 48, 0, 0, 0, 255, 255, 255], ['#000000'], tol);
    assert.strictEqual(r.deviant, r.distances.filter((x) => x > tol).length);
  });
});

check('空像素列表返回 total 0、ratio 0', () => {
  const res = cv.auditPixels([], ['#000000'], 20);
  assert.deepStrictEqual(res, { total: 0, deviant: 0, ratio: 0, distances: [] });
});

check('容差必须在 5～40 之间', () => {
  [4.9, 40.1, NaN, -1, 0, 100].forEach((tol) => {
    assert.throws(() => cv.auditPixels([0, 0, 0], ['#000000'], tol), /容差/);
  });
  [5, 20, 40].forEach((tol) => {
    assert.doesNotThrow(() => cv.auditPixels([0, 0, 0], ['#000000'], tol));
  });
});

check('调色板为空或色值非法时抛错', () => {
  assert.throws(() => cv.auditPixels([0, 0, 0], [], 20));
  assert.throws(() => cv.auditPixels([0, 0, 0], null, 20));
  assert.throws(() => cv.auditPixels([0, 0, 0], ['#XYZ'], 20));
});

check('AUDIT_TOLERANCE 常量：范围 5～40，默认值在范围内', () => {
  assert.strictEqual(cv.AUDIT_TOLERANCE.MIN, 5);
  assert.strictEqual(cv.AUDIT_TOLERANCE.MAX, 40);
  assert(cv.AUDIT_TOLERANCE.DEFAULT >= cv.AUDIT_TOLERANCE.MIN);
  assert(cv.AUDIT_TOLERANCE.DEFAULT <= cv.AUDIT_TOLERANCE.MAX);
});

console.log(`\n全部 ${passed} 项断言通过`);
