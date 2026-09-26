# 水下遗址摄影 · 滑轨视线遮挡校核

纯前端应用（零依赖、原生 ES Modules）：摄影师在浏览器画布上布置**相机滑轨关键帧**、
**待拍标记点**与**保护矩形**，点击「校核」后对每一段匀速直线移动做**连续精确**的
视线遮挡判定（非抽样时刻），并给出安全区间 / 最早遮挡时刻及涉及的标记、矩形与相机位置。

## 功能

- 画布拖拽 + 数值录入两种编辑方式：
  - 相机关键帧 2–4 个（时间严格递增，相邻关键帧间匀速直线移动）；
  - 待拍标记点 2–6 个（不得落在保护矩形内，含边界）；
  - 保护矩形 1–4 个（轴对齐，视线不得与其相交或相切）。
- 点击「校核」：对每个「移动段 × 标记点 × 保护矩形」做连续精确判定，
  输出每段每个标记的安全/遮挡区间（含瞬时相切），并给出全局最早遮挡证据
  （时刻、相机位置、标记、矩形、所在移动段、是否相切）。
- 若移动中首次擦到保护边界：红色横幅立即提示「曝光不可执行」，
  画布自动定位到最早遮挡时刻并高亮首个遮挡证据（相机位置、视线、矩形），
  可拖动时间轴逐帧复核；播放按钮可动画回放整个移动过程。
- 首次校核后，任何编辑（拖拽/录入/增删）都会自动复核，结果不会过期。

## 判定方法（连续精确，非抽样）

相机在相邻关键帧间匀速直线运动：`C(u) = C0 + u·(C1−C0)`，`u ∈ [0,1]`。
视线段 `C(u)M` 与矩形 `R` 的相交/相切状态只可能在以下**事件时刻**改变：

1. 视线恰好扫过矩形某顶点（`C(u)`、`M`、顶点共线）——关于 `u` 的一次方程；
2. 相机自身穿过矩形边界（进入/离开矩形）。

所有事件时刻均为有理数，用 **BigInt 有理数精确求解**；相邻事件之间状态恒定，
在每个开区间中点精确判定一次，即可还原整个遮挡集合（区间退化为一点即"瞬时相切"）。
全部判定在整数/有理数域完成，不引入浮点误差（浮点仅用于界面展示）。

核心实现：`src/geometry.js`（纯函数，无 DOM，浏览器与 Node 通用）。

## 本地运行

```bash
npm run dev        # 开发服务器 http://localhost:5173
```

无需安装任何依赖（要求 Node ≥ 20；也可以直接用任意静态服务器托管本目录）。

## 测试 / 构建 / 冒烟

```bash
npm test           # 单元测试（node:test，几何核心 + 约束校核）
npm run build      # 构建：语法检查 + import 解析校验 + 产出 dist/
npm run smoke      # 遮挡判定冒烟：与手工推导的解析解做精确（有理数）对比
npm run verify     # 上述三步一次跑完，任一失败即非零退出
```

## Docker

```bash
# 启动 Web 服务（宿主机端口默认 8080，可用 WEB_PORT 覆盖）
docker compose up --build web
WEB_PORT=9000 docker compose up --build web
# 打开 http://localhost:8080 （或对应端口）

# 一次性校核服务：测试 + 构建 + 遮挡判定冒烟，退出码即结果
docker compose run --rm verify
echo $?              # 0 = 全部通过
# 或：docker compose up --exit-code-from verify verify
```

- `web` 服务基于 `nginx:alpine`，内置 `/healthz` 健康检查端点
  （Dockerfile `HEALTHCHECK` 与 compose `healthcheck` 双重配置）。
- `verify` 服务基于 `node:22-alpine`，执行 `npm run verify` 后自行退出。

## 目录结构

```
index.html            页面入口
src/
  geometry.js         精确几何核心（BigInt 有理数、事件驱动连续判定）
  state.js            方案约束校核（数量/时间递增/标记不在矩形内）
  main.js             画布编辑器与交互（拖拽、校核、证据定位、播放）
  style.css           样式
tests/                单元测试（node:test）
scripts/
  build.mjs           零依赖构建（语法检查 + import 校验 + dist/）
  serve.mjs           本地开发静态服务器
  smoke.mjs           遮挡判定冒烟（与解析解精确对比）
Dockerfile            多阶段：build / verify / web
docker-compose.yml    web（端口可配、健康检查）+ verify（一次性）
nginx.conf            静态服务 + /healthz
```
