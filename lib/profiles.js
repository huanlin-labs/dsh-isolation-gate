/**
 * 门禁 · 策略档（profile）
 *
 * 一个「档」= 一套判定规则：
 *   - blocklist：名单里的对象按三级管，其余不管（旧行为）
 *   - allowlist：只允许 allow 里列出的路径与级别，其余一律拒
 *   - sealed   ：allowlist + 禁网 + 未知工具一律拒
 *
 * 会话与档的关系：会话不定义规则，只**挂**一个档。
 * 解析优先级：会话覆盖（sessionId）> 会话目录绑定（.dsh-gate.json）> 全局默认档。
 *
 * 纯函数、无 I/O —— 自测可直接调。
 */

import { win32 } from 'node:path';

export const MODES = ['blocklist', 'allowlist', 'sealed'];
export const LEVEL_RANK = { deny: 0, read: 1, full: 2 };

/** 工具名 → 是否属于"联网类"。按名字判，不看参数。 */
export const NETWORK_TOOLS = new Set([
  'web_search',
  'web_fetch',
  'web_download',
  'web_open',
  'browser',
  'browser_navigate',
  'browser_open',
  'browser_click',
  'browser_type',
  'http_request',
  'fetch_url',
]);

/** shell 文本里的联网命令（首词匹配，大小写不敏感）。 */
export const NETWORK_COMMANDS = new Set([
  'curl',
  'wget',
  'invoke-webrequest',
  'invoke-restmethod',
  'iwr',
  'irm',
  'start-bitstransfer',
  'npm',
  'pnpm',
  'yarn',
  'pip',
  'pip3',
  'git',
  'ssh',
  'scp',
  'sftp',
  'ftp',
  'telnet',
  'nc',
  'ncat',
  'aria2c',
]);

/** git 里只有这几个子命令会碰网络；`git status` 不该被拦。 */
const GIT_NETWORK_SUBCOMMANDS = new Set(['clone', 'fetch', 'pull', 'push', 'ls-remote', 'submodule']);

/** npm/pnpm/yarn 里会碰网络的子命令；`npm test` 不该被拦。 */
const PM_NETWORK_SUBCOMMANDS = new Set([
  'install',
  'i',
  'add',
  'ci',
  'publish',
  'update',
  'up',
  'upgrade',
  'audit',
  'outdated',
  'view',
  'info',
  'search',
  'exec',
  'dlx',
]);

/** pip 里会碰网络的子命令。 */
const PIP_NETWORK_SUBCOMMANDS = new Set(['install', 'download', 'wheel', 'search', 'index']);

export class ProfileError extends Error {}

/**
 * 内置档：不需要在状态文件里先定义就能用。
 * `strict` / `sealed` 的 allow 为空 —— 它们是**模板**，由所在目录的
 * `.dsh-gate.json` 在**自己的子树内**填允许项（见 narrowProfile）。
 */
export const BUILTIN_PROFILES = {
  normal: { mode: 'blocklist', label: '宽松' },
  strict: { mode: 'allowlist', allow: [], label: '严格' },
  sealed: { mode: 'sealed', allow: [], label: '全封' },
};

/**
 * 2026-10-22：档从"写死的三个"改成**用户可编辑的模板**。
 *   · builtin 三档仍作为新建时的基准（clone 出来再改）；
 *   · 自定义档可以随时改名/改条目/删除；
 *   · 会话只**挂**一个档，没挂 = 不额外限制（只走全局名单）。
 */
export const PROFILE_NAME_MAX = 40;

