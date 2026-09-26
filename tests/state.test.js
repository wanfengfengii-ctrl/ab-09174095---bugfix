import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, pointInRectClosed, sortedKeyframes } from '../src/state.js';

const basePlan = () => ({
  keyframes: [
    { t: 0, x: 0, y: 0 },
    { t: 5, x: 100, y: 0 },
  ],
  markers: [
    { x: 50, y: 80 },
    { x: 20, y: -60 },
  ],
  rects: [{ x: 40, y: 20, w: 20, h: 20 }],
});

test('合法方案通过校核', () => {
  const v = validatePlan(basePlan());
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test('数量约束：关键帧 2–4、标记 2–6、矩形 1–4', () => {
  let p = basePlan();
  p.keyframes = [{ t: 0, x: 0, y: 0 }];
  assert.equal(validatePlan(p).ok, false);

  p = basePlan();
  p.keyframes = [0, 1, 2, 3, 4].map((t) => ({ t, x: 0, y: 0 }));
  assert.equal(validatePlan(p).ok, false);

  p = basePlan();
  p.markers = [{ x: 0, y: 100 }];
  assert.equal(validatePlan(p).ok, false);

  p = basePlan();
  p.rects = [];
  assert.equal(validatePlan(p).ok, false);
});

test('关键帧时间必须严格递增（重复时间报错）', () => {
  const p = basePlan();
  p.keyframes = [
    { t: 3, x: 0, y: 0 },
    { t: 3, x: 10, y: 0 },
  ];
  const v = validatePlan(p);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('严格递增')));
});

test('亚微秒级严格递增的关键帧时间仍合法', () => {
  const p = basePlan();
  p.keyframes = [
    { t: 0, x: 0, y: 0 },
    { t: 0.0000004, x: 10, y: 0 },
  ];
  const v = validatePlan(p);
  assert.equal(v.ok, true, '0 与 0.0000004 严格递增，应通过校核');
  assert.deepEqual(v.errors, []);
});

test('标记点落在保护矩形内（含边界）报错', () => {
  const p = basePlan();
  p.markers[0] = { x: 50, y: 30 }; // 矩形 [40,60]×[20,40] 内
  let v = validatePlan(p);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('M1') && e.includes('R1')));

  p.markers[0] = { x: 40, y: 30 }; // 边界上也算
  v = validatePlan(p);
  assert.equal(v.ok, false);

  p.markers[0] = { x: 39.9, y: 30 }; // 矩形外 → 通过
  v = validatePlan(p);
  assert.equal(v.ok, true);
});

test('贴近矩形左边界的标记（距边界 4e-7，在矩形外）合法', () => {
  // 验收场景：标记 (3.9999996,5) 在矩形 [4,6]×[4,6] 左侧 4e-7 处，输入约束应允许
  const v = validatePlan({
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
  assert.equal(v.ok, true);
  assert.deepEqual(v.errors, []);
});

test('矩形宽高必须为正', () => {
  const p = basePlan();
  p.rects[0].w = 0;
  assert.equal(validatePlan(p).ok, false);
  p.rects[0].w = 20;
  p.rects[0].h = -5;
  assert.equal(validatePlan(p).ok, false);
});

test('关键帧位于矩形内仅警告，不阻断', () => {
  const p = basePlan();
  p.keyframes[1] = { t: 5, x: 50, y: 30 }; // 矩形内
  const v = validatePlan(p);
  assert.equal(v.ok, true);
  assert.equal(v.warnings.length, 1);
  assert.ok(v.warnings[0].includes('K2'));
});

test('非法数值（NaN/Infinity）报错', () => {
  const p = basePlan();
  p.markers[0].x = NaN;
  assert.equal(validatePlan(p).ok, false);
});

test('pointInRectClosed 与 sortedKeyframes', () => {
  const r = { x: 10, y: 10, w: 20, h: 20 };
  assert.equal(pointInRectClosed(30, 30, r), true);
  assert.equal(pointInRectClosed(31, 30, r), false);
  const kfs = sortedKeyframes({
    keyframes: [
      { t: 5, x: 1, y: 1 },
      { t: 0, x: 0, y: 0 },
    ],
  });
  assert.equal(kfs[0].t, 0);
  assert.equal(kfs[1].t, 5);
});
