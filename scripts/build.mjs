#!/usr/bin/env node
/**
 * build.mjs —— 零依赖构建：
 *  1) 对所有 JS 做语法检查（node --check，按 package.json 的 type=module 解析）；
 *  2) 校验相对 import 均可解析（防止发布后 404）；
 *  3) 拷贝 index.html 与 src/ 到 dist/，并生成构建清单。
 * 任一环节失败以非零退出码结束。
 */
import { rm, mkdir, cp, readdir, stat, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, relative, dirname, resolve } from 'node:path';

const root = process.cwd();
const jsFiles = [];

async function collect(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await collect(p);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) jsFiles.push(p);
  }
}

await collect(join(root, 'src'));
await collect(join(root, 'scripts'));
await collect(join(root, 'tests'));

// 1) 语法检查
for (const f of jsFiles) {
  execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
}
console.log(`build: ${jsFiles.length} 个 JS 文件语法检查通过`);

// 2) import 解析检查
const importRe =
  /(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
for (const f of jsFiles) {
  const src = await readFile(f, 'utf8');
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const spec = m[1] || m[2];
    const target = resolve(dirname(f), spec);
    try {
      await stat(target);
    } catch {
      console.error(`build: 无法解析的 import '${spec}'（${relative(root, f)}）`);
      process.exit(1);
    }
  }
}
console.log('build: 全部相对 import 解析通过');

// 3) 产出 dist/
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, 'index.html'), join(dist, 'index.html'));
await cp(join(root, 'src'), join(dist, 'src'), { recursive: true });
await writeFile(
  join(dist, 'build-manifest.json'),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      files: jsFiles.map((f) => relative(root, f)).sort(),
    },
    null,
    2,
  ) + '\n',
);
console.log('build: dist/ 已生成（index.html + src/ + build-manifest.json）');
