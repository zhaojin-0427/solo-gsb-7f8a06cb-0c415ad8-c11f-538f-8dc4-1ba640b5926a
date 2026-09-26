'use strict';

const { parseHex } = require('./wcag');
const { MAX_TOKENS, TOKEN_NAME_RE } = require('./tokens');

const MIN_COLORS = 2;
const MAX_COLORS = 8;
const MAX_ALTS = 3;
const VALID_RATIOS = [3, 4.5, 7];

/**
 * 校验请求载荷。
 * 返回结构：
 *   合法: { ok: true, colors, constraints, tokens }
 *   非法: { ok: false, errors: [{ code, message, ref? }] }
 *
 * 错误项 ref（供前端定位）:
 *   { type:'color', index }、{ type:'candidate', colorIndex, kind:'base'|'alt', altIndex }
 *   { type:'constraint', index, field? }、{ type:'token', index, field? }
 *
 * 说明：令牌的结构问题（名称非法、重名、超量、缺目标）在此拦截；
 * 引用目标不存在、目标颜色已删除、循环引用属于解析期错误，在求解成功后
 * 由 src/tokens.js 标出，不产生 400。
 */
function validateInput(payload) {
  const errors = [];
  const add = (code, message, ref) => errors.push({ code, message, ...(ref ? { ref } : {}) });

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: [{ code: 'BAD_PAYLOAD', message: '请求体必须是 JSON 对象' }] };
  }

  const rawColors = payload.colors;
  if (!Array.isArray(rawColors)) {
    return { ok: false, errors: [{ code: 'NO_COLORS', message: '缺少颜色列表 colors' }] };
  }

  if (rawColors.length < MIN_COLORS || rawColors.length > MAX_COLORS) {
    add('COLOR_COUNT', `颜色数量必须在 ${MIN_COLORS}～${MAX_COLORS} 个之间，当前为 ${rawColors.length} 个`);
  }

  const names = new Map(); // 规范化名称 -> 首次出现的下标
  const colors = [];

  rawColors.forEach((color, i) => {
    if (color === null || typeof color !== 'object' || Array.isArray(color)) {
      add('BAD_COLOR', `第 ${i + 1} 个颜色条目格式错误`, { type: 'color', index: i });
      return;
    }

    const name = typeof color.name === 'string' ? color.name.trim() : '';
    if (!name) {
      add('EMPTY_NAME', `第 ${i + 1} 个颜色没有名称`, { type: 'color', index: i });
    } else if (names.has(name)) {
      add('DUP_NAME', `颜色名称重复：「${name}」（第 ${names.get(name) + 1} 个与第 ${i + 1} 个）`, { type: 'color', index: i });
    } else {
      names.set(name, i);
    }

    // 基准色
    const base = typeof color.base === 'string' ? color.base.trim() : '';
    try {
      parseHex(base);
    } catch {
      add('BAD_BASE', `「${name || `第 ${i + 1} 个颜色`}」的基准色非法：${base || '（空）'}，须为 #RRGGBB`, {
        type: 'candidate', colorIndex: i, kind: 'base',
      });
    }

    // 备选色
    let alts = [];
    const rawAlts = color.alternatives;
    if (rawAlts === undefined) {
      alts = [];
    } else if (!Array.isArray(rawAlts)) {
      add('BAD_ALTS', `「${name || `第 ${i + 1} 个颜色`}」的备选色必须是数组`, { type: 'color', index: i });
    } else if (rawAlts.length > MAX_ALTS) {
      add('TOO_MANY_ALTS', `「${name || `第 ${i + 1} 个颜色`}」最多提供 ${MAX_ALTS} 个备选色，当前有 ${rawAlts.length} 个`, {
        type: 'color', index: i,
      });
    } else {
      rawAlts.forEach((alt, j) => {
        const value = typeof alt === 'string' ? alt.trim() : '';
        if (value === '') return; // 空槽位忽略
        try {
          parseHex(value);
          alts.push(value);
        } catch {
          add('BAD_ALT', `「${name || `第 ${i + 1} 个颜色`}」的备选色 ${j + 1} 非法：${value || '（空）'}，须为 #RRGGBB`, {
            type: 'candidate', colorIndex: i, kind: 'alt', altIndex: j,
          });
        }
      });
    }

    // 客户端颜色 id（供语义色令牌引用；缺失时令牌无法定位到该颜色）
    const id = typeof color.id === 'number' && Number.isFinite(color.id) ? color.id : null;
    colors.push({ id, name, base, alternatives: alts, locked: color.locked === true });
  });

  // 约束
  const constraints = [];
  const rawConstraints = payload.constraints;
  if (rawConstraints === undefined || rawConstraints === null) {
    // 无约束合法
  } else if (!Array.isArray(rawConstraints)) {
    add('BAD_CONSTRAINTS', 'constraints 必须是数组');
  } else {
    rawConstraints.forEach((con, i) => {
      let valid = true;
      if (con === null || typeof con !== 'object' || Array.isArray(con)) {
        add('BAD_CONSTRAINT', `第 ${i + 1} 条约束格式错误`, { type: 'constraint', index: i });
        return;
      }

      const a = typeof con.a === 'string' ? con.a.trim() : '';
      const b = typeof con.b === 'string' ? con.b.trim() : '';

      if (!a || !names.has(a)) {
        valid = false;
        add('UNKNOWN_COLOR', `第 ${i + 1} 条约束引用了不存在的颜色：${a || '（空）'}`, {
          type: 'constraint', index: i, field: 'a',
        });
      }
      if (!b || !names.has(b)) {
        valid = false;
        add('UNKNOWN_COLOR', `第 ${i + 1} 条约束引用了不存在的颜色：${b || '（空）'}`, {
          type: 'constraint', index: i, field: 'b',
        });
      }
      if (a && b && a === b) {
        valid = false;
        add('SELF_PAIR', `第 ${i + 1} 条约束是自配对：「${a}」不能与自身配对`, {
          type: 'constraint', index: i,
        });
      }

      const minRatio = Number(con.minRatio);
      if (!VALID_RATIOS.includes(minRatio)) {
        valid = false;
        add('BAD_RATIO', `第 ${i + 1} 条约束的对比度下限非法：${con.minRatio}，只允许 3、4.5 或 7`, {
          type: 'constraint', index: i, field: 'minRatio',
        });
      }

      if (valid) constraints.push({ a, b, minRatio });
    });
  }

  // 语义色令牌（可选）。此处只校验结构：名称格式、重名、数量、目标是否填写；
  // 引用目标是否存在、是否成环在求解成功后的解析阶段判定。
  const tokens = [];
  const rawTokens = payload.tokens;
  if (rawTokens === undefined || rawTokens === null) {
    // 无令牌合法
  } else if (!Array.isArray(rawTokens)) {
    add('BAD_TOKENS', 'tokens 必须是数组');
  } else {
    if (rawTokens.length > MAX_TOKENS) {
      add('TOKEN_COUNT', `令牌数量最多 ${MAX_TOKENS} 个，当前为 ${rawTokens.length} 个`);
    }
    const tokenNames = new Map(); // 令牌名 -> 首次出现的下标
    rawTokens.forEach((tok, i) => {
      if (tok === null || typeof tok !== 'object' || Array.isArray(tok)) {
        add('BAD_TOKEN', `第 ${i + 1} 个令牌格式错误`, { type: 'token', index: i });
        return;
      }

      const label = `令牌「${typeof tok.name === 'string' && tok.name.trim() ? tok.name.trim() : `第 ${i + 1} 个`}」`;
      const name = typeof tok.name === 'string' ? tok.name.trim() : '';
      if (!TOKEN_NAME_RE.test(name)) {
        add('BAD_TOKEN_NAME', `第 ${i + 1} 个令牌名称非法：「${name || '（空）'}」，须匹配 /^[a-z][a-z0-9-]*$/（小写字母开头，仅含小写字母、数字与连字符）`, {
          type: 'token', index: i, field: 'name',
        });
      } else if (tokenNames.has(name)) {
        add('DUP_TOKEN_NAME', `令牌名称重复：「${name}」（第 ${tokenNames.get(name) + 1} 个与第 ${i + 1} 个）`, {
          type: 'token', index: i, field: 'name',
        });
      } else {
        tokenNames.set(name, i);
      }

      let target = null;
      const rawTarget = tok.target;
      if (rawTarget === null || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
        add('BAD_TOKEN_TARGET', `${label}缺少引用目标（须明确引用一个颜色或另一个令牌）`, {
          type: 'token', index: i, field: 'target',
        });
      } else if (rawTarget.kind === 'color') {
        const colorId = typeof rawTarget.colorId === 'number' && Number.isFinite(rawTarget.colorId)
          ? rawTarget.colorId : null;
        if (colorId === null) {
          add('BAD_TOKEN_TARGET', `${label}必须选择引用的颜色`, { type: 'token', index: i, field: 'target' });
        } else {
          target = { kind: 'color', colorId };
        }
      } else if (rawTarget.kind === 'token') {
        const ref = typeof rawTarget.token === 'string' ? rawTarget.token.trim() : '';
        if (!ref) {
          add('BAD_TOKEN_TARGET', `${label}必须选择引用的令牌`, { type: 'token', index: i, field: 'target' });
        } else {
          target = { kind: 'token', token: ref };
        }
      } else {
        add('BAD_TOKEN_TARGET', `${label}的引用类型非法：kind 须为 color 或 token`, {
          type: 'token', index: i, field: 'target',
        });
      }

      tokens.push({ name, target });
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, colors, constraints, tokens };
}

module.exports = { validateInput, MIN_COLORS, MAX_COLORS, MAX_ALTS, VALID_RATIOS, MAX_TOKENS, TOKEN_NAME_RE };
