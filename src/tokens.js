'use strict';

// 语义色令牌：沿引用链把每个令牌解析到最终选中的颜色。
//
// 令牌目标（二选一，校验阶段保证结构合法）：
//   { kind: 'color', colorId } —— 引用某个颜色录入项（按客户端颜色 id）
//   { kind: 'token', token }   —— 引用另一个令牌（按令牌名，允许前向引用）
//
// 解析错误不阻断配色求解，由调用方在结果中展示：
//   TOKEN_MISSING  引用的令牌不存在
//   COLOR_MISSING  引用的颜色已被删除
//   TOKEN_CYCLE    引用链出现循环
//   BAD_TARGET     目标缺失或类型非法（防御性兜底，正常流程不会触发）

const MAX_TOKENS = 12;
const TOKEN_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * 解析全部令牌。
 * @param {Array} tokens  校验后的令牌列表（含 name 与 target）
 * @param {Array} colors  校验后的颜色列表（含 id、name，顺序即录入顺序）
 * @param {Array} [picks] 求解选中的颜色（与 colors 同序，含 value）；缺省时用基准色
 * @returns {{ items: Array, okCount: number, errorCount: number, css: string }}
 *   items 成功项: { name, ok:true, value, colorNumber, colorName, chain, css }
 *   items 失败项: { name, ok:false, code, message, chain }
 *   css 仅拼接成功项的 `--role-名称: var(--color-N);` 声明
 */
function resolveTokens(tokens, colors, picks) {
  const colorIndexById = new Map();
  colors.forEach((color, i) => {
    if (color.id !== null && color.id !== undefined && !colorIndexById.has(color.id)) {
      colorIndexById.set(color.id, i);
    }
  });
  const tokenIndexByName = new Map();
  tokens.forEach((token, i) => {
    if (!tokenIndexByName.has(token.name)) tokenIndexByName.set(token.name, i);
  });

  const items = tokens.map((token) => (
    resolveOne(token, tokens, tokenIndexByName, colorIndexById, colors, picks)
  ));
  const okItems = items.filter((item) => item.ok);
  return {
    items,
    okCount: okItems.length,
    errorCount: items.length - okItems.length,
    css: okItems.map((item) => item.css).join('\n'),
  };
}

function resolveOne(start, tokens, tokenIndexByName, colorIndexById, colors, picks) {
  const chain = [start.name];
  const visited = new Set([start.name]);
  let current = start;

  // 每轮要么返回，要么把一个未访问的令牌加入 visited；令牌数量有限，必然终止
  while (true) {
    const target = current.target;
    if (!target || (target.kind !== 'color' && target.kind !== 'token')) {
      return errorItem(start.name, 'BAD_TARGET', '缺少有效的引用目标', chain);
    }

    if (target.kind === 'color') {
      const colorIndex = colorIndexById.get(target.colorId);
      if (colorIndex === undefined) {
        chain.push('（已删除的颜色）');
        return errorItem(start.name, 'COLOR_MISSING', '引用的颜色不存在（可能已被删除）', chain);
      }
      const color = colors[colorIndex];
      const value = picks && picks[colorIndex] ? picks[colorIndex].value : color.base;
      chain.push(`颜色${colorIndex + 1}「${color.name}」`);
      return {
        name: start.name,
        ok: true,
        value,
        colorNumber: colorIndex + 1,
        colorName: color.name,
        chain,
        css: `--role-${start.name}: var(--color-${colorIndex + 1});`,
      };
    }

    const nextName = target.token;
    if (!tokenIndexByName.has(nextName)) {
      chain.push(nextName);
      return errorItem(start.name, 'TOKEN_MISSING', `引用的令牌「${nextName}」不存在`, chain);
    }
    if (visited.has(nextName)) {
      chain.push(nextName);
      return errorItem(start.name, 'TOKEN_CYCLE', `检测到循环引用：${chain.join(' → ')}`, chain);
    }
    visited.add(nextName);
    chain.push(nextName);
    current = tokens[tokenIndexByName.get(nextName)];
  }
}

function errorItem(name, code, message, chain) {
  return { name, ok: false, code, message, chain: chain.slice() };
}

module.exports = { resolveTokens, MAX_TOKENS, TOKEN_NAME_RE };
