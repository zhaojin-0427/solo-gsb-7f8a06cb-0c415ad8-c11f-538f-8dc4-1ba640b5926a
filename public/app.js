'use strict';

const MAX_COLORS = 8;
const MIN_COLORS = 2;
const ALT_SLOTS = 3;
const MAX_TOKENS = 12;
const TOKEN_NAME_RE = /^[a-z][a-z0-9-]*$/;

let colorSeq = 0;
let constraintSeq = 0;
let tokenSeq = 0;

const state = {
  colors: [
    { id: ++colorSeq, name: '品牌蓝', base: '#1D4ED8', alts: ['#1E40AF', '#1E3A8A', '#3B82F6'], locked: false },
    { id: ++colorSeq, name: '浅灰底', base: '#F8FAFC', alts: ['#F1F5F9', '#E2E8F0', '#FFFFFF'], locked: false },
  ],
  constraints: [
    { id: ++constraintSeq, aId: 1, bId: 2, ratio: '7' },
  ],
  // 语义色令牌：kind 'color' 用 colorId 引用颜色；kind 'token' 用令牌名引用令牌
  tokens: [],
};

// 最近一次求解成功的结果与当前色觉审查视图（normal / protanopia / deuteranopia）
let lastResult = null;
let currentView = 'normal';

// 截图配色核查状态（仅求解成功后可用；改动配色输入或重新求解时随 clearResult 清空）
// auditState: null | { status:'loading'|'error'|'ready', fileName, message?,
//   width, height, srcWidth, srcHeight, imageData, distances, validCount }
let auditState = null;
let auditTolerance = ScreenshotAudit.DEFAULT_TOLERANCE;
let auditView = 'original'; // 'original'（原图）| 'mask'（半透明偏离遮罩）

// ---------- 工具 ----------
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  });
  [].concat(children).forEach((child) => {
    if (child === null || child === undefined) return;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

function isValidHex(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

function findColor(id) {
  return state.colors.find((c) => c.id === Number(id));
}

// 前端近似亮度（仅用于色块文字黑白选择，不参与求解）
function pickTextColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const chans = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = [0.2126, 0.7152, 0.0722].reduce((sum, w, i) => {
    const cs = chans[i] / 255;
    return sum + w * (cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4));
  }, 0);
  return lum > 0.4 ? '#0B1220' : '#FFFFFF';
}

// ---------- 渲染：颜色 ----------
const colorsList = document.getElementById('colors-list');

function renderColors() {
  colorsList.innerHTML = '';
  state.colors.forEach((color, index) => {
    const card = el('div', { class: 'color-card', dataset: { cid: String(color.id) } });

    const top = el('div', { class: 'card-top' }, [
      el('span', { class: 'card-index' }, String(index + 1)),
      el('input', {
        class: 'name-input', type: 'text', maxlength: '30',
        placeholder: '颜色名称，如 品牌蓝', value: color.name, 'data-field': 'name',
      }),
      el('button', {
        class: 'btn btn-danger-ghost', type: 'button', 'data-action': 'remove-color',
        disabled: state.colors.length <= MIN_COLORS ? 'disabled' : undefined,
      }, '删除'),
    ]);
    card.appendChild(top);

    card.appendChild(makeCandidateRow('base', '基准色', color.base, 0));
    for (let j = 0; j < ALT_SLOTS; j += 1) {
      card.appendChild(makeCandidateRow('alt', `备选 ${j + 1}`, color.alts[j] || '', j));
    }

    const lockRow = el('label', { class: 'lock-row' }, [
      el('input', {
        type: 'checkbox', 'data-field': 'locked',
        ...(color.locked ? { checked: 'checked' } : {}),
      }),
      ' 锁定基准色（求解时不替换为备选）',
    ]);
    card.appendChild(lockRow);

    colorsList.appendChild(card);
    syncCardLock(card, color.locked);
  });

  document.getElementById('add-color-btn').disabled = state.colors.length >= MAX_COLORS;
  renderConstraintOptions();
  renderTokenTargets();
}

function makeCandidateRow(kind, label, value, altIndex) {
  const row = el('div', {
    class: 'field-row',
    dataset: { kind, ...(kind === 'alt' ? { altIndex: String(altIndex) } : {}) },
  }, [
    el('label', {}, label),
    el('input', { class: 'picker', type: 'color', 'data-field': 'picker', value: isValidHex(value) ? value : '#000000' }),
    el('input', {
      class: 'hex-input', type: 'text', maxlength: '7', placeholder: '#RRGGBB',
      value, 'data-field': 'hex', spellcheck: 'false', autocomplete: 'off',
    }),
  ]);
  if (!isValidHex(value) && value !== '') {
    row.querySelector('[data-field=hex]').classList.add('invalid-input');
  }
  return row;
}

function syncCardLock(card, locked) {
  card.querySelectorAll('.field-row[data-kind="alt"]').forEach((row) => {
    row.querySelector('[data-field=picker]').disabled = locked;
    row.querySelector('[data-field=hex]').disabled = locked;
  });
}

colorsList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="remove-color"]');
  if (!btn) return;
  const card = e.target.closest('.color-card');
  const id = Number(card.dataset.cid);
  state.colors = state.colors.filter((c) => c.id !== id);
  state.constraints.forEach((con) => {
    if (con.aId === id) con.aId = null;
    if (con.bId === id) con.bId = null;
  });
  clearResult();
  renderColors();
  renderConstraints();
});

