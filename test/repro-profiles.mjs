// 复现脚本：用最小渲染器跑 ProfilesEditor，点「加进清单」，抓真实异常
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SRC = fs.readFileSync(path.resolve('lib/client.js'), 'utf8')
const HOST = new Set(['div', 'span', 'button', 'input', 'section', 'label', 'a', 'p'])

let captured = null
const sandboxWindow = { __ModuleLoader__: { load: (m) => { captured = m } } }

// --- 最小 React ---
let hookIndex = 0
let states = []
let dirty = false
function useState(init) {
  const i = hookIndex++
  if (!(i in states)) states[i] = typeof init === 'function' ? init() : init
  return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; dirty = true }]
}
const React = { useState, useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(), useRef: () => ({ current: null }), createElement: null }

function walk(node, out) {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return }
  const t = node.type
  if (typeof t === 'function') {
    if (node.props && typeof node.props.label === 'string') out.push(node)
    walk(t(node.props || {}), out)
    return
  }
  out.push(node)
  walk(node.props && node.props.children, out)
}

function render(Comp) {
  hookIndex = 0
  dirty = false
  const out = []
  walk(Comp({}), out)
  return out
}

function findByLabel(nodes, label) {
  return nodes.find((n) => n && n.props && n.props.label === label)
}

// --- 载入插件 ---
const FakeReact = {
  useState,
  useEffect: () => {},
  useCallback: (f) => f,
  useMemo: (f) => f(),
  useRef: () => ({ current: null }),
  createElement: (type, props, ...kids) => ({ type, props: { ...(props || {}), children: kids.length === 1 ? kids[0] : kids } }),
}

const ctx = vm.createContext({
  window: sandboxWindow,
  console,
  setTimeout, clearTimeout,
  require: (name) => (name === 'react' ? FakeReact : {}),
  fetch: async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, profiles: [], sessionOverrides: {}, defaultProfile: 'normal', objects: [], groups: {}, dirBindings: [] }),
  }),
  document: { createElement: () => ({ style: {} }), body: { appendChild() {} } },
})
vm.runInContext(SRC, ctx, { filename: 'client.js' })

const factory = captured && captured.factory
if (!factory) throw new Error('未捕获到模块工厂')

let exportsObj = null
const fakeReact = FakeReact
const mod = factory((id) => (id === 'react' ? FakeReact : {}))
exportsObj = mod

const ProfilesEditor = mod.__selftest && mod.__selftest.ProfilesEditor
if (!ProfilesEditor) {
  console.log('__selftest 未导出 ProfilesEditor；可用键：', Object.keys(mod.__selftest || {}))
  process.exit(2)
}

try {
  await new Promise((r) => setTimeout(r, 20))
  let nodes = render(ProfilesEditor)
  const newBtn = findByLabel(nodes, '＋ 宽松组（只禁我选的，其余照常）')
  if (!newBtn) { console.log('未找到新建按钮'); process.exit(3) }
  newBtn.props.onClick()
  nodes = render(ProfilesEditor)

  const input = nodes.find((n) => n.type === 'input' && n.props && n.props.placeholder && String(n.props.placeholder).includes('某个目录'))
  input.props.onChange({ target: { value: 'E:\\' } })
  nodes = render(ProfilesEditor)

  const addBtn = findByLabel(nodes, '加进清单')
  console.log('点前按钮 disabled =', addBtn && addBtn.props.disabled)
  addBtn.props.onClick()
  nodes = render(ProfilesEditor)
  console.log('✅ 未崩溃；渲染节点数 =', nodes.length)
} catch (err) {
  console.log('❌ 复现到异常：', err && err.name, err && err.message)
  console.log((err && err.stack || '').split('\n').slice(0, 6).join('\n'))
  process.exit(1)
}
