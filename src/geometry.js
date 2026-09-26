/**
 * geometry.js —— 视线遮挡精确判定核心（纯计算，无 DOM 依赖，浏览器/Node 通用）。
 *
 * 方法：事件驱动的连续判定，而非抽样时刻。
 * 相机在相邻关键帧之间做匀速直线运动：C(u) = C0 + u·(C1−C0)，u ∈ [0,1]。
 * 对「相机段 × 标记点 × 保护矩形」，视线段 C(u)M 与矩形 R 的相交/相切状态
 * 只可能在以下事件时刻改变：
 *   1) 视线恰好扫过矩形某个顶点（C(u)、M、顶点三者共线）；
 *   2) 相机自身穿过矩形边界（进入/离开矩形）。
 * 这些事件时刻都是有理数，可用 BigInt 精确求出；相邻事件之间状态恒定，
 * 在每个开区间中点精确判定一次即可还原整个遮挡集合。
 * 输出为精确的遮挡区间集（区间退化为一点时即"瞬时相切"）。
 *
 * 坐标同样按十进制展开精确存放：每个齐次点（及矩形边界）携带分母 W，
 * 值 = X/(W·SCALE)，W 取足以容纳该点全部小数位的 10 的幂，
 * 故 3.9999996 这类超出 1e-6 网格的坐标不会被量化吸附到矩形边界上；
 * 时间直接按其十进制展开存为精确有理数（亚微秒级严格递增时间仍可区分）。
 * 配合 BigInt 有理数运算，判定过程不引入任何浮点误差（浮点仅用于最终展示）。
 */

export const SCALE = 1_000_000n;

/* ---------------- 有理数（BigInt 分子/分母，规范化） ---------------- */

const abs = (a) => (a < 0n ? -a : a);

function gcd(a, b) {
  a = abs(a);
  b = abs(b);
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a === 0n ? 1n : a;
}

