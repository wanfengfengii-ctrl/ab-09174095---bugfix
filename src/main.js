/**
 * main.js —— 画布编辑器与校核交互。
 * 精确判定全部来自 geometry.js（BigInt 有理数连续判定），本文件只负责展示与交互。
 */
import {
  analyzePlan,
  sightBlockedAtPoint,
  hpFromNumber,
  rectFromNumber,
  ratToNumber,
  hpToNumber,
  cameraAtTime,
} from './geometry.js';
import { validatePlan, sortedKeyframes, LIMITS } from './state.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#view');
const ctx = canvas.getContext('2d');
const W = 980;
const H = 620;

/* ---------------- 状态 ---------------- */

let nextId = 1;
const nid = () => nextId++;

function defaultState() {
  return {
    keyframes: [
      { id: nid(), t: 0, x: 80, y: 120 },
      { id: nid(), t: 6, x: 620, y: 120 },
      { id: nid(), t: 10, x: 880, y: 320 },
    ],
    markers: [
      { id: nid(), x: 360, y: 420 },
      { id: nid(), x: 700, y: 90 },
      { id: nid(), x: 140, y: 500 },
    ],
    rects: [
      { id: nid(), x: 300, y: 200, w: 120, h: 100 },
      { id: nid(), x: 660, y: 360, w: 150, h: 110 },
    ],
  };
}

let state = defaultState();
let validation = { ok: true, errors: [], warnings: [] };
let result = null; // analyzePlan 的精确判定结果
let verifiedOnce = false; // 首次点击「校核」后，编辑会自动复核
let viewTime = null; // 时间轴当前时刻（null = 不显示）
let playing = false;
let drag = null;

const kfsSorted = () => sortedKeyframes(state);
const kfLabels = () => new Map(kfsSorted().map((k, i) => [k.id, `K${i + 1}`]));
const markerLabels = () => new Map(state.markers.map((m, i) => [m.id, `M${i + 1}`]));
const rectLabels = () => new Map(state.rects.map((r, i) => [r.id, `R${i + 1}`]));

/**
 * 自适应有效数字展示：保留足以区分非零小量（含亚微秒时刻）的精度，
 * 而不是固定小数位（固定 4 位会把 t=0.0000001 显示成 0）。
 * toPrecision 对 |x| < 1e-6 会产生科学记数法，这里展开为定点小数
 * （如 1e-7 → 0.0000001），保证结果是非零、可逐位复核的展示。
 */
const fmt = (x) => {
  if (x === 0) return '0';
  let s = Number(x).toPrecision(6);
  const m = /^(-)?(\d)(?:\.(\d+))?e([+-]?\d+)$/.exec(s);
  if (m) {
    const digits = m[2] + (m[3] ?? '');
    const k = digits.length;
    const p = Number(m[4]) + 1; // 小数点应位于 digits 中第 p 个字符之后
    s =
      p >= k
        ? digits + '0'.repeat(p - k)
        : p <= 0
          ? '0.' + '0'.repeat(-p) + digits
          : digits.slice(0, p) + '.' + digits.slice(p);
    if (m[1]) s = '-' + s;
  }
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
};
const fmtR = (r) => fmt(ratToNumber(r));
const fmtP = (p) => `(${fmt(p.x)}, ${fmt(p.y)})`;

/* ---------------- 校核 ---------------- */

function runAnalysis() {
  validation = validatePlan(state);
  result = validation.ok ? analyzePlan(state) : null;
  if (result && result.earliest) {
    // 立即定位到最早遮挡时刻，展示首个遮挡证据
    viewTime = ratToNumber(result.earliest.t);
    playing = false;
  }
  updateScrubRange();
}

function onVerify() {
  verifiedOnce = true;
  const kfs = kfsSorted();
  if (viewTime == null && kfs.length >= 2) viewTime = kfs[0].t;
  runAnalysis();
  renderAll();
}

/** 编辑后：约束校核；若已校核过则自动复核，保证结果不过期。 */
function afterEdit({ rerenderPanel = false } = {}) {
  if (verifiedOnce) runAnalysis();
  else validation = validatePlan(state);
  updateScrubRange();
  if (rerenderPanel) renderPanel();
  renderBanner();
  renderResults();
  updateTimeLabel();
  draw();
}

/* ---------------- 面板 ---------------- */