/** 档名的合法性：非空、≤40 字、不含路径分隔符与花括号（写进 JSON 当键用）。 */
export function isValidProfileName(name) {
  if (typeof name !== 'string') return { ok: false, reason: '名字必须是字符串' };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: '名字不能为空' };
  if (trimmed.length > PROFILE_NAME_MAX) return { ok: false, reason: `名字最长 ${PROFILE_NAME_MAX} 字` };
  if (/[\\/{}"']/.test(trimmed)) return { ok: false, reason: '名字不能含 \\ / { } " \'' };
  return { ok: true, name: trimmed };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeLevel(level) {
  return Object.prototype.hasOwnProperty.call(LEVEL_RANK, level) ? level : 'deny';
}

/** 规范化一条 allow 项；非法返回 null（不抛，便于"坏一条丢一条"）。 */
export function normalizeAllowEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const path = typeof entry.path === 'string' ? entry.path.trim() : '';
  if (!path) return null;
  const resolved = win32.isAbsolute(path) ? win32.normalize(path) : null;
  if (!resolved) return null;
  return { path: resolved.replace(/[\\/]+$/, '') || resolved, level: normalizeLevel(entry.level) };
}

/**
 * 规范化一个档。缺字段一律按"最严"补齐 —— 解析坏掉的档不该变成放行。
 * @returns {{name:string, mode:string, allow:Array<{path:string,level:string}>, network:'allow'|'deny', unknownTool:'allow'|'deny'}}
 */
export function normalizeProfile(name, raw) {
  const def = raw && typeof raw === 'object' ? raw : {};
  const mode = MODES.includes(def.mode) ? def.mode : 'sealed';
  const allow = asArray(def.allow).map(normalizeAllowEntry).filter(Boolean);
  const sealed = mode === 'sealed';
  const network = sealed ? 'deny' : def.network === 'deny' ? 'deny' : 'allow';
  const unknownTool = sealed || def.unknownTool === 'deny' ? 'deny' : 'allow';
  const label = typeof def.label === 'string' && def.label.trim() ? def.label.trim() : name;
  const builtin = BUILTIN_PROFILES[name] !== undefined;
  return { name, label, mode, allow, network, unknownTool, builtin };
}

/**
 * 从状态文件里取出所有档；兼容 v2（没有 profiles 字段 ⇒ 整体视作一个 blocklist 档）。
 * @returns {{profiles: Map<string, object>, defaultProfile: string, sessionOverrides: Record<string,string>}}
 */
export function readProfiles(state) {
  const src = state && typeof state === 'object' ? state : {};
  const profiles = new Map();
  // 内置三档永远在（作为新建模板的基准）；存盘的档覆盖同名内置。
  for (const [name, def] of Object.entries(BUILTIN_PROFILES)) {
    profiles.set(name, normalizeProfile(name, def));
  }
  if (src.profiles && typeof src.profiles === 'object') {
    for (const [name, def] of Object.entries(src.profiles)) {
      const checked = isValidProfileName(name);
      if (!checked.ok) continue;
      profiles.set(checked.name, normalizeProfile(checked.name, def));
    }
  }
  const defaultProfile =
    typeof src.defaultProfile === 'string' && profiles.has(src.defaultProfile)
      ? src.defaultProfile
      : 'normal';
  const sessionOverrides = {};
  if (src.sessionOverrides && typeof src.sessionOverrides === 'object') {
    for (const [sid, name] of Object.entries(src.sessionOverrides)) {
      if (typeof sid !== 'string' || !sid.trim()) continue;
      if (typeof name === 'string' && profiles.has(name)) sessionOverrides[sid] = name;
    }
  }
  return { profiles, defaultProfile, sessionOverrides };
}

/**
 * 选定本次调用用哪个档。
 * @param {{profiles:Map,defaultProfile:string,sessionOverrides:Record}} state
 * @param {{sessionId?:string, sessionDir?:string, dirBinding?:{profile?:string, allow?:any[]}}} hint
 */
export function pickProfile(state, hint = {}) {
  const { profiles, defaultProfile, sessionOverrides } = state;
  const sid = hint.sessionId;
  if (sid && typeof sessionOverrides[sid] === 'string' && profiles.has(sessionOverrides[sid])) {
    return { profile: profiles.get(sessionOverrides[sid]), source: 'session' };
  }
  const binding = hint.dirBinding;
  if (binding && typeof binding.profile === 'string' && profiles.has(binding.profile)) {
    const base = profiles.get(binding.profile);
    return { profile: narrowProfile(base, binding), source: 'dir' };
  }
  return { profile: profiles.get(defaultProfile), source: 'default' };
}