/** 构造规范化有理数 n/d（d > 0，已约分）。 */
export function rat(n, d = 1n) {
  if (typeof n === 'number') n = BigInt(n);
  if (typeof d === 'number') d = BigInt(d);
  if (d === 0n) throw new Error('rational with zero denominator');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

/**
 * 解析有限 number 的十进制展开（Number.prototype.toString，含 4e-7 等科学记数法）
 * 为 { n, d }，其中 d = 10^k（k ≥ 0，尚未约分）。
 * 直接对十进制数字串移位取数，不做 x·10^k 的浮点乘法，
 * 因而亚微秒数值（如 0.0000004）不会在乘法/取整中丢失为 0。
 */
function decimalParts(x) {
  if (!Number.isFinite(x)) throw new Error('expected a finite number');
  if (x === 0) return { n: 0n, d: 1n };
  let s = x.toString();
  let sign = 1n;
  if (s.startsWith('-')) {
    sign = -1n;
    s = s.slice(1);
  }
  let exp = 0;
  const ePos = s.indexOf('e');
  if (ePos >= 0) {
    exp = Number(s.slice(ePos + 1)); // 含 "+21" 形式
    s = s.slice(0, ePos);
  }
  const dot = s.indexOf('.');
  if (dot >= 0) {
    exp -= s.length - dot - 1;
    s = s.slice(0, dot) + s.slice(dot + 1);
  }
  const digits = BigInt(s) * sign;
  if (exp >= 0) return { n: digits * 10n ** BigInt(exp), d: 1n };
  return { n: digits, d: 10n ** BigInt(-exp) };
}

/**
 * 两个十进制展开（分母均为 10 的幂）的精确和，结果仍为十进制展开。
 * 用于在不经过浮点加法的情况下求矩形对边（xmax = x + w 等）。
 */
function decimalAdd(a, b) {
  const d = a.d > b.d ? a.d : b.d;
  return { n: a.n * (d / a.d) + b.n * (d / b.d), d };
}

/**
 * 能精确容纳所有给定十进制展开的最小缩放（10 的幂，且 ≥ SCALE）。
 * decimalParts 的分母恒为 10 的幂，故取最大者即为公共分母。
 */
function exactScale(...parts) {
  let s = SCALE;
  for (const p of parts) if (p.d > s) s = p.d;
  return s;
}

/** 十进制 number → 精确有理数（按其十进制展开精确约分，亚微秒值也可区分）。 */
export function ratFromNumber(x) {
  const p = decimalParts(x);
  return rat(p.n, p.d);
}

export function ratToNumber(r) {
  return Number(r.n) / Number(r.d);
}

export const rAdd = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const rSub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const rMul = (a, b) => rat(a.n * b.n, a.d * b.d);

export function rCmp(a, b) {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}

export const rMid = (a, b) => rat(a.n * b.d + b.n * a.d, 2n * a.d * b.d);

/* ---------------- 齐次点 (X, Y, W)：笛卡尔坐标 = (X/(W·SCALE), Y/(W·SCALE)) ---------------- */

export function hp(x, y, w = 1n) {
  return { x, y, w };
}

/**
 * 浮点坐标 → 齐次点。按十进制展开精确存放：W 取能容纳两坐标全部小数位的
 * 10 的幂（值 = X/(W·SCALE)），任意小数位的坐标都不会被量化到 1e-6 网格上
 * （如 3.9999996 保持为 39999996/(10·SCALE)，不会被吸附到 4）。
 */
export function hpFromNumber(px, py) {
  const ax = decimalParts(px);
  const ay = decimalParts(py);
  const s = exactScale(ax, ay);
  return hp(ax.n * (s / ax.d), ay.n * (s / ay.d), s / SCALE);
}

/** 齐次点 → 浮点坐标（仅供展示）。 */
export function hpToNumber(p) {
  return { x: Number(p.x) / Number(p.w) / 1e6, y: Number(p.y) / Number(p.w) / 1e6 };
}

/* ---------------- 轴对齐矩形（边界按十进制精确存放，公共分母 R.w） ---------------- */

/**
 * 矩形边界值 = 存储值/(R.w·SCALE)。xmax = x + w、ymax = y + h 在十进制
 * 展开上精确相加（不做浮点加法），故亚网格精度的边界同样精确。
 */
export function rectFromNumber(x, y, w, h) {
  const ax = decimalParts(x);
  const ay = decimalParts(y);
  const ax2 = decimalAdd(ax, decimalParts(w));
  const ay2 = decimalAdd(ay, decimalParts(h));
  const s = exactScale(ax, ay, ax2, ay2);
  const at = (p) => p.n * (s / p.d);
  return { xmin: at(ax), ymin: at(ay), xmax: at(ax2), ymax: at(ay2), w: s / SCALE };
}

export function rectCorners(R) {
  return [
    hp(R.xmin, R.ymin, R.w),
    hp(R.xmax, R.ymin, R.w),
    hp(R.xmax, R.ymax, R.w),
    hp(R.xmin, R.ymax, R.w),
  ];
}

export function rectEdges(R) {
  const c = rectCorners(R);
  return [
    [c[0], c[1]],
    [c[1], c[2]],
    [c[2], c[3]],
    [c[3], c[0]],
  ];
}

/** 点是否落在闭矩形内（含边界）。 */
export function pointInRect(P, R) {
  return (
    P.x * R.w >= R.xmin * P.w &&
    P.x * R.w <= R.xmax * P.w &&
    P.y * R.w >= R.ymin * P.w &&
    P.y * R.w <= R.ymax * P.w
  );
}

/* ---------------- 精确谓词：方向 / 在线段上 / 线段相交（含相切） ---------------- */

/** orient(A,B,C)：AB × AC 的符号。齐次坐标分母为正，符号由分子决定。 */
function orient(A, B, C) {
  const ux = B.x * A.w - A.x * B.w;
  const uy = B.y * A.w - A.y * B.w;
  const vx = C.x * A.w - A.x * C.w;
  const vy = C.y * A.w - A.y * C.w;
  const cross = ux * vy - uy * vx;
  return cross < 0n ? -1 : cross > 0n ? 1 : 0;
}

/** 有理数比较：pa/pw 是否介于 qa/qw 与 ra/rw 之间（含端点）。 */
function between(qx, qw, rx, rw, px, pw) {
  const qLeR = qx * rw <= rx * qw;
  const loX = qLeR ? qx : rx;
  const loW = qLeR ? qw : rw;
  const hiX = qLeR ? rx : qx;
  const hiW = qLeR ? rw : qw;
  return px * loW >= loX * pw && px * hiW <= hiX * pw;
}

/** P 是否在线段 AB 上（前提：已知共线）。 */
function onSeg(A, B, P) {
  return between(A.x, A.w, B.x, B.w, P.x, P.w) && between(A.y, A.w, B.y, B.w, P.y, P.w);
}

/** 线段 AB 与 CD 是否相交（含端点接触与共线重叠）。 */
export function segmentsIntersect(A, B, C, D) {
  const o1 = orient(A, B, C);
  const o2 = orient(A, B, D);
  const o3 = orient(C, D, A);
  const o4 = orient(C, D, B);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (o1 === 0 && onSeg(A, B, C)) return true;
  if (o2 === 0 && onSeg(A, B, D)) return true;
  if (o3 === 0 && onSeg(C, D, A)) return true;
  if (o4 === 0 && onSeg(C, D, B)) return true;
  return false;
}

/* ---------------- 相机运动与单时刻视线判定 ---------------- */

/** 相机在参数 u（有理数）处的位置（齐次点）。c0/c1 为任意 W 的精确齐次点。 */
export function camAt(c0, c1, u) {
  const dx = c1.x * c0.w - c0.x * c1.w; // (c1x − c0x)·SCALE 的分子（分母 c0.w·c1.w）
  const dy = c1.y * c0.w - c0.y * c1.w;
  // C(u) = c0 + u·(c1 − c0)，公分母 c0.w·c1.w·u.d
  return hp(
    c0.x * c1.w * u.d + dx * u.n,
    c0.y * c1.w * u.d + dy * u.n,
    c0.w * c1.w * u.d,
  );
}

/** 静止视线判定：点 C 到标记 M 的视线段是否与矩形 R 相交/相切。 */
export function sightBlockedAtPoint(C, M, R) {
  if (pointInRect(M, R)) return true; // 标记在矩形内（校核阶段会拦截，此处兜底）
  if (pointInRect(C, R)) return true; // 相机位于矩形内
  return rectEdges(R).some(([a, b]) => segmentsIntersect(C, M, a, b));
}

/** 运动相机在参数 u 处，到标记 M 的视线是否被矩形 R 遮挡。 */
export function sightBlockedAt(c0, c1, M, R, u) {
  return sightBlockedAtPoint(camAt(c0, c1, u), M, R);
}

/* ---------------- 事件时刻与遮挡区间 ---------------- */

/**
 * 候选事件时刻（u ∈ [0,1]，有理数）：
 *  1) C(u)、M、矩形顶点共线；
 *  2) 相机轨迹穿过矩形边界（竖直边 x=xmin/xmax，水平边 y=ymin/ymax）。
 * 各点 W 可不同：先化为「缩放笛卡尔坐标」（笛卡尔值 ×SCALE）的精确有理数，
 * 再解一次方程；公共因子 SCALE 在求 u 的比值中约去。
 */
function candidateUs(c0, c1, M, R) {
  const us = [rat(0n), rat(1n)];
  // 轨迹方向 d = c1 − c0 与起点 c0（缩放笛卡尔坐标）
  const bx = rat(c1.x * c0.w - c0.x * c1.w, c1.w * c0.w);
  const by = rat(c1.y * c0.w - c0.y * c1.w, c1.w * c0.w);
  const c0x = rat(c0.x, c0.w);
  const c0y = rat(c0.y, c0.w);

  // 1) 视线扫过顶点：cross(C(u) − M, K − M) = 0（关于 u 的一次方程）
  for (const K of rectCorners(R)) {
    const vx = rat(K.x * M.w - M.x * K.w, K.w * M.w);
    const vy = rat(K.y * M.w - M.y * K.w, K.w * M.w);
    const denom = rSub(rMul(bx, vy), rMul(by, vx)); // cross(d, K−M)
    if (denom.n === 0n) continue; // 轨迹与 MK 平行（含恒共线），无孤立事件
    const ax = rSub(c0x, rat(M.x, M.w));
    const ay = rSub(c0y, rat(M.y, M.w));
    const numer = rSub(rMul(ay, vx), rMul(ax, vy)); // −cross(c0−M, K−M)
    us.push(rat(numer.n * denom.d, numer.d * denom.n));
  }

  // 2) 相机穿过矩形边界
  if (bx.n !== 0n) {
    const ymin = rat(R.ymin, R.w);
    const ymax = rat(R.ymax, R.w);
    for (const e of [rat(R.xmin, R.w), rat(R.xmax, R.w)]) {
      const num = rSub(e, c0x);
      const u = rat(num.n * bx.d, num.d * bx.n);
      const y = rAdd(c0y, rMul(u, by)); // 穿越时刻的 y（缩放笛卡尔坐标）
      if (rCmp(y, ymin) >= 0 && rCmp(y, ymax) <= 0) us.push(u);
    }
  }
  if (by.n !== 0n) {
    const xmin = rat(R.xmin, R.w);
    const xmax = rat(R.xmax, R.w);
    for (const e of [rat(R.ymin, R.w), rat(R.ymax, R.w)]) {
      const num = rSub(e, c0y);
      const u = rat(num.n * by.d, num.d * by.n);
      const x = rAdd(c0x, rMul(u, bx)); // 穿越时刻的 x（缩放笛卡尔坐标）
      if (rCmp(x, xmin) >= 0 && rCmp(x, xmax) <= 0) us.push(u);
    }
  }

  // 过滤到 [0,1]，排序去重
  const zero = rat(0n);
  const one = rat(1n);
  const inRange = us.filter((u) => rCmp(u, zero) >= 0 && rCmp(u, one) <= 0);
  inRange.sort(rCmp);
  const uniq = [];
  for (const u of inRange) {
    if (uniq.length === 0 || rCmp(uniq[uniq.length - 1], u) !== 0) uniq.push(u);
  }
  return uniq;
}

/**
 * 计算「相机段 × 标记 × 矩形」的精确遮挡区间集。
 * 返回 [{ uStart, uEnd, tangent }]，u 为 [0,1] 内有理数；
 * uStart === uEnd（tangent=true）表示仅在该瞬间相切。
 */
export function occlusionIntervals(c0, c1, M, R) {
  const us = candidateUs(c0, c1, M, R);
  const pieces = [];

  // 事件点本身（捕捉瞬时相切）
  for (const u of us) {
    if (sightBlockedAt(c0, c1, M, R, u)) pieces.push({ s: u, e: u });
  }
  // 相邻事件之间的开区间（状态恒定，中点判定）
  for (let i = 0; i + 1 < us.length; i++) {
    if (sightBlockedAt(c0, c1, M, R, rMid(us[i], us[i + 1]))) {
      pieces.push({ s: us[i], e: us[i + 1] });
    }
  }

  // 合并相邻/重叠片段为极大闭区间
  pieces.sort((a, b) => rCmp(a.s, b.s) || rCmp(a.e, b.e));
  const merged = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && rCmp(p.s, last.e) <= 0) {
      if (rCmp(p.e, last.e) > 0) last.e = p.e;
    } else {
      merged.push({ s: p.s, e: p.e });
    }
  }
  return merged.map((p) => ({ uStart: p.s, uEnd: p.e, tangent: rCmp(p.s, p.e) === 0 }));
}