function entityRow(kind, id, label, fields, deletable) {
  const inputs = fields
    .map(
      ([f, val, step]) =>
        `<label>${f}<input type="number" step="${step}" data-kind="${kind}" data-id="${id}" data-field="${f}" value="${val}"></label>`,
    )
    .join('');
  const del = deletable
    ? `<button class="del" data-action="del" data-kind="${kind}" data-id="${id}" title="删除">×</button>`
    : `<span class="del-placeholder"></span>`;
  return `<div class="row"><span class="tag tag-${kind}">${label}</span>${inputs}${del}</div>`;
}

function renderPanel() {
  const kL = kfLabels();
  const mL = markerLabels();
  const rL = rectLabels();
  const kfs = kfsSorted();

  $('#panel-keyframes').innerHTML =
    `<h2>相机关键帧 <small>${LIMITS.keyframes.min}–${LIMITS.keyframes.max} 个 · 时间严格递增 · 段间匀速直线</small></h2>` +
    kfs
      .map((k) =>
        entityRow(
          'keyframe',
          k.id,
          kL.get(k.id),
          [
            ['t', k.t, '0.1'],
            ['x', k.x, '1'],
            ['y', k.y, '1'],
          ],
          state.keyframes.length > LIMITS.keyframes.min,
        ),
      )
      .join('') +
    `<button data-action="add" data-kind="keyframe" ${state.keyframes.length >= LIMITS.keyframes.max ? 'disabled' : ''}>＋ 添加关键帧</button>`;

  $('#panel-markers').innerHTML =
    `<h2>待拍标记点 <small>${LIMITS.markers.min}–${LIMITS.markers.max} 个 · 不得落入保护矩形</small></h2>` +
    state.markers
      .map((m) =>
        entityRow(
          'marker',
          m.id,
          mL.get(m.id),
          [
            ['x', m.x, '1'],
            ['y', m.y, '1'],
          ],
          state.markers.length > LIMITS.markers.min,
        ),
      )
      .join('') +
    `<button data-action="add" data-kind="marker" ${state.markers.length >= LIMITS.markers.max ? 'disabled' : ''}>＋ 添加标记点</button>`;

  $('#panel-rects').innerHTML =
    `<h2>保护矩形 <small>${LIMITS.rects.min}–${LIMITS.rects.max} 个 · 视线不得相交/相切</small></h2>` +
    state.rects
      .map((r) =>
        entityRow(
          'rect',
          r.id,
          rL.get(r.id),
          [
            ['x', r.x, '1'],
            ['y', r.y, '1'],
            ['w', r.w, '1'],
            ['h', r.h, '1'],
          ],
          state.rects.length > LIMITS.rects.min,
        ),
      )
      .join('') +
    `<button data-action="add" data-kind="rect" ${state.rects.length >= LIMITS.rects.max ? 'disabled' : ''}>＋ 添加矩形</button>`;
}

function findEntity(kind, id) {
  const list =
    kind === 'keyframe' ? state.keyframes : kind === 'marker' ? state.markers : state.rects;
  return list.find((e) => e.id === id);
}

function addEntity(kind) {
  if (kind === 'keyframe' && state.keyframes.length < LIMITS.keyframes.max) {
    const last = kfsSorted().at(-1);
    state.keyframes.push({
      id: nid(),
      t: (last ? last.t : 0) + 2,
      x: 120 + state.keyframes.length * 130,
      y: 480,
    });
  } else if (kind === 'marker' && state.markers.length < LIMITS.markers.max) {
    state.markers.push({ id: nid(), x: 120 + state.markers.length * 90, y: 560 });
  } else if (kind === 'rect' && state.rects.length < LIMITS.rects.max) {
    state.rects.push({ id: nid(), x: 420 + state.rects.length * 40, y: 240, w: 100, h: 80 });
  } else {
    return;
  }
  afterEdit({ rerenderPanel: true });
}

function delEntity(kind, id) {
  const key = kind === 'keyframe' ? 'keyframes' : kind === 'marker' ? 'markers' : 'rects';
  if (state[key].length <= LIMITS[key].min) return;
  state[key] = state[key].filter((e) => e.id !== id);
  afterEdit({ rerenderPanel: true });
}

/* ---------------- 结果展示 ---------------- */