/**
 * 目录绑定只能**加严**：引用已定义的档 + 只允许减少 allow 条目、只允许把 network/unknownTool 收紧。
 * 传入一个想放宽的绑定 ⇒ 保持原档（并记一条 warning）。
 */
export function narrowProfile(base, binding) {
  const warnings = [];
  const dir =
    binding && typeof binding.dir === 'string'
      ? win32.normalize(binding.dir).replace(/[\\/]+$/, '')
      : null;
  const insideDir = (p) =>
    !dir ||
    p.toLowerCase() === dir.toLowerCase() ||
    p.toLowerCase().startsWith(dir.toLowerCase() + '\\');

  const rawExtra = asArray(binding && binding.allow).map(normalizeAllowEntry).filter(Boolean);
  const extra = rawExtra.filter((e) => insideDir(e.path));
  if (extra.length !== rawExtra.length) {
    warnings.push('目录绑定里有条目不在该配置文件所在子树内，已忽略（防止用配置解锁别处）');
  }

  let allow = base.allow;
  if (base.mode !== 'blocklist' && base.allow.length === 0) {
    // 模板档（strict / sealed 的 allow 为空）：由本子树内的配置定义允许项
    allow = extra;
  } else if (extra.length) {
    allow = extra
      .map((e) => {
        const b = base.allow.find((x) => x.path === e.path);
        if (!b) return null; // 新增条目 = 放宽，忽略
        return { path: b.path, level: LEVEL_RANK[e.level] < LEVEL_RANK[b.level] ? e.level : b.level };
      })
      .filter(Boolean);
    if (allow.length !== extra.length) warnings.push('目录绑定试图新增允许项，已忽略');
  }
  const mode = base.mode === 'sealed' ? 'sealed' : binding && binding.mode === 'sealed' ? 'sealed' : base.mode;
  const network = base.network === 'deny' ? 'deny' : binding && binding.network === 'deny' ? 'deny' : 'allow';
  const unknownTool =
    base.unknownTool === 'deny' || (binding && binding.unknownTool === 'deny') ? 'deny' : 'allow';
  return { ...base, mode, allow, network, unknownTool, warnings };
}

/** 目标路径是否落在 allow 列表内（前缀匹配，按路径段边界，避免 D:\a 命中 D:\ab）。 */
export function matchAllow(profile, targetPath) {
  if (!profile || !Array.isArray(profile.allow) || profile.allow.length === 0) return null;
  if (typeof targetPath !== 'string' || !win32.isAbsolute(targetPath)) return null;
  const target = win32.normalize(targetPath).replace(/[\\/]+$/, '') || targetPath;
  let best = null;
  for (const entry of profile.allow) {
    const base = entry.path;
    const same = target.toLowerCase() === base.toLowerCase();
    const inside = target.toLowerCase().startsWith(base.toLowerCase() + '\\');
    if (same || inside) {
      if (!best || base.length > best.path.length) best = entry;
    }
  }
  return best;
}

/** 联网工具名判定。 */
export function isNetworkTool(toolName) {
  return typeof toolName === 'string' && NETWORK_TOOLS.has(toolName.toLowerCase());
}

/**
 * shell 文本是否在"联网"。
 * 只认首词与已知子命令，避免把 `npm test`、`git status` 误判成联网。
 */
