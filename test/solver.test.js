'use strict';

const assert = require('assert');
const { contrastRatio, relativeLuminance } = require('../src/wcag');
const { validateInput } = require('../src/validate');
const { solve } = require('../src/solver');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ---- WCAG 已知值 ----
check('黑/白对比度 = 21', () => {
  assert(Math.abs(contrastRatio('#000000', '#FFFFFF') - 21) < 1e-9);
});
check('#777 对白底 ≈ 4.478', () => {
  assert(Math.abs(contrastRatio('#777777', '#FFFFFF') - 4.478) < 0.01);
});
check('黑/白亮度 0 与 1', () => {
  assert(relativeLuminance('#000000') === 0);
  assert(Math.abs(relativeLuminance('#FFFFFF') - 1) < 1e-12);
});
check('大小写与顺序无关', () => {
  assert(contrastRatio('#abcdef', '#123456') === contrastRatio('#ABCDEF', '#123456'));
  assert(contrastRatio('#abcdef', '#123456') === contrastRatio('#123456', '#abcdef'));
});

function valid(payload) {
  const v = validateInput(payload);
  if (!v.ok) throw new Error(`unexpected invalid: ${JSON.stringify(v.errors)}`);
  return v;
}
function invalidCodes(payload) {
  const v = validateInput(payload);
  assert.strictEqual(v.ok, false);
  return v.errors.map((e) => e.code);
}

const basePayload = () => ({
  colors: [
    { name: 'A', base: '#1D4ED8', alternatives: ['#1E40AF', '#1E3A8A', '#3B82F6'], locked: false },
    { name: 'B', base: '#F8FAFC', alternatives: ['#F1F5F9', '#E2E8F0', '#FFFFFF'], locked: false },
  ],
  constraints: [{ a: 'A', b: 'B', minRatio: 7 }],
});

// ---- 求解 ----
check('演示用例：需把 A 替换为候选1 #1E40AF', () => {
  const r = solve(valid(basePayload()));
  assert(r.feasible);
  assert.strictEqual(r.picks[0].value, '#1E40AF');
  assert.strictEqual(r.picks[0].choiceIndex, 1);
  assert.strictEqual(r.picks[1].changed, false);
  assert.strictEqual(r.summary.diffCount, 1);
  r.constraints.forEach((c) => assert(c.pass));
  assert(cssLines(r).length === 2);
});
function cssLines(r) { return r.summary.cssVariables.split('\n'); }

check('下限 4.5 时基准色即满足，替换数为 0', () => {
  const p = basePayload();
  p.constraints[0].minRatio = 4.5;
  const r = solve(valid(p));
  assert(r.feasible);
  assert.strictEqual(r.summary.diffCount, 0);
  assert.strictEqual(r.picks[0].choiceIndex, 0);
});

check('锁定基准色且基准不达标 => 无解', () => {
  const p = basePayload();
  p.colors[0].locked = true;
  const r = solve(valid(p));
  assert.strictEqual(r.feasible, false);
});

check('双方都需要替换时 diffCount 最小优先', () => {
  // 3 个颜色：A 灰、B 灰、C 白；约束 A-C 与 B-C 都要求 7。
  // 每个灰色只有很深的备选满足，两个都要换 => diffCount=2。
  const payload = {
    colors: [
      { name: 'A', base: '#777777', alternatives: ['#000000'] },
      { name: 'B', base: '#888888', alternatives: ['#111111'] },
      { name: 'C', base: '#FFFFFF', alternatives: ['#FFFFFF'] },
    ],
    constraints: [
      { a: 'A', b: 'C', minRatio: 7 },
      { a: 'B', b: 'C', minRatio: 7 },
    ],
  };
  const r = solve(valid(payload));
  assert(r.feasible);
  assert.strictEqual(r.summary.diffCount, 2);
  assert.strictEqual(r.picks[0].value, '#000000');
  assert.strictEqual(r.picks[1].value, '#111111');
});

