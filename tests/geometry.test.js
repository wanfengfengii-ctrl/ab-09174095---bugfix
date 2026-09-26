import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rat,
  rAdd,
  rMul,
  rCmp,
  rMid,
  ratFromNumber,
  hp,
  hpFromNumber,
  rectFromNumber,
  pointInRect,
  segmentsIntersect,
  sightBlockedAtPoint,
  occlusionIntervals,
  analyzePlan,
  cameraAtTime,
  ratToNumber,
} from '../src/geometry.js';

/* ---------------- 有理数 ---------------- */

test('有理数规范化与四则运算', () => {
  assert.deepEqual(rat(2n, 4n), { n: 1n, d: 2n });
  assert.deepEqual(rat(3n, -6n), { n: -1n, d: 2n });
  assert.equal(rCmp(rAdd(rat(1n, 3n), rat(1n, 6n)), rat(1n, 2n)), 0);
  assert.equal(rCmp(rMul(rat(2n, 3n), rat(9n, 4n)), rat(3n, 2n)), 0);
  assert.equal(rCmp(rMid(rat(0n), rat(1n)), rat(1n, 2n)), 0);
  assert.equal(rCmp(ratFromNumber(0.25), rat(1n, 4n)), 0);
});

test('亚微秒时间：严格递增的小数时间保持可区分性，不被量化为 0', () => {
  assert.equal(rCmp(ratFromNumber(0.0000001), rat(1n, 10_000_000n)), 0);
  assert.equal(rCmp(ratFromNumber(0.0000004), rat(4n, 10_000_000n)), 0);
  assert.ok(rCmp(ratFromNumber(0.0000001), rat(0n)) > 0);
  assert.ok(rCmp(ratFromNumber(0.0000004), ratFromNumber(0.0000001)) > 0);
  // 常规十进制值仍然精确
  assert.equal(rCmp(ratFromNumber(0.1), rat(1n, 10n)), 0);
});

/* ---------------- 线段相交（含相切） ---------------- */

const P = (x, y) => hpFromNumber(x, y);

test('线段相交：交叉、端点接触、共线重叠、不相交', () => {
  // 正常交叉
  assert.equal(segmentsIntersect(P(0, 0), P(4, 4), P(0, 4), P(4, 0)), true);
  // 端点接触（T 形相切）
  assert.equal(segmentsIntersect(P(0, 0), P(4, 0), P(2, 0), P(2, 3)), true);
  // 共线重叠
  assert.equal(segmentsIntersect(P(0, 0), P(4, 0), P(2, 0), P(6, 0)), true);
  // 共线端点相接
  assert.equal(segmentsIntersect(P(0, 0), P(2, 0), P(2, 0), P(5, 0)), true);
  // 共线但分离
  assert.equal(segmentsIntersect(P(0, 0), P(2, 0), P(3, 0), P(5, 0)), false);
  // 平行不相交
  assert.equal(segmentsIntersect(P(0, 0), P(4, 0), P(0, 1), P(4, 1)), false);
  // 延长线相交但线段不相交
  assert.equal(segmentsIntersect(P(0, 0), P(1, 1), P(5, 0), P(6, 1)), false);
});

test('点在闭矩形内（含边界）', () => {
  const R = rectFromNumber(4, 4, 2, 2); // [4,6]×[4,6]
  assert.equal(pointInRect(P(5, 5), R), true);
  assert.equal(pointInRect(P(4, 5), R), true); // 边界
  assert.equal(pointInRect(P(6, 6), R), true); // 顶点
  assert.equal(pointInRect(P(3.999999, 5), R), false);
  assert.equal(pointInRect(P(5, 6.000001), R), false);
});

test('静止视线：相切也算遮挡', () => {
  const R = rectFromNumber(4, 4, 2, 2);
  // 视线穿过矩形
  assert.equal(sightBlockedAtPoint(P(0, 0), P(10, 10), R), true);
  // 视线恰好经过顶点 (4,6)：相切 → 遮挡
  assert.equal(sightBlockedAtPoint(P(0, 3), P(8, 9), R), true);
  // 视线完全避开
  assert.equal(sightBlockedAtPoint(P(0, 0), P(10, 0), R), false);
  // 相机在矩形内
  assert.equal(sightBlockedAtPoint(P(5, 5), P(0, 0), R), true);
});

/* ---------------- 连续遮挡区间（与解析解对比） ---------------- */

