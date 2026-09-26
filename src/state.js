/**
 * state.js —— 方案约束校核（纯函数，无 DOM 依赖）。
 */

export const LIMITS = {
  keyframes: { min: 2, max: 4 },
  markers: { min: 2, max: 6 },
  rects: { min: 1, max: 4 },
};

/** 点是否落在闭矩形内（含边界），浮点版本（仅用于输入校核）。 */
export function pointInRectClosed(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** 按时间排序的关键帧（相机沿此顺序匀速直线移动）。 */
export function sortedKeyframes(plan) {
  return [...plan.keyframes].sort((a, b) => a.t - b.t);
}

const allFinite = (arr, fields) =>
  arr.every((o) => fields.every((f) => Number.isFinite(o[f])));

/**
 * 校核拍摄方案约束。
 * 返回 { ok, errors, warnings }：
 *  - errors：违反硬约束（数量、时间严格递增、标记点落在保护矩形内等），禁止给出结论；
 *  - warnings：可继续但值得注意（如关键帧位于保护矩形内）。
 */
export function validatePlan(plan) {
  const errors = [];
  const warnings = [];
  const { keyframes, markers, rects } = plan;

  if (
    !allFinite(keyframes, ['t', 'x', 'y']) ||
    !allFinite(markers, ['x', 'y']) ||
    !allFinite(rects, ['x', 'y', 'w', 'h'])
  ) {
    errors.push('存在非法数值（NaN 或 Infinity），请检查输入。');
  }

  if (keyframes.length < LIMITS.keyframes.min || keyframes.length > LIMITS.keyframes.max) {
    errors.push(
      `相机关键帧数量须为 ${LIMITS.keyframes.min}–${LIMITS.keyframes.max} 个（当前 ${keyframes.length} 个）。`,
    );
  }
  if (markers.length < LIMITS.markers.min || markers.length > LIMITS.markers.max) {
    errors.push(
      `标记点数量须为 ${LIMITS.markers.min}–${LIMITS.markers.max} 个（当前 ${markers.length} 个）。`,
    );
  }
  if (rects.length < LIMITS.rects.min || rects.length > LIMITS.rects.max) {
    errors.push(
      `保护矩形数量须为 ${LIMITS.rects.min}–${LIMITS.rects.max} 个（当前 ${rects.length} 个）。`,
    );
  }

  // 时间严格递增（按时间排序后相邻不得相等）
  const sorted = sortedKeyframes(plan);
  for (let i = 0; i + 1 < sorted.length; i++) {
    if (!(sorted[i + 1].t > sorted[i].t)) {
      errors.push(`关键帧时间必须严格递增：t = ${sorted[i].t} 出现重复。`);
    }
  }

  // 矩形尺寸必须为正
  rects.forEach((r, i) => {
    if (!(r.w > 0 && r.h > 0)) {
      errors.push(`保护矩形 R${i + 1} 的宽和高必须为正数。`);
    }
  });

  // 标记点不得落在保护矩形内（含边界）
  const validRects = rects.filter((r) => r.w > 0 && r.h > 0);
  markers.forEach((m, mi) => {
    validRects.forEach((r, ri) => {
      if (pointInRectClosed(m.x, m.y, r)) {
        errors.push(`标记点 M${mi + 1} 落在保护矩形 R${ri + 1} 内（含边界），请移动标记点。`);
      }
    });
  });

  // 关键帧位于保护矩形内 → 警告（该处视线必然被遮挡）
  sorted.forEach((k, ki) => {
    validRects.forEach((r, ri) => {
      if (pointInRectClosed(k.x, k.y, r)) {
        warnings.push(`关键帧 K${ki + 1} 位于保护矩形 R${ri + 1} 内，该位置的视线必然被遮挡。`);
      }
    });
  });

  return { ok: errors.length === 0, errors, warnings };
}
