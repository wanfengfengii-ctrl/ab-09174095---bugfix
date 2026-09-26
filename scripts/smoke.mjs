#!/usr/bin/env node
/**
 * smoke.mjs —— 遮挡判定冒烟测试（verify 服务的最后一步）。
 * 用与应用完全相同的 geometry.js，对有解析解的场景做精确断言：
 * 区间端点以 BigInt 有理数精确比较，不是浮点近似，也不是抽样。
 * 任一断言失败 → 退出码 1。
 */
import assert from 'node:assert/strict';
import { analyzePlan, rat, rCmp, hpToNumber } from '../src/geometry.js';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${String(err.message).split('\n').join('\n    ')}`);
  }
}

console.log('遮挡判定冒烟测试（连续精确判定，与解析解对比）');

// 场景 A：相机 (0,0)→(10,0)，t∈[0,10]；标记 (5,10)；矩形 [4,6]×[4,6]。
// 解析解：视线在 u=1/4 掠过顶点 (4,6) 开始遮挡，u=3/4 掠过顶点 (6,6) 结束，
// 即 t∈[2.5, 7.5]；最早遮挡 t=2.5，相机位于 (2.5, 0)。
check('场景A：遮挡区间精确等于 t∈[2.5, 7.5]，最早证据 (2.5, 0)', () => {
  const res = analyzePlan({
    keyframes: [
      { t: 0, x: 0, y: 0 },
      { t: 10, x: 10, y: 0 },
    ],
    markers: [{ x: 5, y: 10 }],
    rects: [{ x: 4, y: 4, w: 2, h: 2 }],
  });
  assert.equal(res.segments.length, 1);
  const ivs = res.segments[0].markers[0].rects;
  assert.equal(ivs.length, 1, '应恰好有一个遮挡区间');
  assert.equal(rCmp(ivs[0].uStart, rat(1n, 4n)), 0, 'uStart 应精确为 1/4');
  assert.equal(rCmp(ivs[0].uEnd, rat(3n, 4n)), 0, 'uEnd 应精确为 3/4');
  assert.equal(ivs[0].tangent, false);
  assert.equal(rCmp(ivs[0].tStart, rat(5n, 2n)), 0, 'tStart 应精确为 2.5');
  assert.equal(rCmp(ivs[0].tEnd, rat(15n, 2n)), 0, 'tEnd 应精确为 7.5');
  const cam = hpToNumber(ivs[0].camStart);
  assert.ok(Math.abs(cam.x - 2.5) < 1e-9 && Math.abs(cam.y) < 1e-9, '最早遮挡相机位置应为 (2.5, 0)');
  assert.ok(res.earliest, '应给出最早遮挡证据');
  assert.equal(rCmp(res.earliest.t, rat(5n, 2n)), 0);
});

// 场景 B：相机 (0,2)→(8,10) 的轨迹恰好擦过矩形顶点 (4,6)；标记 (0,10)。
// 解析解：仅在 u=1/2（t=5）瞬时相切，其余时刻均安全。
check('场景B：擦到保护边界的瞬时相切被精确捕获（t=5）', () => {
  const res = analyzePlan({
    keyframes: [
      { t: 0, x: 0, y: 2 },
      { t: 10, x: 8, y: 10 },
    ],
    markers: [{ x: 0, y: 10 }],
    rects: [{ x: 4, y: 4, w: 2, h: 2 }],
  });
  const ivs = res.segments[0].markers[0].rects;
  assert.equal(ivs.length, 1, '应恰好有一个瞬时遮挡');
  assert.equal(ivs[0].tangent, true, '应为瞬时相切');
  assert.equal(rCmp(ivs[0].tStart, rat(5n, 1n)), 0, '相切时刻应精确为 t=5');
  assert.equal(rCmp(res.earliest.t, rat(5n, 1n)), 0);
});

// 场景 C：视线全程远离矩形 → 无任何遮挡区间，最早遮挡为 null。
check('场景C：安全方案报告零遮挡', () => {
  const res = analyzePlan({
    keyframes: [
      { t: 0, x: 0, y: 0 },
      { t: 10, x: 10, y: 0 },
    ],
    markers: [{ x: 5, y: -10 }],
    rects: [{ x: 4, y: 4, w: 2, h: 2 }],
  });
  assert.equal(res.segments[0].markers[0].rects.length, 0);
  assert.equal(res.earliest, null);
});

// 场景 D：多段滑轨 + 多标记 + 多矩形（上下镜像对称，无意外共线）。
// 段1：M1(5,10) 被 R1[4,6]×[4,6] 遮挡 t∈[2.5,7.5]（同场景A）；
// 段2：M2(15,-10) 被 R2[14,16]×[-6,-4] 遮挡 t∈[12.5,17.5]（场景A的镜像）；
// 所有交叉组合（M1×R2、M2×R1）均安全。
check('场景D：多段方案的全局最早遮挡定位', () => {
  const res = analyzePlan({
    keyframes: [
      { t: 0, x: 0, y: 0 },
      { t: 10, x: 10, y: 0 },
      { t: 20, x: 20, y: 0 },
    ],
    markers: [
      { x: 5, y: 10 },
      { x: 15, y: -10 },
    ],
    rects: [
      { x: 4, y: 4, w: 2, h: 2 },
      { x: 14, y: -6, w: 2, h: 2 },
    ],
  });
  assert.equal(res.segments.length, 2);
  const seg1M1 = res.segments[0].markers[0].rects;
  assert.equal(seg1M1.length, 1);
  assert.equal(rCmp(seg1M1[0].tStart, rat(5n, 2n)), 0, '段1 M1 遮挡应始于 t=2.5');
  assert.equal(rCmp(seg1M1[0].tEnd, rat(15n, 2n)), 0, '段1 M1 遮挡应终于 t=7.5');
  const seg2M2 = res.segments[1].markers[1].rects;
  assert.equal(seg2M2.length, 1);
  assert.equal(rCmp(seg2M2[0].tStart, rat(25n, 2n)), 0, '段2 M2 遮挡应始于 t=12.5');
  assert.equal(rCmp(seg2M2[0].tEnd, rat(35n, 2n)), 0, '段2 M2 遮挡应终于 t=17.5');
  assert.equal(res.segments[0].markers[1].rects.length, 0, 'M2 在段1 应安全');
  assert.equal(res.segments[1].markers[0].rects.length, 0, 'M1 在段2 应安全');
  assert.equal(rCmp(res.earliest.t, rat(5n, 2n)), 0, '全局最早遮挡应为 t=2.5');
});

// 场景 E（亚微秒时间轴）：几何同场景A，但关键帧时间为 t=0 与 t=0.0000004。
// 时间在内部为精确有理数，段参数 u=1/4 映射到 t = 4e-7·1/4 = 0.0000001。
// 回归：修复前 0.0000004 被 1e6 倍取整量化为 0，首个遮挡证据错误地显示为 t=0。
check('场景E：亚微秒严格递增时间的首个遮挡精确为 t=0.0000001（非 0）', () => {
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
  const ivs = res.segments[0].markers[0].rects;
  assert.equal(ivs.length, 1, '应恰好有一个遮挡区间');
  assert.equal(rCmp(ivs[0].uStart, rat(1n, 4n)), 0, 'uStart 应精确为 1/4');
  assert.equal(rCmp(ivs[0].tStart, rat(1n, 10_000_000n)), 0, 'tStart 应精确为 0.0000001');
  assert.equal(rCmp(ivs[0].tEnd, rat(3n, 10_000_000n)), 0, 'tEnd 应精确为 0.0000003');
  assert.equal(res.segments[0].markers[1].rects.length, 0, 'M2 应全段安全');
  assert.ok(res.earliest, '应给出最早遮挡证据');
  assert.equal(rCmp(res.earliest.t, rat(1n, 10_000_000n)), 0, '最早遮挡应为 t=0.0000001');
  const cam = hpToNumber(res.earliest.cam);
  assert.ok(Math.abs(cam.x - 2.5) < 1e-9 && Math.abs(cam.y) < 1e-9, '最早遮挡相机位置应为 (2.5, 0)');
  assert.equal(Number(res.earliest.t.n) / Number(res.earliest.t.d), 0.0000001);
});

// 场景 F（贴近边界的合法标记）：关键帧 t=0 (-10,5) → t=10 (-9,5)；
// 标记 (3.9999996,5) 距矩形左边界 x=4 仅 4e-7（在矩形外），另一标记 (0,-10)；
// 两条视线均不接触矩形 [4,6]×[4,6]。
// 回归：修复前坐标被 1e-6 网格量化，3.9999996 被吸附到边界 x=4 上，
// 合法方案被误判为全程遮挡。
check('场景F：距矩形左边界 4e-7 的合法标记保持在外，全程无遮挡', () => {
  const res = analyzePlan({
    keyframes: [
      { t: 0, x: -10, y: 5 },
      { t: 10, x: -9, y: 5 },
    ],
    markers: [
      { x: 3.9999996, y: 5 },
      { x: 0, y: -10 },
    ],
    rects: [{ x: 4, y: 4, w: 2, h: 2 }],
  });
  assert.equal(res.segments.length, 1);
  assert.equal(res.segments[0].markers[0].rects.length, 0, 'M1 视线不应接触矩形');
  assert.equal(res.segments[0].markers[1].rects.length, 0, 'M2 视线不应接触矩形');
  assert.equal(res.earliest, null, '全方案应报告无任何遮挡');
});

if (failures > 0) {
  console.error(`\n冒烟失败：${failures} 项未通过`);
  process.exit(1);
}
console.log('\n冒烟通过：遮挡判定与解析解完全一致');