function renderBanner() {
  const b = $('#banner');
  if (!verifiedOnce) {
    b.className = 'banner hidden';
    return;
  }
  if (!validation.ok) {
    b.className = 'banner warn';
    b.textContent = `⚠ 输入不合法，无法校核：${validation.errors[0]}`;
    return;
  }
  if (result && result.earliest) {
    const mL = markerLabels();
    const rL = rectLabels();
    const e = result.earliest;
    b.className = 'banner bad';
    b.textContent =
      `✕ 曝光不可执行：最早遮挡 t = ${fmtR(e.t)}，` +
      `${mL.get(e.marker.id)} 的视线${e.tangent ? '瞬时擦到' : '进入'} ${rL.get(e.rect.id)}。` +
      `画布已定位首个遮挡证据，可拖动时间轴复核。`;
  } else {
    b.className = 'banner ok';
    b.textContent = '✓ 全部安全：所有移动段内、所有标记点的视线均不与任何保护矩形相交或相切。';
  }
}

function renderResults() {
  const box = $('#results');
  if (!verifiedOnce) {
    box.innerHTML = '<p class="muted">尚未校核。布置完成后点击「校核」，将做连续精确判定（非抽样）。</p>';
    return;
  }
  if (!validation.ok) {
    box.innerHTML =
      '<div class="verdict warn">输入不合法</div><ul class="err-list">' +
      validation.errors.map((e) => `<li>${e}</li>`).join('') +
      '</ul>';
    return;
  }

  const kL = kfLabels();
  const mL = markerLabels();
  const rL = rectLabels();
  let html = '';

  if (validation.warnings.length) {
    html += `<ul class="warn-list">${validation.warnings.map((w) => `<li>⚠ ${w}</li>`).join('')}</ul>`;
  }

  if (result.earliest) {
    const e = result.earliest;
    html +=
      `<div class="verdict bad">✕ 曝光不可执行：移动过程中存在遮挡</div>` +
      `<div class="evidence"><h3>首个遮挡证据（可复核）</h3><ul>` +
      `<li>最早遮挡时刻：<b>t = ${fmtR(e.t)}</b>${e.tangent ? '（瞬时相切）' : ''}</li>` +
      `<li>相机位置：<b>${fmtP(hpToNumber(e.cam))}</b></li>` +
      `<li>被挡标记点：<b>${mL.get(e.marker.id)}</b> ${fmtP(e.marker)}</li>` +
      `<li>涉及保护矩形：<b>${rL.get(e.rect.id)}</b>（x=${fmt(e.rect.x)}, y=${fmt(e.rect.y)}, w=${fmt(e.rect.w)}, h=${fmt(e.rect.h)}）</li>` +
      `<li>所在移动段：<b>${kL.get(e.segFrom.id)} → ${kL.get(e.segTo.id)}</b></li>` +
      `<li>性质：${e.tangent ? '视线首次擦到保护边界（相切）' : '视线进入遮挡区间'}</li>` +
      `</ul></div>`;
  } else {
    html += `<div class="verdict ok">✓ 全部安全：所有段 × 标记 × 矩形均无相交/相切。</div>`;
  }

  for (const seg of result.segments) {
    html += `<h3 class="seg-title">${kL.get(seg.from.id)} → ${kL.get(seg.to.id)}<small> t ∈ [${fmtR(seg.t0)}, ${fmtR(seg.t1)}]，匀速直线</small></h3><ul class="seg-list">`;
    for (const me of seg.markers) {
      if (me.rects.length === 0) {
        html += `<li class="ok-item">${mL.get(me.marker.id)}：全段安全</li>`;
      } else {
        for (const iv of me.rects) {
          const range = iv.tangent
            ? `t = ${fmtR(iv.tStart)}（瞬时相切）`
            : `t ∈ [${fmtR(iv.tStart)}, ${fmtR(iv.tEnd)}]`;
          html +=
            `<li class="bad-item">${mL.get(me.marker.id)}：被 ${rL.get(iv.rect.id)} 遮挡，${range}，` +
            `相机 ${fmtP(hpToNumber(iv.camStart))} → ${fmtP(hpToNumber(iv.camEnd))}</li>`;
        }
      }
    }
    html += '</ul>';
  }
  box.innerHTML = html;
}

/* ---------------- 画布 ---------------- */

function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawGrid() {
  ctx.strokeStyle = '#1b2432';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
}