check('相同值的候选按候选序号取最小（字典序）', () => {
  const payload = {
    colors: [
      { name: 'A', base: '#777777', alternatives: ['#000000', '#000000'] },
      { name: 'B', base: '#FFFFFF', alternatives: [] },
    ],
    constraints: [{ a: 'A', b: 'B', minRatio: 7 }],
  };
  const r = solve(valid(payload));
  assert(r.feasible);
  assert.strictEqual(r.picks[0].choiceIndex, 1);
});

check('通道差之和作为第二目标：选差最小的可行候选', () => {
  // 基准 #777777 对白对比度约 4.48，不满足 7；
  // 备选 #555555（约 7.66，满足）与 #404040（满足），
  // 两者 diffCount 相同，期望取通道差更小的 #555555。
  const p = {
    colors: [
      { name: 'A', base: '#777777', alternatives: ['#404040', '#555555'] },
      { name: 'B', base: '#FFFFFF', alternatives: [] },
    ],
    constraints: [{ a: 'A', b: 'B', minRatio: 7 }],
  };
  const r = solve(valid(p));
  assert(r.feasible);
  assert.strictEqual(r.picks[0].value, '#555555');
});

check('无约束时全部取基准色（候选序号 0）', () => {
  const p = { colors: basePayload().colors, constraints: [] };
  const r = solve(valid(p));
  assert(r.feasible);
  assert(r.picks.every((pk) => pk.choiceIndex === 0));
});

check('CSS 变量按录入顺序编号并保留名称注释', () => {
  const r = solve(valid(basePayload()));
  const css = r.summary.cssVariables;
  assert(css.startsWith('--color-1: #1E40AF; /* A */'));
  assert(css.includes('--color-2: #F8FAFC; /* B */'));
});

// ---- 校验 ----
check('重名报错', () => {
  const p = basePayload();
  p.colors[1].name = 'A';
  assert(invalidCodes(p).includes('DUP_NAME'));
});
check('自配对报错', () => {
  const p = basePayload();
  p.constraints[0].b = 'A';
  assert(invalidCodes(p).includes('SELF_PAIR'));
});
check('非法基准色/备选色报错', () => {
  const p1 = basePayload();
  p1.colors[0].base = '1D4ED8';
  assert(invalidCodes(p1).includes('BAD_BASE'));
  const p2 = basePayload();
  p2.colors[0].alternatives = ['#xyzxyz'];
  assert(invalidCodes(p2).includes('BAD_ALT'));
  const p3 = basePayload();
  p3.colors[0].alternatives = ['#fff']; // 3 位简写不允许
  assert(invalidCodes(p3).includes('BAD_ALT'));
});
check('备选超过 3 个报错', () => {
  const p = basePayload();
  p.colors[0].alternatives = ['#000000', '#111111', '#222222', '#333333'];
  assert(invalidCodes(p).includes('TOO_MANY_ALTS'));
});
check('颜色数量越界报错', () => {
  const one = { colors: [{ name: 'A', base: '#000000' }], constraints: [] };
  assert(invalidCodes(one).includes('COLOR_COUNT'));
  const nine = { colors: Array.from({ length: 9 }, (_, i) => ({ name: `C${i}`, base: '#000000' })), constraints: [] };
  assert(invalidCodes(nine).includes('COLOR_COUNT'));
});
check('对比度下限只能为 3/4.5/7', () => {
  const p = basePayload();
  p.constraints[0].minRatio = 5;
  assert(invalidCodes(p).includes('BAD_RATIO'));
});
check('引用不存在的颜色报错', () => {
  const p = basePayload();
  p.constraints[0].b = 'Z';
  assert(invalidCodes(p).includes('UNKNOWN_COLOR'));
});
check('空名称与空备选槽位（忽略）', () => {
  const p = basePayload();
  p.colors[0].name = '   ';
  assert(invalidCodes(p).some((c) => c === 'EMPTY_NAME' || c === 'DUP_NAME'));
  const p2 = basePayload();
  p2.colors[0].alternatives = ['', ''];
  p2.constraints[0].minRatio = 4.5; // 基准色即可满足
  const r = solve(valid(p2));
  assert(r.feasible);
});

console.log(`\n全部 ${passed} 项断言通过`);