/* ---------------- 整体方案分析 ---------------- */

/**
 * 分析整个拍摄方案。
 * plan: { keyframes: [{t,x,y}...], markers: [{x,y}...], rects: [{x,y,w,h}...] }
 * 返回 {
 *   keyframesSorted,            // 按时间排序的原始关键帧引用
 *   segments: [{
 *     index, from, to, t0, t1,  // t0/t1 为有理数
 *     markers: [{
 *       marker,
 *       rects: [{ rect, uStart, uEnd, tStart, tEnd, tangent, camStart, camEnd }]
 *     }]
 *   }],
 *   earliest: null | { t, cam, tangent, marker, rect, segFrom, segTo }
 * }
 */
export function analyzePlan(plan) {
  const kfs = [...plan.keyframes].sort((a, b) => a.t - b.t);
  const K = kfs.map((k) => ({ t: ratFromNumber(k.t), c: hpFromNumber(k.x, k.y), ref: k }));
  const Ms = plan.markers.map((m) => ({ p: hpFromNumber(m.x, m.y), ref: m }));
  const Rs = plan.rects.map((r) => ({ R: rectFromNumber(r.x, r.y, r.w, r.h), ref: r }));

  const segments = [];
  let earliest = null;

  for (let i = 0; i + 1 < K.length; i++) {
    const seg = {
      index: i,
      from: K[i].ref,
      to: K[i + 1].ref,
      t0: K[i].t,
      t1: K[i + 1].t,
      markers: [],
    };
    for (const m of Ms) {
      const entry = { marker: m.ref, rects: [] };
      for (const r of Rs) {
        const dt = rSub(K[i + 1].t, K[i].t);
        for (const iv of occlusionIntervals(K[i].c, K[i + 1].c, m.p, r.R)) {
          const rec = {
            rect: r.ref,
            uStart: iv.uStart,
            uEnd: iv.uEnd,
            tStart: rAdd(K[i].t, rMul(dt, iv.uStart)),
            tEnd: rAdd(K[i].t, rMul(dt, iv.uEnd)),
            tangent: iv.tangent,
            camStart: camAt(K[i].c, K[i + 1].c, iv.uStart),
            camEnd: camAt(K[i].c, K[i + 1].c, iv.uEnd),
          };
          entry.rects.push(rec);
          if (!earliest || rCmp(rec.tStart, earliest.t) < 0) {
            earliest = {
              t: rec.tStart,
              cam: rec.camStart,
              tangent: rec.tangent,
              marker: m.ref,
              rect: r.ref,
              segFrom: K[i].ref,
              segTo: K[i + 1].ref,
            };
          }
        }
      }
      seg.markers.push(entry);
    }
    segments.push(seg);
  }

  return { keyframesSorted: kfs, segments, earliest };
}

/* ---------------- 展示辅助（浮点，仅供 UI 渲染） ---------------- */

/** 浮点线性插值：时刻 t 的相机位置（t 越界时钳制到端点）。 */
export function cameraAtTime(kfsSorted, t) {
  if (kfsSorted.length === 0) return null;
  const first = kfsSorted[0];
  const last = kfsSorted[kfsSorted.length - 1];
  if (t <= first.t) return { x: first.x, y: first.y, segIndex: 0 };
  if (t >= last.t) return { x: last.x, y: last.y, segIndex: kfsSorted.length - 2 };
  for (let i = 0; i + 1 < kfsSorted.length; i++) {
    const a = kfsSorted[i];
    const b = kfsSorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, segIndex: i };
    }
  }
  return { x: last.x, y: last.y, segIndex: kfsSorted.length - 2 };
}