colorsList.addEventListener('input', (e) => {
  const card = e.target.closest('.color-card');
  if (!card) return;
  const color = findColor(card.dataset.cid);
  const field = e.target.dataset.field;
  const row = e.target.closest('.field-row');

  clearResult();

  if (field === 'name') {
    color.name = e.target.value;
    return;
  }
  if (!row) return;

  const hexInput = row.querySelector('[data-field=hex]');
  const picker = row.querySelector('[data-field=picker]');
  const kind = row.dataset.kind;
  const setValue = (v) => {
    if (kind === 'base') color.base = v;
    else color.alts[Number(row.dataset.altIndex)] = v;
  };

  if (field === 'hex') {
    const v = e.target.value;
    setValue(v);
    if (isValidHex(v)) {
      hexInput.classList.remove('invalid-input');
      picker.value = v;
    } else if (v.trim() !== '') {
      hexInput.classList.add('invalid-input');
    } else {
      hexInput.classList.remove('invalid-input');
    }
  } else if (field === 'picker') {
    const v = e.target.value.toUpperCase();
    setValue(v);
    hexInput.value = v;
    hexInput.classList.remove('invalid-input');
  }
});

colorsList.addEventListener('change', (e) => {
  const card = e.target.closest('.color-card');
  if (!card) return;
  const color = findColor(card.dataset.cid);
  clearResult();
  if (e.target.dataset.field === 'locked') {
    color.locked = e.target.checked;
    syncCardLock(card, color.locked);
  }
  if (e.target.dataset.field === 'name') {
    renderConstraintOptions();
    renderTokenTargets();
  }
});

document.getElementById('add-color-btn').addEventListener('click', () => {
  if (state.colors.length >= MAX_COLORS) return;
  state.colors.push({
    id: ++colorSeq, name: '', base: '#000000',
    alts: ['', '', ''], locked: false,
  });
  clearResult();
  renderColors();
});

// ---------- 渲染：约束 ----------
const constraintsList = document.getElementById('constraints-list');

function renderConstraintOptions() {
  constraintsList.querySelectorAll('.constraint-row').forEach((row) => {
    const con = state.constraints.find((c) => c.id === Number(row.dataset.constraintId));
    if (!con) return;
    ['a', 'b'].forEach((side) => {
      const select = row.querySelector(`[data-side="${side}"]`);
      const current = con[`${side}Id`];
      select.innerHTML = '';
      select.appendChild(el('option', { value: '' }, '(请选择)'));
      state.colors.forEach((color, i) => {
        const label = `${i + 1}. ${color.name.trim() || '(未命名)'}`;
        const attrs = { value: String(color.id) };
        if (color.id === current) attrs.selected = 'selected';
        select.appendChild(el('option', attrs, label));
      });
    });
  });
}

function renderConstraints() {
  constraintsList.innerHTML = '';
  state.constraints.forEach((con) => {
    const row = el('div', { class: 'constraint-row', dataset: { constraintId: String(con.id) } }, [
      el('select', { 'data-side': 'a' }),
      el('span', { class: 'con-label' }, '与'),
      el('select', { 'data-side': 'b' }),
      el('span', { class: 'con-label' }, '文字对比度 ≥'),
      el('select', { 'data-side': 'ratio' }, [
        ['3', '3（AA 大字）'],
        ['4.5', '4.5（AA）'],
        ['7', '7（AAA）'],
      ].map(([value, text]) => el('option', {
        value,
        ...(con.ratio === value ? { selected: 'selected' } : {}),
      }, text))),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn btn-danger-ghost', type: 'button', 'data-action': 'remove-constraint' }, '删除'),
    ]);
    constraintsList.appendChild(row);
  });
  renderConstraintOptions();
}

constraintsList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="remove-constraint"]');
  if (!btn) return;
  const row = e.target.closest('.constraint-row');
  const id = Number(row.dataset.constraintId);
  state.constraints = state.constraints.filter((c) => c.id !== id);
  clearResult();
  renderConstraints();
});

constraintsList.addEventListener('change', (e) => {
  const row = e.target.closest('.constraint-row');
  if (!row) return;
  const con = state.constraints.find((c) => c.id === Number(row.dataset.constraintId));
  const side = e.target.dataset.side;
  clearResult();
  if (side === 'a' || side === 'b') {
    con[`${side}Id`] = e.target.value === '' ? null : Number(e.target.value);
  } else if (side === 'ratio') {
    con.ratio = e.target.value;
  }
});

document.getElementById('add-constraint-btn').addEventListener('click', () => {
  state.constraints.push({ id: ++constraintSeq, aId: null, bId: null, ratio: '4.5' });
  clearResult();
  renderConstraints();
});

// ---------- 渲染：语义色令牌 ----------
const tokensList = document.getElementById('tokens-list');

// 目标下拉：按 kind 列出颜色（按录入顺序编号）或全部令牌名（允许前向引用与自引用，
// 引用不存在 / 目标颜色已删除 / 循环在求解后的解析结果中标出）
function tokenTargetSelect(token) {
  const select = el('select', { 'data-field': 'token-target' });
  if (token.kind === 'color') {
    select.appendChild(el('option', { value: '' }, '(请选择颜色)'));
    let found = token.colorId === null;
    state.colors.forEach((color, i) => {
      const attrs = { value: String(color.id) };
      if (color.id === token.colorId) {
        attrs.selected = 'selected';
        found = true;
      }
      select.appendChild(el('option', attrs, `${i + 1}. ${color.name.trim() || '(未命名)'}`));
    });
    if (!found) {
      select.appendChild(el('option', { value: String(token.colorId), selected: 'selected' }, '（已删除的颜色）'));
    }
  } else {
    select.appendChild(el('option', { value: '' }, '(请选择令牌)'));
    let found = token.token === '';
    state.tokens.forEach((t) => {
      const name = t.name.trim();
      if (!name) return;
      const attrs = { value: name };
      if (name === token.token) {
        attrs.selected = 'selected';
        found = true;
      }
      select.appendChild(el('option', attrs, name));
    });
    if (!found) {
      select.appendChild(el('option', { value: token.token, selected: 'selected' }, `（不存在的令牌：${token.token}）`));
    }
  }
  return select;
}

