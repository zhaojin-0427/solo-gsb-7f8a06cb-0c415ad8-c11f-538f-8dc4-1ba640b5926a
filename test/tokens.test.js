'use strict';

const assert = require('assert');
const { validateInput } = require('../src/validate');
const { solve } = require('../src/solver');
const { resolveTokens, MAX_TOKENS, TOKEN_NAME_RE } = require('../src/tokens');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

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

const baseColors = () => ([
  { id: 1, name: '品牌蓝', base: '#1D4ED8', alternatives: ['#1E40AF'], locked: false },
  { id: 2, name: '浅灰底', base: '#F8FAFC', alternatives: ['#FFFFFF'], locked: false },
]);

// ---- 常量 ----
check('令牌名正则：小写字母开头，仅含小写字母/数字/连字符', () => {
  assert(TOKEN_NAME_RE.test('a'));
  assert(TOKEN_NAME_RE.test('brand-primary-2'));
  assert(!TOKEN_NAME_RE.test(''));
  assert(!TOKEN_NAME_RE.test('A'));
  assert(!TOKEN_NAME_RE.test('1a'));
  assert(!TOKEN_NAME_RE.test('-a'));
  assert(!TOKEN_NAME_RE.test('a_b'));
  assert(!TOKEN_NAME_RE.test('a b'));
});
check('令牌上限为 12', () => {
  assert.strictEqual(MAX_TOKENS, 12);
});

// ---- 校验 ----
check('无 tokens 字段合法，规范化为空数组', () => {
  const v = valid({ colors: baseColors(), constraints: [] });
  assert(Array.isArray(v.tokens));
  assert.strictEqual(v.tokens.length, 0);
  assert.strictEqual(v.colors[0].id, 1);
});
check('令牌名称非法（大写/数字开头/下划线/空）报 BAD_TOKEN_NAME', () => {
  ['Brand', '1abc', 'a_b', ''].forEach((name) => {
    const codes = invalidCodes({
      colors: baseColors(),
      constraints: [],
      tokens: [{ name, target: { kind: 'color', colorId: 1 } }],
    });
    assert(codes.includes('BAD_TOKEN_NAME'), `name=${name}`);
  });
});
check('令牌重名报 DUP_TOKEN_NAME', () => {
  const codes = invalidCodes({
    colors: baseColors(),
    constraints: [],
    tokens: [
      { name: 'brand', target: { kind: 'color', colorId: 1 } },
      { name: 'brand', target: { kind: 'color', colorId: 2 } },
    ],
  });
  assert(codes.includes('DUP_TOKEN_NAME'));
});
check('令牌超过 12 个报 TOKEN_COUNT', () => {
  const tokens = Array.from({ length: 13 }, (_, i) => ({
    name: `t${i}`, target: { kind: 'color', colorId: 1 },
  }));
  const codes = invalidCodes({ colors: baseColors(), constraints: [], tokens });
  assert(codes.includes('TOKEN_COUNT'));
});
check('令牌缺目标 / 目标类型非法 / 未选目标报 BAD_TOKEN_TARGET', () => {
  const mk = (target) => invalidCodes({
    colors: baseColors(), constraints: [], tokens: [{ name: 'brand', target }],
  });
  assert(mk(undefined).includes('BAD_TOKEN_TARGET'));
  assert(mk(null).includes('BAD_TOKEN_TARGET'));
  assert(mk({ kind: 'other' }).includes('BAD_TOKEN_TARGET'));
  assert(mk({ kind: 'color' }).includes('BAD_TOKEN_TARGET'));
  assert(mk({ kind: 'color', colorId: 'x' }).includes('BAD_TOKEN_TARGET'));
  assert(mk({ kind: 'token', token: '  ' }).includes('BAD_TOKEN_TARGET'));
});
check('合法令牌通过校验并规范化（目标引用不存在的令牌不在此拦截）', () => {
  const v = valid({
    colors: baseColors(),
    constraints: [],
    tokens: [
      { name: 'brand', target: { kind: 'color', colorId: 1 } },
      { name: 'link', target: { kind: 'token', token: 'missing-later' } },
    ],
  });
  assert.strictEqual(v.tokens.length, 2);
  assert.deepStrictEqual(v.tokens[0].target, { kind: 'color', colorId: 1 });
  assert.deepStrictEqual(v.tokens[1].target, { kind: 'token', token: 'missing-later' });
});

// ---- 解析 ----
const PICKS = [
  { name: '品牌蓝', value: '#1D4ED8' },
  { name: '浅灰底', value: '#F8FAFC' },
];

check('直接引用颜色：解析到色值并生成 --role 声明', () => {
  const r = resolveTokens(
    [{ name: 'brand', target: { kind: 'color', colorId: 2 } }],
    valid({ colors: baseColors(), constraints: [] }).colors,
    PICKS,
  );
  assert.strictEqual(r.errorCount, 0);
  const item = r.items[0];
  assert(item.ok);
  assert.strictEqual(item.value, '#F8FAFC');
  assert.strictEqual(item.colorNumber, 2);
  assert.deepStrictEqual(item.chain, ['brand', '颜色2「浅灰底」']);
  assert.strictEqual(item.css, '--role-brand: var(--color-2);');
  assert.strictEqual(r.css, '--role-brand: var(--color-2);');
});

