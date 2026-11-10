const assert = require('node:assert/strict'), { test } = require('node:test')
require('ts-node').register({ project: 'tsconfig.test.json', transpileOnly: true, compilerOptions: { jsx: 'react-jsx' } })
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const Module = require('node:module'), load = Module._load
let states, cursor, effects, mounted, cached, response, apiCalls
const container = ({ children }) => React.createElement('div', null, children)
const MonthPicker = props => React.createElement('select', { 'data-month': props.value, 'data-months': props.availableMonths.join(',') })
Module._load = function (name, ...args) {
  if (name === 'react') return { ...React,
    useState: initial => {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useRef: value => ({ current: value }),
    useEffect: effect => { if (!mounted) effects.push(effect) },
  }
  if (name === '@/lib/api/client') return {
    getCachedApiData: () => cached,
    apiFetch: async url => { apiCalls.push(url); return { ok: true, data: response } },
  }
  if (name === '../AdminContext') return { useAdmin: () => ({ mounted: true }) }
  if (name === '@/components/ui/MonthPicker') return { __esModule: true, default: MonthPicker }
  if (name === 'next/link' || name === '@/components/ui/Card' || name === '@/components/ui/Button') return { __esModule: true, default: container }
  if (name.startsWith('@/components/')) return { __esModule: true, default: () => null }
  return load.call(this, name, ...args)
}
const Page = require('../app/admin/chapters/page').default
Module._load = load

function render() { cursor = 0; return Page() }
function picker(tree) {
  if (!tree || typeof tree !== 'object') return null
  if (tree.type === MonthPicker) return tree
  return React.Children.toArray(tree.props?.children).map(picker).find(Boolean)
}
async function mount(data, fromCache) {
  states = []; effects = []; mounted = false; apiCalls = []
  cached = fromCache ? data : null; response = data
  render()
  mounted = true
  for (const effect of effects) effect()
  await new Promise(resolve => setImmediate(resolve))
  return render()
}
const waiting = reasonCode => ({ state: 'AWAITING_SNAPSHOT', reasonCode, items: [], excluded: [], monthKey: '2020-10', availableMonths: ['2020-11', '2020-10'] })

for (const fromCache of [false, true]) test(`Chapter page explains missing history after ${fromCache ? 'cache hydration' : 'API fetch'}`, async () => {
  const tree = await mount(waiting('SNAPSHOT_MISSING'), fromCache)
  const html = renderToStaticMarkup(tree)
  assert.match(html, /Tháng này chưa có dữ liệu lịch sử/)
  assert.doesNotMatch(html, /Vui lòng tạo chapter hoặc mời Trưởng Chapter/)
  assert.match(html, /data-reason-code="SNAPSHOT_MISSING"/)
  assert.deepEqual(picker(tree).props.availableMonths, ['2020-11', '2020-10'])
  assert.equal(picker(tree).props.value, '2020-10')
})

test('Chapter page updates missing-history state and reason when switching months', async () => {
  let tree = await mount(waiting('SNAPSHOT_MISSING'), true)
  response = { state: 'FINALIZED', items: [], excluded: [], monthKey: '2020-11', availableMonths: ['2020-11', '2020-10'] }
  picker(tree).props.onChange('2020-11')
  await new Promise(resolve => setImmediate(resolve))
  tree = render()
  assert.doesNotMatch(renderToStaticMarkup(tree), /Tháng này chưa có dữ liệu lịch sử/)
  response = waiting('SNAPSHOT_DATA_MISSING')
  picker(tree).props.onChange('2020-10')
  await new Promise(resolve => setImmediate(resolve))
  const html = renderToStaticMarkup(render())
  assert.match(html, /Tháng này chưa có dữ liệu lịch sử/)
  assert.match(html, /data-reason-code="SNAPSHOT_DATA_MISSING"/)
  assert.deepEqual(apiCalls, ['/api/v1/leaderboard/chapters?month=2020-11', '/api/v1/leaderboard/chapters?month=2020-10'])
})