function renderTokens() {
  tokensList.innerHTML = '';
  state.tokens.forEach((token) => {
    const row = el('div', { class: 'token-row', dataset: { tokenId: String(token.id) } }, [
      el('input', {
        class: 'token-name-input', type: 'text', maxlength: '40',
        placeholder: '令牌名，如 brand-primary', value: token.name,
        'data-field': 'token-name', spellcheck: 'false', autocomplete: 'off',
      }),
      el('select', { 'data-field': 'token-kind' }, [
        el('option', { value: 'color', ...(token.kind === 'color' ? { selected: 'selected' } : {}) }, '引用颜色'),
        el('option', { value: 'token', ...(token.kind === 'token' ? { selected: 'selected' } : {}) }, '引用令牌'),
      ]),
      tokenTargetSelect(token),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn btn-danger-ghost', type: 'button', 'data-action': 'remove-token' }, '删除'),
    ]);
    tokensList.appendChild(row);
  });
  document.getElementById('add-token-btn').disabled = state.tokens.length >= MAX_TOKENS;
}

// 颜色增删/改名或令牌改名后，刷新各行目标下拉的选项（保留当前选中值）
function renderTokenTargets() {
  tokensList.querySelectorAll('.token-row').forEach((row) => {
    const token = state.tokens.find((t) => t.id === Number(row.dataset.tokenId));
    if (!token) return;
    const old = row.querySelector('[data-field=token-target]');
    if (old) old.replaceWith(tokenTargetSelect(token));
  });
}

tokensList.addEventListener('input', (e) => {
  const row = e.target.closest('.token-row');
  if (!row) return;
  const token = state.tokens.find((t) => t.id === Number(row.dataset.tokenId));
  if (!token) return;
  clearResult();
  if (e.target.dataset.field === 'token-name') {
    token.name = e.target.value;
  }
});

tokensList.addEventListener('change', (e) => {
  const row = e.target.closest('.token-row');
  if (!row) return;
  const token = state.tokens.find((t) => t.id === Number(row.dataset.tokenId));
  if (!token) return;
  clearResult();
  const field = e.target.dataset.field;
  if (field === 'token-kind') {
    token.kind = e.target.value;
    if (token.kind === 'color') token.colorId = null;
    else token.token = '';
    renderTokens();
  } else if (field === 'token-target') {
    if (token.kind === 'color') token.colorId = e.target.value === '' ? null : Number(e.target.value);
    else token.token = e.target.value;
  } else if (field === 'token-name') {
    renderTokenTargets(); // 其他行可能按名称引用本令牌
  }
});

tokensList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="remove-token"]');
  if (!btn) return;
  const row = e.target.closest('.token-row');
  const id = Number(row.dataset.tokenId);
  state.tokens = state.tokens.filter((t) => t.id !== id);
  clearResult();
  renderTokens();
});

document.getElementById('add-token-btn').addEventListener('click', () => {
  if (state.tokens.length >= MAX_TOKENS) return;
  state.tokens.push({ id: ++tokenSeq, name: '', kind: 'color', colorId: null, token: '' });
  clearResult();
  renderTokens();
});

// ---------- 错误展示 ----------
const errorPanel = document.getElementById('error-panel');
const errorList = document.getElementById('error-list');

function clearErrors() {
  errorPanel.hidden = true;
  errorList.innerHTML = '';
  document.querySelectorAll('.invalid, .invalid-input').forEach((node) => {
    node.classList.remove('invalid');
    if (node.matches('input, select')) node.classList.remove('invalid-input');
  });
}

