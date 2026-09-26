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
 * 坐标与时间一样按其十进制展开存为精确有理数（齐次点 (X,Y,W) 分母为正，
 * 矩形边界为 BigInt 有理数 n/d），不做固定倍数量化取整：故距边界仅
 * 0.0000004 的矩形外标记不会被舍入到边界上。
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

/* ---------------- 有理数运算（BigInt 分子/分母） ---------------- */

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

const lcm2 = (a, b) => (a / gcd(a, b)) * b;

/* ---------------- 齐次点 (X, Y, W)：笛卡尔坐标 = (X/(W·SCALE), Y/(W·SCALE)) ----------------
 *
 * 约定：齐次分量的「笛卡尔单位 = 缩放整数 / SCALE」。对由十进制数构造的点，
 * 取 W 为两个坐标十进制分母的公倍数、X/Y 为对应分子·SCALE；于是
 * X/(W·SCALE) 恰好是输入数的精确十进制值，不做任何取整。
 * 整数 / 一位小数等简单输入约分后仍为 W=1。
 */

export function hp(x, y, w = 1n) {
  return { x, y, w };
}

/** 浮点坐标 → 齐次点（精确十进制有理数，亚微秒级间距也不被舍入）。 */
export function hpFromNumber(px, py) {
  const xp = decimalParts(px);
  const yp = decimalParts(py);
  const w = xp.d * yp.d;
  return hp(xp.n * yp.d * SCALE, yp.n * xp.d * SCALE, w);
}

/** 齐次点 → 浮点坐标（仅供展示）。 */
export function hpToNumber(p) {
  return { x: Number(p.x) / Number(p.w) / 1e6, y: Number(p.y) / Number(p.w) / 1e6 };
}

/* ---------------- 轴对齐矩形（有理数边界 n/d，笛卡尔单位） ---------------- */

/** 有理数边界矩形：xmin 等为 {n,d}（已约分），表示 n/d 个笛卡尔单位。 */
export function rectFromNumber(x, y, w, h) {
  const xmin = ratFromNumber(x);
  const ymin = ratFromNumber(y);
  const ww = ratFromNumber(w);
  const hh = ratFromNumber(h);
  return {
    xmin,
    ymin,
    xmax: rAdd(xmin, ww),
    ymax: rAdd(ymin, hh),
  };
}

