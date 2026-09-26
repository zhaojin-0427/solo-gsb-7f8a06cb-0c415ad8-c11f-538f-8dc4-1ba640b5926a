'use strict';

const path = require('path');
const express = require('express');
const { validateInput } = require('./src/validate');
const { solve } = require('./src/solver');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 色觉模拟模块与 Node 端共用同一份源码（src/colorvision.js 为 UMD 格式）
app.get('/colorvision.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'src', 'colorvision.js'));
});

// 截图配色核查模块同样前后端共用（src/screenshot.js 为 UMD 格式）
app.get('/screenshot.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'src', 'screenshot.js'));
});

// 内联 favicon，避免 404
app.get('/favicon.ico', (req, res) => {
  res.redirect('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Crect width=%2216%22 height=%2216%22 rx=%223%22 fill=%22%231d4ed8%22/%3E%3C/svg%3E');
});

app.post('/api/solve', (req, res) => {
  const validated = validateInput(req.body);
  if (!validated.ok) {
    return res.status(400).json({ ok: false, errors: validated.errors });
  }
  const result = solve(validated);
  return res.json({ ok: true, result });
});

// JSON 解析错误兜底
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, errors: [{ code: 'BAD_JSON', message: '请求体不是合法的 JSON' }] });
  }
  return next(err);
});

app.listen(PORT, () => {
  console.log(`配色工作台已启动: http://localhost:${PORT}`);
});