function showErrors(errors, submittedConstraintIds, submittedTokenIds) {
  errors.forEach((err) => {
    errorList.appendChild(el('li', {}, err.message || '未知错误'));
    markRef(err.ref, submittedConstraintIds, submittedTokenIds);
  });
  errorPanel.hidden = false;
  errorPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function markRef(ref, submittedConstraintIds, submittedTokenIds) {
  if (!ref) return;
  if (ref.type === 'color') {
    const color = state.colors[ref.index];
    if (color) {
      const card = colorsList.querySelector(`[data-cid="${color.id}"]`);
      if (card) card.classList.add('invalid');
    }
  } else if (ref.type === 'candidate') {
    const color = state.colors[ref.colorIndex];
    if (!color) return;
    const card = colorsList.querySelector(`[data-cid="${color.id}"]`);
    if (!card) return;
    card.classList.add('invalid');
    if (ref.kind === 'base') {
      const input = card.querySelector('.field-row[data-kind="base"] [data-field=hex]');
      if (input) input.classList.add('invalid-input');
    } else {
      const rows = card.querySelectorAll('.field-row[data-kind="alt"]');
      const row = rows[ref.altIndex];
      if (row) row.querySelector('[data-field=hex]').classList.add('invalid-input');
    }
  } else if (ref.type === 'constraint') {
    const rowId = submittedConstraintIds ? submittedConstraintIds[ref.index] : null;
    const row = constraintsList.querySelector(`[data-constraint-id="${rowId}"]`);
    if (row) {
      row.classList.add('invalid');
      if (ref.field === 'a' || ref.field === 'b') {
        row.querySelector(`[data-side="${ref.field}"]`).classList.add('invalid-input');
      } else if (ref.field === 'minRatio') {
        row.querySelector('[data-side=ratio]').classList.add('invalid-input');
      }
    }
  } else if (ref.type === 'token') {
    const rowId = submittedTokenIds ? submittedTokenIds[ref.index] : null;
    const row = tokensList.querySelector(`[data-token-id="${rowId}"]`);
    if (row) {
      row.classList.add('invalid');
      if (ref.field === 'name') {
        row.querySelector('[data-field=token-name]').classList.add('invalid-input');
      } else if (ref.field === 'target') {
        row.querySelector('[data-field=token-target]').classList.add('invalid-input');
      }
    }
  }
}

// ---------- 组装请求与客户端预检 ----------
function collectPayload() {
  const colors = state.colors.map((c) => ({
    id: c.id,
    name: c.name.trim(),
    base: c.base.trim(),
    alternatives: c.alts.map((s) => (s || '').trim()).filter(Boolean),
    locked: c.locked,
  }));

  const submittedConstraintIds = [];
  const constraints = [];
  state.constraints.forEach((con) => {
    if (con.aId === null && con.bId === null) return; // 完全空白的一行忽略
    const a = con.aId !== null ? findColor(con.aId) : null;
    const b = con.bId !== null ? findColor(con.bId) : null;
    submittedConstraintIds.push(con.id);
    constraints.push({
      a: a ? a.name.trim() : '',
      b: b ? b.name.trim() : '',
      minRatio: Number(con.ratio),
    });
  });

  const submittedTokenIds = [];
  const tokens = [];
  state.tokens.forEach((t) => {
    const name = t.name.trim();
    const targetEmpty = t.kind === 'color' ? t.colorId === null : t.token.trim() === '';
    if (!name && targetEmpty) return; // 完全空白的一行忽略
    submittedTokenIds.push(t.id);
    tokens.push({
      name,
      target: t.kind === 'color'
        ? { kind: 'color', colorId: t.colorId }
        : { kind: 'token', token: t.token.trim() },
    });
  });

  return { payload: { colors, constraints, tokens }, submittedConstraintIds, submittedTokenIds };
}

function clientValidate(payload) {
  const errors = [];
  const names = new Set();
  payload.colors.forEach((c, i) => {
    if (!c.name) {
      errors.push({ message: `第 ${i + 1} 个颜色没有名称`, ref: { type: 'color', index: i } });
    } else if (names.has(c.name)) {
      errors.push({ message: `颜色名称重复：「${c.name}」`, ref: { type: 'color', index: i } });
    } else {
      names.add(c.name);
    }
    if (!isValidHex(c.base)) {
      errors.push({ message: `「${c.name || `第 ${i + 1} 个颜色`}」的基准色非法：${c.base || '（空）'}，须为 #RRGGBB`,
        ref: { type: 'candidate', colorIndex: i, kind: 'base' } });
    }
    c.alternatives.forEach((alt, j) => {
      if (!isValidHex(alt)) {
        errors.push({ message: `「${c.name || `第 ${i + 1} 个颜色`}」的备选色 ${j + 1} 非法：${alt}，须为 #RRGGBB`,
          ref: { type: 'candidate', colorIndex: i, kind: 'alt', altIndex: j } });
      }
    });
  });
  payload.constraints.forEach((con, i) => {
    if (!con.a || !names.has(con.a) || !con.b || !names.has(con.b)) {
      errors.push({ message: `第 ${i + 1} 条约束未选择两个已命名颜色`, ref: { type: 'constraint', index: i } });
    } else if (con.a === con.b) {
      errors.push({ message: `第 ${i + 1} 条约束是自配对：「${con.a}」不能与自身配对`,
        ref: { type: 'constraint', index: i } });
    }
  });
  // 令牌结构预检（引用目标是否存在、是否成环由服务端在求解成功后解析判定）
  const tokenNames = new Set();
  payload.tokens.forEach((t, i) => {
    const label = t.name || `第 ${i + 1} 个`;
    if (!TOKEN_NAME_RE.test(t.name)) {
      errors.push({ message: `第 ${i + 1} 个令牌名称非法：「${t.name || '（空）'}」，须匹配 /^[a-z][a-z0-9-]*$/（小写字母开头，仅含小写字母、数字与连字符）`,
        ref: { type: 'token', index: i, field: 'name' } });
    } else if (tokenNames.has(t.name)) {
      errors.push({ message: `令牌名称重复：「${t.name}」`, ref: { type: 'token', index: i, field: 'name' } });
    } else {
      tokenNames.add(t.name);
    }
    if (t.target.kind === 'color' && t.target.colorId === null) {
      errors.push({ message: `令牌「${label}」未选择引用的颜色`, ref: { type: 'token', index: i, field: 'target' } });
    }
    if (t.target.kind === 'token' && !t.target.token) {
      errors.push({ message: `令牌「${label}」未选择引用的令牌`, ref: { type: 'token', index: i, field: 'target' } });
    }
  });
  return errors;
}

// ---------- 结果渲染 ----------
const resultPanel = document.getElementById('result-panel');

// 编辑颜色或约束时清除旧审查结果（旧方案已不再对应当前输入），同时清除旧的截图核查
function clearResult() {
  lastResult = null;
  auditState = null;
  auditTolerance = ScreenshotAudit.DEFAULT_TOLERANCE;
  auditView = 'original';
  resultPanel.hidden = true;
  resultPanel.replaceChildren();
}

function renderInfeasible(result) {
  lastResult = null;
  const tips = [
    '解除部分颜色的基准色锁定，或为相关颜色增加备选色；',
    '降低对比度下限（如 7 → 4.5 → 3）；',
    '删除或调整无法同时满足的约束对。',
  ];
  resultPanel.replaceChildren(
    el('div', { class: 'result-banner fail' }, [
      el('strong', {}, '无解：当前候选组合中没有任何方案能满足全部约束。'),
      el('ul', { class: 'result-tips' }, tips.map((t) => el('li', {}, t))),
    ]),
  );
  resultPanel.hidden = false;
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderFeasible(result) {
  lastResult = result;
  paintResult();
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 仅在切换色觉视图时重绘，不重置滚动位置
function paintResult() {
  if (!lastResult) return;
  const result = lastResult;

  const banner = el('div', { class: 'result-banner ok' }, [
    el('strong', {}, '已找到最优方案 ✓'),
    ` 共替换 ${result.summary.diffCount} 个颜色，RGB 通道绝对差之和 ${result.summary.channelDistance}。`,
  ]);

  let review = null;
  try {
    review = ColorVision.pairReview(result.picks.map((pick) => ({ name: pick.name, value: pick.value })), currentView);
  } catch (err) {
    review = ColorVision.pairReview(result.picks.map((pick) => ({ name: pick.name, value: pick.value })), 'normal');
    currentView = 'normal';
  }
  const simByIndex = new Map(review.items.map((item, i) => [i, item]));

  const viewSwitch = el('div', { class: 'vision-switch', role: 'group', 'aria-label': '色觉视图' },
    Object.values(ColorVision.VIEWS).map((def) => el('button', {
      type: 'button',
      class: `vision-btn ${def.key === currentView ? 'active' : ''}`,
      'data-view': def.key,
      'aria-pressed': def.key === currentView ? 'true' : 'false',
    }, def.label)),
  );

  const swatchHead = el('div', { class: 'result-head' }, [
    el('h3', {}, '选用色块'),
    viewSwitch,
  ]);

  const swatches = el('div', { class: 'swatches' }, result.picks.map((pick, i) => {
    const sim = simByIndex.get(i);
    const textColor = pickTextColor(sim.simulated);
    const badges = [];
    if (pick.locked) badges.push(el('span', { class: 'badge lock' }, '已锁定'));
    if (pick.changed) badges.push(el('span', { class: 'badge changed' }, '已替换'));
    if (!pick.changed && !pick.locked) badges.push(el('span', { class: 'badge base' }, '基准色'));

    const colorLines = [el('div', { class: 'swatch-hex' }, sim.simulated)];
    if (currentView !== 'normal') {
      colorLines.push(el('div', { class: 'swatch-sim' }, [`原色 ${sim.original}`]));
    }

    return el('div', { class: 'swatch' }, [
      el('div', {
        class: 'swatch-block',
        style: `background:${sim.simulated};color:${textColor}`,
      }, [
        el('div', { class: 'swatch-name' }, `${i + 1}. ${pick.name}`),
        ...colorLines,
      ]),
      el('div', { class: 'swatch-meta' }, [
        el('span', {}, pick.choiceIndex === 0 ? '候选 0（基准）' : `候选 ${pick.choiceIndex}（备选）`),
        el('span', {}, badges),
      ]),
    ]);
  }));

  const ratioList = el('ul', { class: 'ratio-list' }, result.constraints.map((con) => el(
    'li',
    { class: `ratio-item ${con.pass ? 'pass' : 'fail'}` },
    [
      el('span', { class: 'pair' }, `${con.a} ↔ ${con.b}`),
      el('span', {}, `要求 ≥ ${con.minRatio}`),
      el('span', { class: 'actual' }, `实际 ${con.actual.toFixed(2)}:1`),
      el('span', { class: 'spacer' }),
      el('span', { class: 'mark' }, con.pass ? '✓ 满足' : '✗ 不满足'),
    ],
  )));

  const cssText = `:root {\n${result.summary.cssVariables.split('\n').map((l) => `  ${l}`).join('\n')}\n}`;
  const cssWrap = el('div', { class: 'css-wrap' }, [
    el('pre', { class: 'css' }, cssText),
    el('button', {
      class: 'btn btn-secondary copy-btn', type: 'button',
      onclick: () => copyText(cssText),
    }, '复制'),
  ]);

  resultPanel.replaceChildren(
    banner,
    el('div', { class: 'panel result-block' }, [
      swatchHead,
      swatches,
      buildReviewBlock(review),
      el('h3', {}, '各约束实际对比度'),
      ratioList,
      el('h3', {}, 'CSS 变量（按颜色录入顺序编号）'),
      cssWrap,
      buildTokenBlock(result.tokens),
      buildAuditBlock(),
    ]),
  );
  resultPanel.hidden = false;
}

// 语义色令牌解析结果：逐项展示令牌名、色值与完整引用链；
// 存在解析错误时标出错误令牌及路径，并禁用复制（不完整的语义声明不可复制）
function buildTokenBlock(tokens) {
  if (!tokens || !Array.isArray(tokens.items) || tokens.items.length === 0) return null;
  const hasError = tokens.errorCount > 0;

  const rows = tokens.items.map((item) => {
    if (item.ok) {
      return el('tr', {}, [
        el('td', {}, el('code', { class: 'token-name' }, item.name)),
        el('td', {}, el('span', { class: 'mini-chip-wrap' }, [
          el('span', { class: 'mini-chip', style: `background:${item.value}` }),
          el('code', {}, item.value),
        ])),
        el('td', { class: 'token-chain' }, item.chain.join(' → ')),
        el('td', {}, el('span', { class: 'badge distinguishable' }, '已解析')),
      ]);
    }
    return el('tr', { class: 'confusable' }, [
      el('td', {}, el('code', { class: 'token-name' }, item.name)),
      el('td', { class: 'token-error-msg' }, `✗ ${item.message}`),
      el('td', { class: 'token-chain' }, item.chain.join(' → ')),
      el('td', {}, el('span', { class: 'badge confusable' }, '解析失败')),
    ]);
  });

  const note = hasError
    ? `有 ${tokens.errorCount} 个令牌无法解析，其声明已被省略；存在解析错误时禁止复制不完整的语义声明，请修复后重新求解。`
    : `全部 ${tokens.okCount} 个令牌均已沿引用链解析到最终颜色，可复制完整的语义声明。`;

  const cssText = tokens.css
    ? `:root {\n${tokens.css.split('\n').map((l) => `  ${l}`).join('\n')}\n}`
    : '（没有可生成的声明）';

  return el('div', { class: 'token-result' }, [
    el('h3', {}, '语义色令牌（按引用链解析）'),
    el('div', { class: 'review-table-wrap' }, [
      el('table', { class: 'review-table token-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, '令牌'),
          el('th', {}, '色值'),
          el('th', {}, '引用链'),
          el('th', {}, '状态'),
        ])),
        el('tbody', {}, rows),
      ]),
    ]),
    el('p', { class: `review-summary ${hasError ? 'has-risk' : ''}` }, note),
    el('div', { class: 'css-wrap' }, [
      el('pre', { class: 'css' }, cssText),
      el('button', {
        class: 'btn btn-secondary copy-btn', type: 'button',
        ...(hasError || !tokens.css ? { disabled: 'disabled' } : {}),
        onclick: () => { if (!hasError && tokens.css) copyText(cssText); },
      }, '复制'),
    ]),
  ]);
}