check('令牌链（含前向引用）解析到最终颜色，引用链完整', () => {
  const tokens = [
    { name: 'link', target: { kind: 'token', token: 'brand-deep' } }, // 前向引用
    { name: 'brand', target: { kind: 'color', colorId: 1 } },
    { name: 'brand-deep', target: { kind: 'token', token: 'brand' } },
  ];
  const r = resolveTokens(tokens, valid({ colors: baseColors(), constraints: [] }).colors, PICKS);
  assert.strictEqual(r.errorCount, 0);
  const link = r.items[0];
  assert(link.ok);
  assert.strictEqual(link.value, '#1D4ED8');
  assert.deepStrictEqual(link.chain, ['link', 'brand-deep', 'brand', '颜色1「品牌蓝」']);
  assert.strictEqual(link.css, '--role-link: var(--color-1);');
});

check('引用不存在的令牌：标出 TOKEN_MISSING 与引用路径', () => {
  const r = resolveTokens(
    [
      { name: 'a', target: { kind: 'token', token: 'ghost' } },
      { name: 'b', target: { kind: 'token', token: 'a' } },
    ],
    valid({ colors: baseColors(), constraints: [] }).colors,
    PICKS,
  );
  assert.strictEqual(r.errorCount, 2); // b 的链经过 a，同样无法解析
  assert.strictEqual(r.items[0].code, 'TOKEN_MISSING');
  assert.deepStrictEqual(r.items[0].chain, ['a', 'ghost']);
  assert.deepStrictEqual(r.items[1].chain, ['b', 'a', 'ghost']);
  assert.strictEqual(r.css, '');
});

check('目标颜色已删除：标出 COLOR_MISSING', () => {
  const r = resolveTokens(
    [{ name: 'brand', target: { kind: 'color', colorId: 999 } }],
    valid({ colors: baseColors(), constraints: [] }).colors,
    PICKS,
  );
  assert.strictEqual(r.errorCount, 1);
  assert.strictEqual(r.items[0].code, 'COLOR_MISSING');
  assert.deepStrictEqual(r.items[0].chain, ['brand', '（已删除的颜色）']);
});

check('循环引用：自引用与多跳循环均标出 TOKEN_CYCLE 及路径', () => {
  const self = resolveTokens(
    [{ name: 'a', target: { kind: 'token', token: 'a' } }],
    valid({ colors: baseColors(), constraints: [] }).colors,
    PICKS,
  );
  assert.strictEqual(self.items[0].code, 'TOKEN_CYCLE');
  assert.deepStrictEqual(self.items[0].chain, ['a', 'a']);

  const ring = resolveTokens(
    [
      { name: 'a', target: { kind: 'token', token: 'b' } },
      { name: 'b', target: { kind: 'token', token: 'c' } },
      { name: 'c', target: { kind: 'token', token: 'b' } },
    ],
    valid({ colors: baseColors(), constraints: [] }).colors,
    PICKS,
  );
  assert.strictEqual(ring.errorCount, 3);
  assert.deepStrictEqual(ring.items[0].chain, ['a', 'b', 'c', 'b']);
  assert(ring.items[0].message.includes('循环'));
});

check('混合场景：css 只拼接成功项，计数正确', () => {
  const r = resolveTokens(
    [
      { name: 'ok-1', target: { kind: 'color', colorId: 1 } },
      { name: 'bad', target: { kind: 'token', token: 'ghost' } },
      { name: 'ok-2', target: { kind: 'token', token: 'ok-1' } },
    ],
    valid({ colors: baseColors(), constraints: [] }).colors,
    PICKS,
  );
  assert.strictEqual(r.okCount, 2);
  assert.strictEqual(r.errorCount, 1);
  assert.strictEqual(r.css, '--role-ok-1: var(--color-1);\n--role-ok-2: var(--color-1);');
});

// ---- 与求解集成 ----
check('求解成功后 result.tokens 使用最终选中的颜色（替换后的备选色）', () => {
  const payload = {
    colors: [
      { id: 11, name: 'A', base: '#777777', alternatives: ['#000000'] },
      { id: 22, name: 'B', base: '#FFFFFF', alternatives: [] },
    ],
    constraints: [{ a: 'A', b: 'B', minRatio: 7 }], // 基准 #777 不满足，A 会被替换为 #000000
    tokens: [
      { name: 'text-strong', target: { kind: 'color', colorId: 11 } },
      { name: 'surface', target: { kind: 'color', colorId: 22 } },
      { name: 'emphasis', target: { kind: 'token', token: 'text-strong' } },
    ],
  };
  const r = solve(valid(payload));
  assert(r.feasible);
  assert(r.tokens);
  assert.strictEqual(r.tokens.errorCount, 0);
  assert.strictEqual(r.tokens.items[0].value, '#000000'); // 解析到替换后的颜色
  assert.strictEqual(r.tokens.items[0].css, '--role-text-strong: var(--color-1);');
  assert.strictEqual(r.tokens.items[2].chain.join(' → '), 'emphasis → text-strong → 颜色1「A」');
  assert.strictEqual(
    r.tokens.css,
    '--role-text-strong: var(--color-1);\n--role-surface: var(--color-2);\n--role-emphasis: var(--color-1);',
  );
});

check('无解时不附带令牌结果', () => {
  const payload = {
    colors: [
      { id: 11, name: 'A', base: '#777777', alternatives: [], locked: true },
      { id: 22, name: 'B', base: '#FFFFFF', alternatives: [] },
    ],
    constraints: [{ a: 'A', b: 'B', minRatio: 7 }],
    tokens: [{ name: 'text-strong', target: { kind: 'color', colorId: 11 } }],
  };
  const r = solve(valid(payload));
  assert.strictEqual(r.feasible, false);
  assert.strictEqual(r.tokens, undefined);
});

check('未提交令牌时结果不含 tokens 字段', () => {
  const r = solve(valid({ colors: baseColors(), constraints: [] }));
  assert(r.feasible);
  assert.strictEqual(r.tokens, undefined);
});

console.log(`\n全部 ${passed} 项断言通过`);
