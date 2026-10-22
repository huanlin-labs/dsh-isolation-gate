/**
 * 门禁 · 策略档运行时（有 I/O，但只在工具门前同步跑）
 *
 * 职责：
 *   ① 从状态文件读档表（带 mtime 缓存；解析失败 ⇒ 只剩 sealed 档，fail-closed）
 *   ② 从目标路径向上找 `.dsh-gate.json`（带 mtime 缓存；坏文件 ⇒ 按 sealed 处理）
 *   ③ 合并成"这次调用用哪个档"，再交给纯函数 evaluateCall 判定
 *
 * 语义：`.dsh-gate.json` 管的是**它所在的这棵子树**，不是某个会话 —— 谁碰这棵树都按这档。
 * 会话覆盖（state.sessionOverrides[sessionId]）优先，用于一次性严苛任务。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { win32 } from 'node:path';
import { BUILTIN_PROFILES, evaluateCall, narrowProfile, normalizeProfile, readProfiles } from './profiles.js';

const BINDING_FILE = '.dsh-gate.json';
const MAX_DEPTH = 8;

/** @type {Map<string, {mtimeMs:number, value:any}>} */
const stateCache = new Map();
/** @type {Map<string, {mtimeMs:number, value:any}>} */
const bindingCache = new Map();

function statMtime(filePath) {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/** 读状态文件里的档配置；文件不存在 ⇒ 内置档（normal/strict/sealed）。 */
export function loadProfileState(statePath) {
  if (typeof statePath !== 'string' || statePath.trim() === '') {
    return { profiles: builtinMap(), defaultProfile: 'normal', sessionOverrides: {} };
  }
  const mtime = statMtime(statePath);
  if (mtime === null) {
    return { profiles: builtinMap(), defaultProfile: 'normal', sessionOverrides: {} };
  }
  const hit = stateCache.get(statePath);
  if (hit && hit.mtimeMs === mtime) return hit.value;

  let value;
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    value = readProfiles(raw);
    // 状态里没写 profiles ⇒ 补上内置模板档，方便直接引用 strict / sealed
    for (const [name, def] of Object.entries(BUILTIN_PROFILES)) {
      if (!value.profiles.has(name)) value.profiles.set(name, normalizeProfile(name, def));
    }
  } catch (error) {
    // 状态文件坏了：只留一个全拒档 —— 宁可停摆，不可放行。
    const sealed = new Map([['sealed', normalizeProfile('sealed', { mode: 'sealed' })]]);
    value = { profiles: sealed, defaultProfile: 'sealed', sessionOverrides: {}, error: error?.message };
  }
  stateCache.set(statePath, { mtimeMs: mtime, value });
  return value;
}

function builtinMap() {
  const map = new Map();
  for (const [name, def] of Object.entries(BUILTIN_PROFILES)) map.set(name, normalizeProfile(name, def));
  return map;
}

/**
 * 从目标路径向上找最近的 `.dsh-gate.json`。
 * @returns {{dir:string, profile?:string, allow?:any[], network?:string, unknownTool?:string, broken?:boolean}|null}
 */
export function findDirBinding(targetPath) {
  if (typeof targetPath !== 'string' || !win32.isAbsolute(targetPath)) return null;
  let dir = win32.dirname(win32.normalize(targetPath));
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const filePath = win32.join(dir, BINDING_FILE);
    if (existsSync(filePath)) {
      const mtime = statMtime(filePath);
      const hit = bindingCache.get(filePath);
      if (hit && hit.mtimeMs === mtime) return { ...hit.value, dir };
      let value;
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        value =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? { profile: typeof parsed.profile === 'string' ? parsed.profile : undefined, ...parsed }
            : { broken: true };
      } catch {
        value = { broken: true };
      }
      bindingCache.set(filePath, { mtimeMs: mtime, value });
      return { ...value, dir };
    }
    const parent = win32.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * 一次工具调用的完整判定（含档解析）。
 * @param {string} statePath
 * @param {{sessionId?:string, tool:string, targets:Array<{op:string,path:string}>, shell?:boolean, command?:string, known?:boolean}} call
 * @returns {{allowed:boolean, reason:string, profile?:string, source?:string, matched?:string}}
 */
export function decideWithProfiles(statePath, call) {
  const state = loadProfileState(statePath);
  const sid = typeof call.sessionId === 'string' ? call.sessionId : '';
  const override = sid && state.sessionOverrides[sid];

  // 会话覆盖：整次调用都按这一档（含联网与未知工具判定）
  if (override && state.profiles.has(override)) {
    const profile = state.profiles.get(override);
    const result = evaluateCall(profile, call);
    return { ...result, profile: profile.name, source: 'session' };
  }

  // 目录绑定：逐个目标各自找配置；任一目标被拒即拒。
  // 没有目标（如 web_search）时只按默认档判 —— 网络工具在 sealed 默认档下会被拦。
  const targets = Array.isArray(call.targets) ? call.targets : [];
  let source = 'default';
  let usedProfile = state.profiles.get(state.defaultProfile);

  for (const target of targets) {
    const binding = findDirBinding(target.path);
    if (!binding) continue;
    if (binding.broken) {
      return {
        allowed: false,
        reason: `${BINDING_FILE} 无法解析，按 sealed 处理`,
        profile: 'sealed',
        source: 'dir',
        matched: target.path,
      };
    }
    const baseName = binding.profile && state.profiles.has(binding.profile) ? binding.profile : state.defaultProfile;
    const base = state.profiles.get(baseName);
    const profile = narrowProfile(base, binding);
    const result = evaluateCall(profile, { ...call, targets: [target] });
    source = 'dir';
    usedProfile = profile;
    if (!result.allowed) return { ...result, profile: profile.name, source };
  }

  // 没有目录配置的目标：退回默认档
  const result = evaluateCall(usedProfile, call);
  return { ...result, profile: usedProfile.name, source };
}

/** 本进程见过的目录绑定（面板展示用；不是全盘扫描）。 */
export function knownDirBindings() {
  return [...bindingCache.entries()].map(([file, hit]) => ({
    dir: win32.dirname(file),
    profile: (hit.value && hit.value.profile) || '',
    file,
  }))
}

/** 测试用：清缓存 */
export function __clearProfileCaches() {
  stateCache.clear();
  bindingCache.clear();
}