export function rectCorners(R) {
  // 四条边轴对齐：四个顶点可取同一分母 D（四个边界分母的最小公倍数）
  const D = [R.xmin.d, R.xmax.d, R.ymin.d, R.ymax.d].reduce(lcm2);
  const num = (r) => r.n * (D / r.d); // 笛卡尔分子（以 D 为分母）
  const x0 = num(R.xmin);
  const x1 = num(R.xmax);
  const y0 = num(R.ymin);
  const y1 = num(R.ymax);
  // 顶点齐次坐标以 SCALE 为缩放单位：笛卡尔值 = X/(W·SCALE)
  return [
    hp(x0 * SCALE, y0 * SCALE, D),
    hp(x1 * SCALE, y0 * SCALE, D),
    hp(x1 * SCALE, y1 * SCALE, D),
    hp(x0 * SCALE, y1 * SCALE, D),
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
  // X/(W·SCALE) 与 n/d 比较，约去公共 SCALE
  return (
    P.x * R.xmin.d >= R.xmin.n * P.w * SCALE &&
    P.x * R.xmax.d <= R.xmax.n * P.w * SCALE &&
    P.y * R.ymin.d >= R.ymin.n * P.w * SCALE &&
    P.y * R.ymax.d <= R.ymax.n * P.w * SCALE
  );
}

/**
 * 十进制浮点输入的「点是否在闭矩形内（含边界）」精确判定（供输入校核使用）。
 * 与几何核心共用同一套精确表示：输入按其十进制展开比较，
 * 距边界任意小（如 0.0000004）的矩形外点都不会被误判为在矩形内。
 */
export function pointInClosedRectExact(x, y, rect) {
  return pointInRect(hpFromNumber(x, y), rectFromNumber(rect.x, rect.y, rect.w, rect.h));
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

/** 相机在参数 u（有理数）处的位置（齐次点）。c0/c1 为任意正分母的齐次点。 */
export function camAt(c0, c1, u) {
  // C(u) = (c0 + u·(c1 − c0))，按齐次坐标展开（w0、w1 可不同）：
  //   W = w0·w1·u.d，X = (c1.x·w0 − c0.x·w1)·u.n + c0.x·w1·u.d
  const dx = c1.x * c0.w - c0.x * c1.w;
  const dy = c1.y * c0.w - c0.y * c1.w;
  return hp(
    dx * u.n + c0.x * c1.w * u.d,
    dy * u.n + c0.y * c1.w * u.d,
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
 * 相机端点、标记、矩形顶点均可带不同的齐次分母，以下推导按一般齐次坐标展开。
 */
function candidateUs(c0, c1, M, R) {
  const us = [rat(0n), rat(1n)];

  // 相机轨迹（齐次）：X(u) = ax·u.n + bx·u.d，W(u) = cw·u.d（cw = w0·w1）
  const cw = c0.w * c1.w;
  const ax = c1.x * c0.w - c0.x * c1.w;
  const bx = c0.x * c1.w;
  const ay = c1.y * c0.w - c0.y * c1.w;
  const by = c0.y * c1.w;

  // 1) 视线扫过顶点 K：cross(C(u) − M, K − M) = 0（关于 u 的一次方程）
  //    展开为 A·u.n + B·u.d = 0，其中（kmx = K.x·M.w − M.x·K.w，kmy 同理）：
  //      A = (ax·kmy − ay·kmx)·M.w
  //      B = (bx·M.w − M.x·cw)·kmy − (by·M.w − M.y·cw)·kmx
  //    （B 含相机起点相对标记的偏移项；缩放单位一致，SCALE 因子已约去。）
  for (const K of rectCorners(R)) {
    const kmx = K.x * M.w - M.x * K.w;
    const kmy = K.y * M.w - M.y * K.w;
    const A = (ax * kmy - ay * kmx) * M.w;
    if (A === 0n) continue; // 轨迹与 MK 平行（含恒共线），无孤立事件
    const B = (bx * M.w - M.x * cw) * kmy - (by * M.w - M.y * cw) * kmx;
    us.push(rat(-B, A));
  }

  // 2) 相机穿过矩形边界
  //    竖直边 x = b（有理数 n/d）：X(u)/W(u) = b·SCALE
  //      ⇔ (ax·u.n + bx·u.d)·d = n·SCALE·cw·u.d
  //      ⇔ (ax·d)·u.n = (n·SCALE·cw − bx·d)·u.d
  //    事件 u = (n·SCALE·cw − bx·d) / (ax·d)，再校验该处 y 落在 [ymin, ymax]。
  if (ax !== 0n) {
    for (const b of [R.xmin, R.xmax]) {
      const u = rat(b.n * SCALE * cw - bx * b.d, ax * b.d);
      const C = camAt(c0, c1, u);
      if (
        C.y * R.ymin.d >= R.ymin.n * C.w * SCALE &&
        C.y * R.ymax.d <= R.ymax.n * C.w * SCALE
      ) {
        us.push(u);
      }
    }
  }
  if (ay !== 0n) {
    for (const b of [R.ymin, R.ymax]) {
      const u = rat(b.n * SCALE * cw - by * b.d, ay * b.d);
      const C = camAt(c0, c1, u);
      if (
        C.x * R.xmin.d >= R.xmin.n * C.w * SCALE &&
        C.x * R.xmax.d <= R.xmax.n * C.w * SCALE
      ) {
        us.push(u);
      }
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