export function isNetworkCommand(commandText) {
  if (typeof commandText !== 'string' || !commandText.trim()) return false;
  // 取第一段（允许 `cd x && curl ...` 这种链式：逐段看）
  const segments = commandText.split(/&&|\|\||[;|]/);
  for (const segment of segments) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let head = words[0].toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
    if (head === 'sudo' || head === 'doas') {
      words.shift();
      head = (words[0] || '').toLowerCase();
    }
    if (!NETWORK_COMMANDS.has(head)) continue;
    if (head === 'git') {
      const sub = (words[1] || '').toLowerCase();
      if (GIT_NETWORK_SUBCOMMANDS.has(sub)) return true;
      continue;
    }
    if (head === 'npm' || head === 'pnpm' || head === 'yarn') {
      if (words.length === 1) return true; // 裸执行 npm 会打印帮助，不联网；保守起见仍当联网
      const sub = words[1].toLowerCase();
      if (PM_NETWORK_SUBCOMMANDS.has(sub)) return true;
      continue;
    }
    if (head === 'pip' || head === 'pip3') {
      const sub = (words[1] || '').toLowerCase();
      if (PIP_NETWORK_SUBCOMMANDS.has(sub)) return true;
      continue;
    }
    return true;
  }
  return false;
}

/**
 * 判定一次工具调用。
 * @param {object} profile 已规范化（可能经 narrowProfile）
 * @param {{tool:string, targets:Array<{op:string,path:string}>, shell:boolean, command?:string, known:boolean}} call
 * @returns {{allowed:boolean, reason:string, matched?:string}}
 */
export function evaluateCall(profile, call) {
  const p = profile || normalizeProfile('sealed', { mode: 'sealed' });
  const tool = typeof call.tool === 'string' ? call.tool : '';
  const targets = asArray(call.targets).filter((t) => t && typeof t.path === 'string');

  // 2026-10-22：blocklist 档不再"一律放行" —— 它按**自己那份清单**判：
  //   命中 deny ⇒ 拒；命中 read ⇒ 只许读；未命中 ⇒ 放行。
  //   （此前这里直接 return allowed:true，导致「宽松」模板里编的清单根本不生效。）
  if (p.mode === 'blocklist') {
    for (const t of targets) {
      const hit = matchAllow(p, t.path);
      if (!hit) continue;
      if (hit.level === 'deny') {
        return { allowed: false, reason: `「${p.label || p.name}」把这个目录设为禁：${hit.path}`, matched: hit.path };
      }
      const need = t.op === 'read' || t.op === 'traverse' ? 'read' : 'full';
      if (LEVEL_RANK[hit.level] < LEVEL_RANK[need]) {
        return {
          allowed: false,
          reason: `「${p.label || p.name}」只给 ${hit.path} 到 ${hit.level}，本次需要 ${need}`,
          matched: hit.path,
        };
      }
    }
    return { allowed: true, reason: '未命中本档的禁/只读清单' };
  }

  // allowlist / sealed：有路径就必须落在 allow 内
  if (targets.length > 0) {
    for (const t of targets) {
      const hit = matchAllow(p, t.path);
      if (!hit) {
        return { allowed: false, reason: `不在本档允许的目录内（${p.name}）`, matched: t.path };
      }
      const need = t.op === 'read' || t.op === 'traverse' ? 'read' : 'full';
      if (LEVEL_RANK[hit.level] < LEVEL_RANK[need]) {
        return { allowed: false, reason: `允许级别不足：${hit.path} 只给到 ${hit.level}，本次需要 ${need}`, matched: hit.path };
      }
    }
  }

  if (p.mode === 'sealed') {
    if (isNetworkTool(tool)) return { allowed: false, reason: '本档禁止联网（工具）', matched: tool };
    if (call.shell && isNetworkCommand(call.command)) return { allowed: false, reason: '本档禁止联网（命令）', matched: call.command };
    // shell 里认不出任何路径 ⇒ 无法确认它只碰允许目录，按拒绝处理
    if (call.shell && targets.length === 0) {
      return { allowed: false, reason: '无法确认这条命令会动哪些路径，按拒绝处理', matched: tool };
    }
  }

  if (p.unknownTool === 'deny' && call.known === false) {
    return { allowed: false, reason: '本档不认识这个工具，按拒绝处理', matched: tool };
  }

  return { allowed: true, reason: targets.length ? '落在允许目录内' : '无路径目标，规则未禁止' };
}