test('场景A：遮挡区间精确等于 u∈[1/4, 3/4]', () => {
  // 相机 (0,0)->(10,0)，标记 (5,10)，矩形 [4,6]×[4,6]
  const c0 = hpFromNumber(0, 0);
  const c1 = hpFromNumber(10, 0);
  const M = hpFromNumber(5, 10);
  const R = rectFromNumber(4, 4, 2, 2);
  const ivs = occlusionIntervals(c0, c1, M, R);
  assert.equal(ivs.length, 1);
  assert.equal(rCmp(ivs[0].uStart, rat(1n, 4n)), 0);
  assert.equal(rCmp(ivs[0].uEnd, rat(3n, 4n)), 0);
  assert.equal(ivs[0].tangent, false);
});

test('场景B：相机轨迹擦过矩形顶点 → 仅 u=1/2 瞬时相切', () => {
  // 相机 (0,2)->(8,10) 经过顶点 (4,6)，标记 (0,10)，矩形 [4,6]×[4,6]
  const c0 = hpFromNumber(0, 2);
  const c1 = hpFromNumber(8, 10);
  const M = hpFromNumber(0, 10);
  const R = rectFromNumber(4, 4, 2, 2);
  const ivs = occlusionIntervals(c0, c1, M, R);
  assert.equal(ivs.length, 1);
  assert.equal(rCmp(ivs[0].uStart, rat(1n, 2n)), 0);
  assert.equal(rCmp(ivs[0].uEnd, rat(1n, 2n)), 0);
  assert.equal(ivs[0].tangent, true);
});

test('场景C：全程安全 → 无区间', () => {
  const c0 = hpFromNumber(0, 0);
  const c1 = hpFromNumber(10, 0);
  const M = hpFromNumber(5, -10);
  const R = rectFromNumber(4, 4, 2, 2);
  assert.equal(occlusionIntervals(c0, c1, M, R).length, 0);
});

test('相机全程位于矩形内 → 整段遮挡 [0,1]', () => {
  const c0 = hpFromNumber(4.5, 5);
  const c1 = hpFromNumber(5.5, 5);
  const M = hpFromNumber(0, 0);
  const R = rectFromNumber(4, 4, 2, 2);
  const ivs = occlusionIntervals(c0, c1, M, R);
  assert.equal(ivs.length, 1);
  assert.equal(rCmp(ivs[0].uStart, rat(0n)), 0);
  assert.equal(rCmp(ivs[0].uEnd, rat(1n)), 0);
});

test('相机穿过矩形：遮挡区间为 [1/3, 11/12]（含离开后视线仍被挡的部分）', () => {
  // 相机 (2,5)->(8,5) 穿过矩形 [4,6]×[4,6]：u∈[1/3, 2/3] 相机在矩形内；
  // 之后视线仍被矩形遮挡，直到 u=11/12（相机 (7.5,5)，视线掠过角点 (6,4)）。
  const c0 = hpFromNumber(2, 5);
  const c1 = hpFromNumber(8, 5);
  const M = hpFromNumber(0, 0);
  const R = rectFromNumber(4, 4, 2, 2);
  const ivs = occlusionIntervals(c0, c1, M, R);
  assert.equal(ivs.length, 1);
  assert.equal(rCmp(ivs[0].uStart, rat(1n, 3n)), 0);
  assert.equal(rCmp(ivs[0].uEnd, rat(11n, 12n)), 0);
});

test('标记在矩形另一侧：相机经过标记与矩形之间时不遮挡', () => {
  // 标记 (0,0)，矩形 [4,6]×[-1,1]，相机竖直路径 x=2 在标记与矩形之间
  const c0 = hpFromNumber(2, -10);
  const c1 = hpFromNumber(2, 10);
  const M = hpFromNumber(0, 0);
  const R = rectFromNumber(4, -1, 2, 2);
  assert.equal(occlusionIntervals(c0, c1, M, R).length, 0);
});

test('静止相机（零长度段）也能判定', () => {
  const c0 = hpFromNumber(0, 0);
  const M = hpFromNumber(10, 10);
  const R = rectFromNumber(4, 4, 2, 2);
  const ivs = occlusionIntervals(c0, c0, M, R);
  assert.equal(ivs.length, 1);
  assert.equal(rCmp(ivs[0].uStart, rat(0n)), 0);
  assert.equal(rCmp(ivs[0].uEnd, rat(1n)), 0);
});

/* ---------------- 整体分析 ---------------- */

