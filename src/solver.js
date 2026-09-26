'use strict';

const { parseHex, contrastRatio } = require('./wcag');
const { resolveTokens } = require('./tokens');

// 对比度浮点比较容差
const EPS = 1e-9;

/**
 * 构建每个颜色的候选列表（按录入顺序）。
 * 候选 0 = 基准色；候选 1..n = 备选色（去空后保持原顺序）。
 * 锁定时只保留基准色。
 */
function buildCandidates(colors) {
  return colors.map((color) => {
    const list = [{ choiceIndex: 0, value: color.base, kind: 'base' }];
    if (!color.locked) {
      color.alternatives.forEach((value, j) => {
        list.push({ choiceIndex: j + 1, value, kind: 'alt' });
      });
    }
    return list;
  });
}

/** 两个 #RRGGBB 的 RGB 通道绝对差之和 */
function channelDistance(hexA, hexB) {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/** 数组按位比较（字典序）：a < b 返回 -1 */
function compareIndices(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * 枚举全部候选组合，返回最优可行方案。
 * 优化目标（依次）：
 *   1. 与基准色不同的颜色数最少
 *   2. 各色 RGB 通道绝对差之和最小
 *   3. 候选序号数组字典序最小
 *
 * 返回:
 *   有解 { feasible:true, picks, constraints, summary, tokens? }
 *        （提交了语义色令牌时附带 tokens 解析结果，见 src/tokens.js）
 *   无解 { feasible:false }
 */
function solve(validated) {
  const { colors, constraints } = validated;
  const candidates = buildCandidates(colors);

  const nameIndex = new Map(colors.map((c, i) => [c.name, i]));
  const resolved = constraints.map((con) => ({
    ai: nameIndex.get(con.a),
    bi: nameIndex.get(con.b),
    minRatio: con.minRatio,
    a: con.a,
    b: con.b,
  }));

  const n = colors.length;
  const slots = new Array(n);
  let best = null; // { diffCount, distance, indices, values }

  const feasible = (values) => resolved.every(
    (con) => contrastRatio(values[con.ai], values[con.bi]) >= con.minRatio - EPS,
  );

  function evaluate(values) {
    let diffCount = 0;
    let distance = 0;
    for (let i = 0; i < n; i += 1) {
      const d = channelDistance(colors[i].base, values[i]);
      distance += d;
      if (d > 0) diffCount += 1;
    }

    if (best === null
      || diffCount < best.diffCount
      || (diffCount === best.diffCount && distance < best.distance)
      || (diffCount === best.diffCount && distance === best.distance
        && compareIndices(slots, best.indices) < 0)) {
      best = { diffCount, distance, indices: slots.slice(), values: values.slice() };
    }
  }

  (function enumerate(pos, values) {
    if (pos === n) {
      if (feasible(values)) evaluate(values);
      return;
    }
    candidates[pos].forEach((cand) => {
      slots[pos] = cand.choiceIndex;
      values[pos] = cand.value;
      enumerate(pos + 1, values);
    });
  })(0, new Array(n));

  if (!best) return { feasible: false };

  const picks = colors.map((color, i) => {
    const idx = best.indices[i];
    const list = candidates[i];
    return {
      name: color.name,
      base: color.base,
      locked: color.locked,
      value: best.values[i],
      choiceIndex: idx,
      kind: list[idx].kind,
      changed: best.values[i] !== color.base,
    };
  });

  const constraintResults = resolved.map((con) => {
    const ratio = contrastRatio(best.values[con.ai], best.values[con.bi]);
    return {
      a: con.a,
      b: con.b,
      minRatio: con.minRatio,
      actual: Math.round(ratio * 100) / 100,
      pass: ratio >= con.minRatio - EPS,
    };
  });

  return {
    feasible: true,
    picks,
    constraints: constraintResults,
    summary: {
      diffCount: best.diffCount,
      channelDistance: best.distance,
      cssVariables: buildCssVariables(picks),
    },
    // 语义色令牌沿引用链解析到最终选中的颜色；无解时不附带令牌结果
    ...(Array.isArray(validated.tokens) && validated.tokens.length > 0
      ? { tokens: resolveTokens(validated.tokens, colors, picks) }
      : {}),
  };
}

/**
 * 生成按录入顺序编号的 CSS 变量。
 * 变量名使用 --color-1 起的编号；名称作为注释（名称中的注释结束符会被转义）。
 */
function buildCssVariables(picks) {
  return picks.map((pick, i) => {
    const safeName = pick.name.replace(/\*\//g, '*\\/');
    return `--color-${i + 1}: ${pick.value}; /* ${safeName} */`;
  }).join('\n');
}

module.exports = { solve };