function chipCell(party, showSimulated) {
  const chips = [
    el('span', { class: 'mini-chip-wrap' }, [
      el('span', { class: 'mini-chip', style: `background:${party.original}` }),
      el('code', {}, party.original),
    ]),
  ];
  if (showSimulated) {
    chips.push(el('span', { class: 'mini-chip-wrap sim' }, [
      el('span', { class: 'mini-chip arrow-chip' }, '→'),
      el('span', { class: 'mini-chip', style: `background:${party.simulated}` }),
      el('code', {}, party.simulated),
    ]));
  }
  return el('div', { class: 'pair-party' }, [
    el('div', { class: 'pair-name' }, party.name),
    el('div', { class: 'pair-colors' }, chips),
  ]);
}

function buildReviewBlock(review) {
  const viewLabel = ColorVision.VIEWS[review.view].label;
  const chipHeader = review.view === 'normal' ? '原色' : '原色 → 模拟色';
  const confusableCount = review.pairs.filter((p) => p.confusable).length;
  const summary = confusableCount > 0
    ? `${viewLabel}视图下有 ${confusableCount} 对颜色的 ΔE76 小于 ${ColorVision.CONFUSABLE_THRESHOLD}，可能难以区分（按距离升序排列，已标红）。`
    : `${viewLabel}视图下全部配对的 ΔE76 均 ≥ ${ColorVision.CONFUSABLE_THRESHOLD}，未发现易混淆配对。`;

  const rows = review.pairs.map((pair) => el('tr', { class: pair.confusable ? 'confusable' : '' }, [
    el('td', {}, chipCell(pair.a, review.view !== 'normal')),
    el('td', { class: 'pair-arrow' }, '↔'),
    el('td', {}, chipCell(pair.b, review.view !== 'normal')),
    el('td', { class: 'pair-distance' }, ColorVision.formatDistance(pair.distance)),
    el('td', { class: 'pair-mark' }, pair.confusable
      ? el('span', { class: 'badge confusable' }, '易混淆')
      : el('span', { class: 'badge distinguishable' }, '可区分')),
  ]));

  return el('div', { class: 'vision-review' }, [
    el('h3', {}, '色觉辨识审查'),
    el('p', { class: 'hint review-note' },
      '将 sRGB 线性化后按 Machado（2009）100% 红色盲/绿色盲矩阵模拟、裁剪到 [0,1] 并重新编码 sRGB；'
      + `再以 D65 为白点计算 CIE Lab ΔE76，未舍入距离小于 ${ColorVision.CONFUSABLE_THRESHOLD} 标记为易混淆。`
      + '该阈值只是辨识风险提示，不代表医学诊断或通过标准。'),
    el('p', { class: `review-summary ${confusableCount > 0 ? 'has-risk' : ''}` }, summary),
    el('div', { class: 'review-table-wrap' }, [
      el('table', { class: 'review-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, `颜色 A（${chipHeader}）`),
          el('th', {}),
          el('th', {}, `颜色 B（${chipHeader}）`),
          el('th', {}, 'ΔE76'),
          el('th', {}, '判定'),
        ])),
        el('tbody', {}, rows),
      ]),
    ]),
  ]);
}

