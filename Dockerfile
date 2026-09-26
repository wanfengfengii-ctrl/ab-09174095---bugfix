# syntax=docker/dockerfile:1

# ============================================================
# 水下遗址摄影 · 滑轨视线遮挡校核（纯前端，零运行时依赖）
#
# 目标：
#   web    —— nginx 静态服务（含健康检查），默认暴露 80
#   verify —— 一次性服务：代码测试 + 构建 + 遮挡判定冒烟，以退出码报告
# ============================================================

# ---- 构建阶段：产出 dist/ 静态文件 ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY index.html ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
RUN npm run build

# ---- 一次性校核服务：测试 + 构建 + 遮挡判定冒烟 ----
FROM node:22-alpine AS verify
WORKDIR /app
COPY package.json ./
COPY index.html ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
# npm run verify = node --test（单元测试） + build（构建） + smoke（遮挡判定冒烟）
# 任一环节失败即非零退出
CMD ["npm", "run", "verify"]

# ---- 运行阶段：nginx 静态服务 + 健康检查 ----
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
