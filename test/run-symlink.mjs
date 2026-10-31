/**
 * 套件：链接绕过（junction / symlink）
 *
 * 目的：把受管目录做成链接换个名字，不能因此拿到权限 —— 判定必须落在**真身路径**上，
 * 而不是调用者写的那个字符串。
 *
 * 说明：`lib/guard.js` 的 `checkAccess` 是全系统**唯一**判定点（GUI / HTTP / bin/gate.mjs
 * 都调它），所以这里直接打它；CLI 的接线由 run-cli 套件覆盖。
 *
 * 覆盖：
 *   ① allowed 目录里的 junction 指向 deny 目录 ⇒ 经它读文件必须被拒，且命中的是 deny 对象
 *   ② 反向：deny 目录里的 junction 指向 read 目录 ⇒ 经它读文件放行（目标说了算）
 *   ③ 目标还不存在（准备新建）⇒ 用"最深已存在祖先"的真身判定，仍拒
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkAccess } from '../lib/guard.js';

const ROOT = mkdtempSync(join(tmpdir(), 'gate-link-'));
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** 两个路径对象 + 各自级别。 */
function probe(path, op = 'read') {
  return checkAccess({
    state: {
      defaultLevel: 'deny',
      harnesses: { [ALLOWED]: { level: 'read' }, [SECRET]: { level: 'deny' } },
    },
    rosterObjects: [
      { kind: 'path', key: ALLOWED, raw: ALLOWED },
      { kind: 'path', key: SECRET, raw: SECRET },
    ],
    path,
    op,
  });
}

const ALLOWED = join(ROOT, 'allowed');
const SECRET = join(ROOT, 'secret');

try {
  mkdirSync(ALLOWED, { recursive: true });
  mkdirSync(SECRET, { recursive: true });
  writeFileSync(join(SECRET, 'secret.txt'), 'top secret');
  // Windows 的 junction 不需要管理员权限；POSIX 用目录符号链接
  symlinkSync(SECRET, join(ALLOWED, 'link'), process.platform === 'win32' ? 'junction' : 'dir');

  // ① 经链接读禁区
  const viaLink = probe(join(ALLOWED, 'link', 'secret.txt'));
  assert('经过 junction 读受管禁目录 ⇒ 拒绝', viaLink.allowed === false, JSON.stringify(viaLink));
  assert(
    '命中对象是真身（secret 而非 allowed）',
    String(viaLink.matchedKey ?? '').toLowerCase().endsWith('secret'),
    `matchedKey=${viaLink.matchedKey}`,
  );

  // ② 反向：禁目录里的链接指向只读目录 ⇒ 按目标判定，放行
  const OTHER = mkdtempSync(join(tmpdir(), 'gate-link2-'));
  const DENIED = join(OTHER, 'denied');
  const OPEN = join(OTHER, 'open');
  mkdirSync(DENIED, { recursive: true });
  mkdirSync(OPEN, { recursive: true });
  writeFileSync(join(OPEN, 'ok.txt'), 'fine');
  symlinkSync(OPEN, join(DENIED, 'into-open'), process.platform === 'win32' ? 'junction' : 'dir');
  const reverse = checkAccess({
    state: { defaultLevel: 'deny', harnesses: { [DENIED]: { level: 'deny' }, [OPEN]: { level: 'read' } } },
    rosterObjects: [
      { kind: 'path', key: DENIED, raw: DENIED },
      { kind: 'path', key: OPEN, raw: OPEN },
    ],
    path: join(DENIED, 'into-open', 'ok.txt'),
    op: 'read',
  });
  assert('禁目录里的 junction 指向只读目录 ⇒ 放行（目标说了算）', reverse.allowed === true, JSON.stringify(reverse));
  rmSync(OTHER, { recursive: true, force: true });

  // ③ 经链接写一个还不存在的文件（前缀要按真身祖先算）
  const notYet = probe(join(ALLOWED, 'link', 'will-be-created.txt'), 'write');
  assert('经链接写还不存在的文件 ⇒ 仍拒', notYet.allowed === false, JSON.stringify(notYet));

  console.log(failed === 0 ? '\n链接绕过套件：全部通过' : `\n链接绕过套件：${failed} 条失败`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}