// ---------- 截图配色核查 ----------
// 偏离遮罩的叠加颜色与透明度（半透明红色，叠加在缩放后的原图上）
const MASK_COLOR = [225, 29, 72];
const MASK_ALPHA = 0.55;

function buildAuditBlock() {
  const container = el('div', { class: 'audit-block', id: 'audit-block' });
  renderAudit(container);
  return container;
}

// 由 auditState 重建整个核查区块（求解成功、切换色觉视图后随 paintResult 重绘）
function renderAudit(container) {
  const paletteChips = el('div', { class: 'audit-palette' }, [
    el('span', { class: 'audit-palette-label' }, `对照色板（本次选中的 ${lastResult.picks.length} 个颜色）：`),
    ...lastResult.picks.map((pick) => el('span', { class: 'mini-chip-wrap' }, [
      el('span', { class: 'mini-chip', style: `background:${pick.value}` }),
      el('code', {}, pick.value),
    ])),
  ]);

  const fileInput = el('input', {
    class: 'audit-file', type: 'file', accept: 'image/png,image/jpeg',
    'aria-label': '选择 PNG 或 JPEG 截图',
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) loadAuditImage(file);
    fileInput.value = ''; // 允许再次选择同一文件
  });

  const toleranceValue = el('span', { class: 'audit-tolerance-value' }, String(auditTolerance));
  const slider = el('input', {
    class: 'audit-tolerance', type: 'range',
    min: String(ScreenshotAudit.TOLERANCE_MIN),
    max: String(ScreenshotAudit.TOLERANCE_MAX),
    step: '1', value: String(auditTolerance),
    'aria-label': '偏离容差（ΔE76，5～40）',
  });
  slider.addEventListener('input', () => {
    auditTolerance = Number(slider.value);
    toleranceValue.textContent = String(auditTolerance);
    if (auditState && auditState.status === 'ready') renderAuditResults();
  });

  container.replaceChildren(
    el('h3', {}, '截图配色核查'),
    el('p', { class: 'hint review-note' },
      '选取本地 PNG/JPEG 截图，仅在浏览器内解码，图片不会上传。'
      + `保持宽高比把最长边缩至 ${ScreenshotAudit.MAX_SIDE} 像素（不足则不放大），`
      + '仅统计完全不透明（alpha = 255）的像素；像素与本次选中色值均转换为 D65 CIE Lab，'
      + '逐像素取最近色的 ΔE76，未舍入距离大于容差'
      + `（${ScreenshotAudit.TOLERANCE_MIN}～${ScreenshotAudit.TOLERANCE_MAX}，默认 ${ScreenshotAudit.DEFAULT_TOLERANCE}）即判为偏离。`),
    paletteChips,
    el('div', { class: 'audit-controls' }, [
      fileInput,
      el('div', { class: 'audit-tolerance-row' }, [
        el('label', { class: 'audit-tolerance-label' }, '容差 ΔE76'),
        slider,
        toleranceValue,
      ]),
    ]),
    el('div', { id: 'audit-results' }),
  );
  renderAuditResults();
}