test('analyzePlan：最早遮挡证据与时间映射', () => {
  const res = analyzePlan({
    keyframes: [
      { t: 0, x: 0, y: 0 },
      { t: 10, x: 10, y: 0 },
    ],
    markers: [{ x: 5, y: 10 }],
    rects: [{ x: 4, y: 4, w: 2, h: 2 }],
  });
  assert.equal(res.segments.length, 1);
  const rec = res.segments[0].markers[0].rects[0];
  assert.equal(rCmp(rec.tStart, rat(5n, 2n)), 0); // t = 2.5
  assert.equal(rCmp(rec.tEnd, rat(15n, 2n)), 0); // t = 7.5
  assert.ok(res.earliest);
  assert.equal(rCmp(res.earliest.t, rat(5n, 2n)), 0);
  const cam = res.earliest.cam;
  // 相机位置 (2.5, 0)
  assert.equal(cam.x * 2n, cam.w * 5_000_000n);
  assert.equal(cam.y, 0n);
});

test('analyzePlan：多段多标记多矩形，取全局最早', () => {
  const res = analyzePlan({
    keyframes: [
      { t: 0, x: 0, y: 0 },
      { t: 10, x: 10, y: 0 },
      { t: 20, x: 10, y: 10 },
    ],
    markers: [
      { x: 5, y: 10 },
      { x: 20, y: 5 },
    ],
    rects: [
      { x: 4, y: 4, w: 2, h: 2 },
      { x: 8, y: 2, w: 4, h: 1 },
    ],
  });
  assert.equal(res.segments.length, 2);
  // 段1：M1 被 R1 遮挡（t∈[2.5,7.5]）；M2 (20,5) 的视线也会被 R2 部分遮挡
  // 全局最早应来自段1（任何段2 的遮挡 t ≥ 10）
  assert.ok(res.earliest);
  assert.ok(rCmp(res.earliest.t, rat(10n)) < 0);
});

test('亚微秒时间轴：t=0 与 t=4e-7 两个关键帧的首个遮挡精确发生在 t=1e-7', () => {
  // 匀速段 (0,0)→(10,0)，标记 (5,±10)，矩形 [4,6]×[4,6]：
  // 几何与场景A相同（uStart=1/4），故最早遮挡 t = 4e-7·1/4 = 1e-7，而非 0。
  const res = analyzePlan({
    keyframes: [
      { t: 0, x: 0, y: 0 },
      { t: 0.0000004, x: 10, y: 0 },
    ],
    markers: [
      { x: 5, y: 10 },
      { x: 5, y: -10 },
    ],
    rects: [{ x: 4, y: 4, w: 2, h: 2 }],
  });
  assert.equal(res.segments.length, 1);
  const m1 = res.segments[0].markers[0].rects;
  const m2 = res.segments[0].markers[1].rects;
  assert.equal(m1.length, 1);
  assert.equal(m2.length, 0); // (5,-10) 全段安全
  assert.equal(rCmp(m1[0].uStart, rat(1n, 4n)), 0);
  assert.equal(rCmp(m1[0].uEnd, rat(3n, 4n)), 0);
  assert.equal(rCmp(m1[0].tStart, rat(1n, 10_000_000n)), 0); // t = 0.0000001
  assert.equal(rCmp(m1[0].tEnd, rat(3n, 10_000_000n)), 0); // t = 0.0000003
  assert.ok(res.earliest);
  assert.equal(rCmp(res.earliest.t, rat(1n, 10_000_000n)), 0);
  assert.ok(rCmp(res.earliest.t, rat(0n)) > 0);
  // 首个遮挡证据的相机位置为 (2.5, 0)（段参数 1/4 处，齐次分母为 u 的分母 4）
  const cam = res.earliest.cam;
  assert.equal(cam.x, cam.w * 2_500_000n);
  assert.equal(cam.y, 0n);
  assert.equal(ratToNumber(res.earliest.t), 0.0000001);
});

test('cameraAtTime：浮点插值与钳制', () => {
  const kfs = [
    { t: 0, x: 0, y: 0 },
    { t: 10, x: 10, y: 0 },
    { t: 20, x: 10, y: 10 },
  ];
  assert.deepEqual(cameraAtTime(kfs, 5), { x: 5, y: 0, segIndex: 0 });
  assert.deepEqual(cameraAtTime(kfs, 15), { x: 10, y: 5, segIndex: 1 });
  assert.deepEqual(cameraAtTime(kfs, -1), { x: 0, y: 0, segIndex: 0 });
  assert.deepEqual(cameraAtTime(kfs, 99), { x: 10, y: 10, segIndex: 1 });
});