function arrowHead(x0, y0, x1, y1) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const s = 9;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - s * Math.cos(ang - 0.45), y1 - s * Math.sin(ang - 0.45));
  ctx.lineTo(x1 - s * Math.cos(ang + 0.45), y1 - s * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d131a';
  ctx.fillRect(0, 0, W, H);
  drawGrid();

  const kfs = kfsSorted();
  const kL = kfLabels();
  const mL = markerLabels();
  const rL = rectLabels();

  // 相机路径（匀速直线段 + 方向箭头）
  if (kfs.length >= 2) {
    ctx.strokeStyle = 'rgba(47,129,247,0.75)';
    ctx.fillStyle = 'rgba(47,129,247,0.9)';
    ctx.lineWidth = 2;
    for (let i = 0; i + 1 < kfs.length; i++) {
      const a = kfs[i];
      const b = kfs[i + 1];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const mx = a.x + (b.x - a.x) * 0.62;
      const my = a.y + (b.y - a.y) * 0.62;
      arrowHead(a.x + (b.x - a.x) * 0.5, a.y + (b.y - a.y) * 0.5, mx, my);
    }
  }

  // 保护矩形
  state.rects.forEach((r) => {
    ctx.fillStyle = 'rgba(248,81,73,0.16)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#f85149';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    // 右下角缩放手柄
    ctx.fillStyle = '#f85149';
    ctx.fillRect(r.x + r.w - 5, r.y + r.h - 5, 10, 10);
    ctx.fillStyle = '#ffb3ae';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(rL.get(r.id), r.x + 5, r.y + 15);
  });

  // 标记点（菱形）
  state.markers.forEach((m) => {
    ctx.beginPath();
    ctx.moveTo(m.x, m.y - 9);
    ctx.lineTo(m.x + 9, m.y);
    ctx.lineTo(m.x, m.y + 9);
    ctx.lineTo(m.x - 9, m.y);
    ctx.closePath();
    ctx.fillStyle = '#f0883e';
    ctx.fill();
    ctx.strokeStyle = '#ffc08a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffc08a';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(mL.get(m.id), m.x + 12, m.y + 4);
  });

  // 关键帧
  kfs.forEach((k) => {
    ctx.beginPath();
    ctx.arc(k.x, k.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#2f81f7';
    ctx.fill();
    ctx.strokeStyle = '#9ecbff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#9ecbff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(`${kL.get(k.id)}  t=${fmt(k.t)}`, k.x + 13, k.y - 8);
  });

  // 当前时刻：相机位置 + 到各标记的视线（精确判定着色）
  const cam = viewTime != null && kfs.length >= 2 ? cameraAtTime(kfs, viewTime) : null;
  if (cam) {
    const camHp = hpFromNumber(cam.x, cam.y);
    for (const m of state.markers) {
      const mHp = hpFromNumber(m.x, m.y);
      const blocked = state.rects.some((r) =>
        sightBlockedAtPoint(camHp, mHp, rectFromNumber(r.x, r.y, r.w, r.h)),
      );
      ctx.strokeStyle = blocked ? '#f85149' : '#3fb950';
      ctx.lineWidth = blocked ? 2 : 1.2;
      ctx.beginPath();
      ctx.moveTo(cam.x, cam.y);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cam.x, cam.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#e6edf3';
    ctx.fill();
    ctx.strokeStyle = '#2f81f7';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // 最早遮挡证据高亮
  if (verifiedOnce && result && result.earliest) {
    const e = result.earliest;
    const camPos = hpToNumber(e.cam);
    ctx.save();
    ctx.strokeStyle = '#ff7b72';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(camPos.x, camPos.y);
    ctx.lineTo(e.marker.x, e.marker.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(camPos.x, camPos.y, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ff7b72';
    ctx.lineWidth = 3.5;
    ctx.strokeRect(e.rect.x - 3, e.rect.y - 3, e.rect.w + 6, e.rect.h + 6);
    ctx.fillStyle = '#ff7b72';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(`最早遮挡 t=${fmtR(e.t)}`, Math.min(camPos.x + 16, W - 150), camPos.y - 14);
    ctx.restore();
  }
}

/* ---------------- 画布拖拽 ---------------- */

function toWorld(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) * W) / rect.width,
    y: ((e.clientY - rect.top) * H) / rect.height,
  };
}

const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function hitTest(p) {
  for (const k of state.keyframes) {
    if (dist(p, k) < 13) return { kind: 'keyframe', ent: k, mode: 'move' };
  }
  for (const m of state.markers) {
    if (dist(p, m) < 13) return { kind: 'marker', ent: m, mode: 'move' };
  }
  for (const r of state.rects) {
    if (Math.abs(p.x - (r.x + r.w)) < 10 && Math.abs(p.y - (r.y + r.h)) < 10) {
      return { kind: 'rect', ent: r, mode: 'resize' };
    }
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
      return { kind: 'rect', ent: r, mode: 'move', dx: p.x - r.x, dy: p.y - r.y };
    }
  }
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  const hit = hitTest(toWorld(e));
  if (hit) {
    drag = hit;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = toWorld(e);
  if (!drag) {
    canvas.style.cursor = hitTest(p) ? 'grab' : 'default';
    return;
  }
  const ent = drag.ent;
  if (drag.kind === 'rect' && drag.mode === 'resize') {
    ent.w = clamp(Math.round(p.x - ent.x), 10, W - ent.x);
    ent.h = clamp(Math.round(p.y - ent.y), 10, H - ent.y);
  } else if (drag.kind === 'rect') {
    ent.x = clamp(Math.round(p.x - drag.dx), 0, W - ent.w);
    ent.y = clamp(Math.round(p.y - drag.dy), 0, H - ent.h);
  } else {
    ent.x = clamp(Math.round(p.x), 0, W);
    ent.y = clamp(Math.round(p.y), 0, H);
  }
  afterEdit();
});

canvas.addEventListener('pointerup', () => {
  if (drag) {
    drag = null;
    canvas.style.cursor = 'default';
    renderPanel(); // 同步数值到面板输入框
  }
});

/* ---------------- 时间轴与播放 ---------------- */

const scrub = $('#scrub');

function updateScrubRange() {
  const kfs = kfsSorted();
  if (kfs.length >= 2) {
    const span = kfs[kfs.length - 1].t - kfs[0].t;
    scrub.min = kfs[0].t;
    scrub.max = kfs[kfs.length - 1].t;
    // 步长跟随总跨度（亚微秒方案下步长也为亚微秒），不再有 0.001 的固定下限
    scrub.step = span > 0 ? span / 2000 : 0.001;
    if (viewTime != null) scrub.value = viewTime;
  }
}

function updateTimeLabel() {
  $('#time-label').textContent = viewTime == null ? 't = —' : `t = ${fmt(viewTime)}`;
  if (viewTime != null) scrub.value = viewTime;
}

scrub.addEventListener('input', () => {
  viewTime = parseFloat(scrub.value);
  playing = false;
  updatePlayBtn();
  updateTimeLabel();
  draw();
});

let lastTs = 0;
function tick(ts) {
  if (!playing) return;
  const kfs = kfsSorted();
  if (kfs.length < 2) {
    playing = false;
    updatePlayBtn();
    return;
  }
  const t0 = kfs[0].t;
  const t1 = kfs[kfs.length - 1].t;
  if (viewTime == null) viewTime = t0;
  const dt = lastTs ? (ts - lastTs) / 1000 : 0;
  lastTs = ts;
  viewTime += (dt * (t1 - t0)) / 8; // 全程约 8 秒
  if (viewTime > t1) viewTime = t0; // 循环播放
  updateTimeLabel();
  draw();
  requestAnimationFrame(tick);
}

function updatePlayBtn() {
  $('#btn-play').textContent = playing ? '⏸ 暂停' : '▶ 播放';
}

$('#btn-play').addEventListener('click', () => {
  playing = !playing;
  if (playing) {
    const kfs = kfsSorted();
    if (viewTime == null && kfs.length >= 2) viewTime = kfs[0].t;
    lastTs = 0;
    requestAnimationFrame(tick);
  }
  updatePlayBtn();
});

/* ---------------- 面板事件（委托） ---------------- */

document.querySelector('aside').addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset || !el.dataset.kind || !el.dataset.field) return;
  const ent = findEntity(el.dataset.kind, Number(el.dataset.id));
  const v = parseFloat(el.value);
  if (!ent || !Number.isFinite(v)) return;
  ent[el.dataset.field] = v;
  afterEdit(); // 不重绘面板，避免输入框失焦
});

document.querySelector('aside').addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el || !el.dataset.action) return;
  if (el.dataset.action === 'add') addEntity(el.dataset.kind);
  if (el.dataset.action === 'del') delEntity(el.dataset.kind, Number(el.dataset.id));
});

$('#btn-verify').addEventListener('click', onVerify);
$('#btn-reset').addEventListener('click', () => {
  state = defaultState();
  result = null;
  verifiedOnce = false;
  viewTime = null;
  playing = false;
  validation = { ok: true, errors: [], warnings: [] };
  updatePlayBtn();
  renderAll();
});

/* ---------------- 启动 ---------------- */

function renderAll() {
  renderPanel();
  renderBanner();
  renderResults();
  updateScrubRange();
  updateTimeLabel();
  draw();
}

setupCanvas();
renderAll();