// 只重绘结果区（加载状态 / 错误提示 / 统计与画布），不动文件选择与容差控件
function renderAuditResults() {
  const container = document.getElementById('audit-results');
  if (!container) return;

  if (!auditState) {
    container.replaceChildren(el('p', { class: 'hint audit-status' },
      '尚未选择图片。图片仅在本地解码，不会上传。'));
    return;
  }
  if (auditState.status === 'loading') {
    container.replaceChildren(el('p', { class: 'hint audit-status' },
      `正在解码「${auditState.fileName}」并统计像素…`));
    return;
  }
  if (auditState.status === 'error') {
    container.replaceChildren(el('div', { class: 'audit-error' }, auditState.message));
    return;
  }

  const summary = ScreenshotAudit.summarizeDeviation(auditState.distances, auditTolerance);
  const total = auditState.width * auditState.height;
  const scaled = auditState.srcWidth !== auditState.width || auditState.srcHeight !== auditState.height;
  const scaleNote = scaled
    ? `原图 ${auditState.srcWidth}×${auditState.srcHeight}，已保持宽高比缩至 ${auditState.width}×${auditState.height}。`
    : `图片 ${auditState.width}×${auditState.height}，最长边未超过 ${ScreenshotAudit.MAX_SIDE} 像素，按原尺寸统计。`;
  const pct = (summary.deviationRatio * 100).toFixed(2);

  const viewSwitch = el('div', { class: 'vision-switch', role: 'group', 'aria-label': '核查视图' },
    [['original', '原图'], ['mask', '偏离遮罩']].map(([key, label]) => el('button', {
      type: 'button',
      class: `vision-btn ${auditView === key ? 'active' : ''}`,
      'data-audit-view': key,
      'aria-pressed': auditView === key ? 'true' : 'false',
    }, label)));

  container.replaceChildren(
    el('p', { class: 'hint audit-status' }, `文件：${auditState.fileName}。${scaleNote}`),
    el('p', { class: `review-summary ${summary.deviantPixels > 0 ? 'has-risk' : ''}` },
      `有效像素 ${summary.validPixels} / ${total}（完全不透明）；`
      + `偏离 ${summary.deviantPixels} 像素，偏离比例 ${pct}%`
      + `（容差 ΔE76 = ${auditTolerance}，未舍入最近色距离大于容差判为偏离）。`),
    el('div', { class: 'audit-canvas-head' }, [viewSwitch]),
    renderAuditCanvas(summary),
    el('p', { class: 'hint audit-mask-note' }, auditView === 'mask'
      ? '偏离遮罩：偏离像素以半透明红色叠加显示；透明像素不参与统计。'
      : '当前为缩放后的原图；切换到「偏离遮罩」查看偏离像素的位置。'),
  );
}

