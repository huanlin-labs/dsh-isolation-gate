/**
 * 门禁 · 跑全部自测（不需要 dsh、不需要 GUI）
 *
 *   node test/run-all.mjs [报告目录]
 *
 * stdio 用 inherit（不走管道），受限壳里也能跑。全部通过才 exit 0。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
mkdirSync(reportDir, { recursive: true });

const suites = [
  ['数据层（状态 / 名单 / 差异）', join(import.meta.dirname, 'run-data-layer.mjs')],
  ['受管辖通道（含默认禁与 fail-closed 负向证据）', join(import.meta.dirname, 'run-guard.mjs')],
  ['策略档（profile / 会话绑定 / 联网软禁）', join(import.meta.dirname, 'run-profiles.mjs')],
  ['宿主路由', join(import.meta.dirname, 'run-routes.mjs')],
  ['客户端（槽位 / 渲染 / 交互）', join(import.meta.dirname, 'run-client.mjs')],
];

const results = [];
for (const [label, script] of suites) {
  console.log(`\n########## ${label}：${script} ##########`);
  const result = spawnSync(process.execPath, [script, reportDir], { stdio: 'inherit' });
  results.push({ label, script, code: result.status });
}

console.log('\n########## 汇总 ##########');
for (const row of results) {
  console.log(`${row.code === 0 ? 'PASS' : 'FAIL'}  ${row.label}  (exit ${row.code})`);
}
const failed = results.filter((row) => row.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} 个套件通过 · 报告目录 ${reportDir}`);
process.exit(failed.length === 0 ? 0 : 1);
