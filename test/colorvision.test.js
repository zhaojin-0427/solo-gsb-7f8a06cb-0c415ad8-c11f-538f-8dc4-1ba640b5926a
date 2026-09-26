'use strict';

const assert = require('assert');
const cv = require('../src/colorvision');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ---- 色觉模拟 ----
check('normal 视图直接返回原色（仅规范化为大写）', () => {
  assert.strictEqual(cv.simulateHex('#abcdef', 'normal'), '#ABCDEF');
  assert.strictEqual(cv.simulateHex('#1D4ED8', 'normal'), '#1D4ED8');
});

check('黑/白在两种色盲模拟下保持稳定', () => {
  ['protanopia', 'deuteranopia'].forEach((view) => {
    assert.strictEqual(cv.simulateHex('#000000', view), '#000000');
    assert.strictEqual(cv.simulateHex('#FFFFFF', view), '#FFFFFF');
  });
});

check('Machado 100% 模拟的已知锚点值', () => {
  assert.strictEqual(cv.simulateHex('#FF0000', 'protanopia'), '#6D5F00');
  assert.strictEqual(cv.simulateHex('#00FF00', 'deuteranopia'), '#EFD63A');
  assert.strictEqual(cv.simulateHex('#0000FF', 'protanopia'), '#0059FF');
});

check('模拟结果始终裁剪到合法 #RRGGBB', () => {
  ['#FF0000', '#00FF00', '#0000FF', '#FF00FF', '#FFFF00', '#00FFFF'].forEach((hex) => {
    ['protanopia', 'deuteranopia'].forEach((view) => {
      assert(/^#[0-9A-F]{6}$/.test(cv.simulateHex(hex, view)), `${hex} @ ${view}`);
    });
  });
});

check('未知视图抛错', () => {
  assert.throws(() => cv.simulateHex('#000000', 'tritanopia'));
});

// ---- CIE Lab（D65）与 ΔE76 ----
check('白/黑的 Lab 值符合 D65 定义', () => {
  const white = cv.hexToLab('#FFFFFF');
  const black = cv.hexToLab('#000000');
  assert(Math.abs(white.L - 100) < 1e-3);
  assert(Math.abs(white.a) < 1e-3);
  assert(Math.abs(white.b) < 1e-3);
  assert.deepStrictEqual(black, { L: 0, a: 0, b: 0 });
});

check('黑/白 ΔE76 = 100，同色 = 0', () => {
  assert(Math.abs(cv.deltaE76(cv.hexToLab('#000000'), cv.hexToLab('#FFFFFF')) - 100) < 1e-3);
  assert.strictEqual(cv.deltaE76(cv.hexToLab('#123456'), cv.hexToLab('#123456')), 0);
});

// ---- 逐对审查 ----
check('正常视图：黑白配对距离 100，不标记易混淆', () => {
  const r = cv.pairReview(
    [{ name: '黑', value: '#000000' }, { name: '白', value: '#FFFFFF' }],
    'normal',
  );
  assert.strictEqual(r.pairs.length, 1);
  assert.strictEqual(r.pairs[0].a.simulated, '#000000');
  assert.strictEqual(r.pairs[0].b.simulated, '#FFFFFF');
  assert(Math.abs(r.pairs[0].distance - 100) < 1e-3);
  assert.strictEqual(r.pairs[0].confusable, false);
});

check('绿色盲视图：红/绿配对 ΔE76 < 20 被标记易混淆', () => {
  const r = cv.pairReview(
    [{ name: '红', value: '#E11D48' }, { name: '绿', value: '#16A34A' }],
    'deuteranopia',
  );
  assert.strictEqual(r.pairs.length, 1);
  assert(r.pairs[0].distance < cv.CONFUSABLE_THRESHOLD);
  assert.strictEqual(r.pairs[0].confusable, true);
  // 同一配对在正常视图下不应混淆
  const n = cv.pairReview(
    [{ name: '红', value: '#E11D48' }, { name: '绿', value: '#16A34A' }],
    'normal',
  );
  assert.strictEqual(n.pairs[0].confusable, false);
});

check('配对数量 = n(n-1)/2 且按距离升序', () => {
  const picks = ['#000000', '#FFFFFF', '#FF0000', '#00FF00']
    .map((value, i) => ({ name: `C${i}`, value }));
  const r = cv.pairReview(picks, 'protanopia');
  assert.strictEqual(r.pairs.length, 6);
  for (let i = 1; i < r.pairs.length; i += 1) {
    assert(r.pairs[i].distance >= r.pairs[i - 1].distance);
  }
});

check('易混淆判定使用未舍入距离（阈值 20）', () => {
  assert.strictEqual(cv.isConfusable(19.999), true);
  assert.strictEqual(cv.isConfusable(20), false);
  assert.strictEqual(cv.isConfusable(20.001), false);
  assert.strictEqual(cv.formatDistance(19.96), '20.0');
  assert.strictEqual(cv.formatDistance(5.231640552331799), '5.2');
});

console.log(`\n全部 ${passed} 项断言通过`);