function renderAuditCanvas(summary) {
  const { imageData } = auditState;
  const canvas = el('canvas', {
    class: 'audit-canvas',
    width: String(auditState.width),
    height: String(auditState.height),
  });
  const ctx = canvas.getContext('2d');
  if (auditView === 'original') {
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }
  // 偏离遮罩：原图像素与半透明红色按 MASK_ALPHA 混合
  const composited = new ImageData(
    new Uint8ClampedArray(imageData.data), auditState.width, auditState.height);
  const d = composited.data;
  for (let i = 0; i < summary.deviant.length; i += 1) {
    if (!summary.deviant[i]) continue;
    const o = i * 4;
    d[o] = Math.round(d[o] * (1 - MASK_ALPHA) + MASK_COLOR[0] * MASK_ALPHA);
    d[o + 1] = Math.round(d[o + 1] * (1 - MASK_ALPHA) + MASK_COLOR[1] * MASK_ALPHA);
    d[o + 2] = Math.round(d[o + 2] * (1 - MASK_ALPHA) + MASK_COLOR[2] * MASK_ALPHA);
    d[o + 3] = 255;
  }
  ctx.putImageData(composited, 0, 0);
  return canvas;
}

function readHeadBytes(file, count) {
  const blob = file.slice(0, count);
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsArrayBuffer(blob);
  });
}

function decodeWithImgElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
    img.src = url;
  });
}

async function decodeImageFile(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      return decodeWithImgElement(file); // 退化到 <img> 再试一次
    }
  }
  return decodeWithImgElement(file);
}

async function loadAuditImage(file) {
  if (!lastResult) return;
  auditView = 'original';
  auditState = { status: 'loading', fileName: file.name };
  renderAuditResults();

  const fail = (message) => {
    auditState = { status: 'error', fileName: file.name, message };
    renderAuditResults();
  };

  try {
    const head = await readHeadBytes(file, 8);
    if (!ScreenshotAudit.sniffImageFormat(head)) {
      fail(`文件格式不支持：「${file.name}」不是 PNG 或 JPEG 图片（按文件头魔数判定，与扩展名无关）。`);
      return;
    }

    let source;
    try {
      source = await decodeImageFile(file);
    } catch {
      fail(`图片解码失败：「${file.name}」可能已损坏，或不是有效的 PNG/JPEG 文件。`);
      return;
    }

    const srcWidth = source.naturalWidth || source.width;
    const srcHeight = source.naturalHeight || source.height;
    if (!srcWidth || !srcHeight) {
      fail(`图片解码失败：「${file.name}」的像素尺寸为空。`);
      return;
    }

    const { width, height } = ScreenshotAudit.scaledSize(srcWidth, srcHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    if (typeof source.close === 'function') source.close();

    const imageData = ctx.getImageData(0, 0, width, height);
    const paletteLabs = lastResult.picks.map((pick) => ColorVision.hexToLab(pick.value));
    const { validCount, distances } = ScreenshotAudit.pixelDeltaE(imageData.data, paletteLabs);
    if (validCount === 0) {
      fail(`「${file.name}」中没有完全不透明的像素（有效像素为 0），无法进行核查。`);
      return;
    }

    auditState = {
      status: 'ready', fileName: file.name,
      width, height, srcWidth, srcHeight,
      imageData, distances, validCount,
    };
    renderAuditResults();
  } catch (err) {
    fail(`截图核查失败：${err && err.message ? err.message : '未知错误'}`);
  }
}

resultPanel.addEventListener('click', (e) => {
  const btn = e.target.closest('.vision-btn');
  if (!btn) return;
  if (btn.dataset.auditView) {
    auditView = btn.dataset.auditView;
    renderAuditResults();
    return;
  }
  currentView = btn.dataset.view;
  paintResult();
});

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('已复制到剪贴板');
  } catch {
    toast('复制失败，请手动选择文本复制');
  }
}

const toastNode = el('div', { class: 'toast' });
document.body.appendChild(toastNode);
let toastTimer = null;
function toast(msg) {
  toastNode.textContent = msg;
  toastNode.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNode.classList.remove('show'), 1800);
}

// ---------- 求解 ----------
document.getElementById('solve-btn').addEventListener('click', async () => {
  clearErrors();
  clearResult();

  const { payload, submittedConstraintIds, submittedTokenIds } = collectPayload();
  const localErrors = clientValidate(payload);
  if (localErrors.length > 0) {
    showErrors(localErrors, submittedConstraintIds, submittedTokenIds);
    return;
  }

  let data;
  try {
    const resp = await fetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    data = await resp.json();
    if (!resp.ok || !data.ok) {
      showErrors(data.errors || [{ message: `请求失败（HTTP ${resp.status}）` }], submittedConstraintIds, submittedTokenIds);
      return;
    }
  } catch (err) {
    showErrors([{ message: `无法连接求解服务：${err.message}` }], submittedConstraintIds, submittedTokenIds);
    return;
  }

  if (data.result.feasible) renderFeasible(data.result);
  else renderInfeasible(data.result);
});

// ---------- 初始化 ----------
renderColors();
renderConstraints();
renderTokens();
