import { expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { ageOf, flatten, migrate, parseEntry, plural, trayList } from '../hooks/tree'
import type { TreeNode } from '../types'

const PANE = {
  plugin: 'project-tree',
  component: 'Pane',
  requestId: 'project-tree',
  props: {
    title: 'Дерево проекта',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const ANCHOR = {
  sessionId: 's1',
  messageId: 'm1',
  excerpt: 'давай сделаем панель с деревом',
  at: 0,
}

const BASE = { parentId: null, source: 'person', isInbox: false, createdAt: 1, updatedAt: 1, status: 'open' } as const

// Nothing sits beneath the plugin: each hook here stands for the engine.
async function start($: Engine, on: Parameters<TestBody>[1]) {
  on('session.root', () => ({ value: '/proj' }))
  on('command.register', () => ({ value: { command: 'tree' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__project-tree__tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', () => ({ deny: 'no file' }))
  on('fs.write', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })

  const call = async (fields: object) =>
    String((await $.tool.call({ tool: 'mcp__project-tree__tree', ...fields } as never)).result)
  const add = async (fields: object) => /\[(\w+)\]/.exec(await call({ action: 'add', ...fields }))?.[1] ?? ''

  return { call, add, listed: () => call({ action: 'list' }) }
}

test('an entry reads its kind from a prefix or a word', async () => {
  expect(parseEntry('? как показывать связи')).toEqual({ kind: 'question', title: 'как показывать связи' })
  expect(parseEntry('идея: тёмная тема')).toEqual({ kind: 'idea', title: 'тёмная тема' })
  expect(parseEntry('починить сохранение')).toEqual({ kind: 'task', title: 'починить сохранение' })
  expect(parseEntry('?   ')).toBe(null)
})

test('the map holds branches and tasks; the rest waits on its tray', async () => {
  const list: TreeNode[] = [
    { ...BASE, id: 'a', kind: 'branch', title: 'a' },
    { ...BASE, id: 'b', kind: 'task', title: 'b', parentId: 'a' },
    { ...BASE, id: 'c', kind: 'question', title: 'c', parentId: 'a' },
    { ...BASE, id: 'd', kind: 'task', title: 'd', isInbox: true },
    { ...BASE, id: 'e', kind: 'note', title: 'e' },
  ]

  expect(flatten(list, []).map(row => row.node.id)).toEqual(['a', 'b'])
  expect(flatten(list, ['a']).map(row => row.node.id)).toEqual(['a'])
  expect(trayList(list, 'questions').map(node => node.id)).toEqual(['c'])
  expect(trayList(list, 'ideas').map(node => node.id)).toEqual(['d'])
  expect(trayList(list, 'findings').map(node => node.id)).toEqual(['e'])
})

test('an old file moves its closed nodes into history', async () => {
  const { nodes, events } = migrate([
    { ...BASE, id: 'a', kind: 'branch', title: 'Сайт' },
    { ...BASE, id: 'b', kind: 'task', title: 'Вёрстка', parentId: 'a', status: 'done' },
    { ...BASE, id: 'c', kind: 'decision', title: 'Хостинг', status: 'done', chosen: 'VPS' },
    { ...BASE, id: 'd', kind: 'idea', title: 'Тема', isInbox: true },
  ])

  expect(nodes.map(node => [node.id, node.isInbox])).toEqual([['a', false], ['d', false]])
  expect(events.map(event => [event.kind, event.title, event.branch])).toEqual([
    ['done', 'Вёрстка', 'Сайт'],
    ['decided', 'Хостинг → VPS', undefined],
  ])
})

test('ages and plurals read as Russian', async () => {
  const day = 86_400_000
  expect([1, 2, 5, 11, 21, 22].map(n => plural(n, ['день', 'дня', 'дней']))).toEqual(['день', 'дня', 'дней', 'дней', 'день', 'дня'])
  expect(ageOf(0, 30_000)).toBe('меньше минуты')
  expect(ageOf(0, 12 * 60_000)).toBe('12 мин')
  expect(ageOf(0, 3 * day)).toBe('3 дня')
  expect(ageOf(0, 21 * day)).toBe('3 нед')
})

test('a node typed in the pane joins the map, anchored to the last prompt', async ($, on) => {
  // Stands for the person's latest prompt, which session.append would record.
  on('state.get', { plugin: 'project-tree', key: 'lastPrompt' }, () => ({
    value: { value: ANCHOR, version: 1 },
  }))
  const { listed } = await start($, on)

  for (const [seq, surface] of (['terminal', 'desktop'] as const).entries()) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const title = `Ветка ${surface}`

    await ui.input({ key: `add:${seq}`, text: `# ${title}` })
    expect((await ui.find({ type: 'Text', text: new RegExp(title) }))?.text).toBe(title)

    const id = new RegExp(`\\[(\\w+)\\] · ветка · «${title}»`).exec(await listed())?.[1]
    expect(id).toBeDefined()

    await ui.press({ key: `row:${id}` })
    expect((await ui.find({ type: 'Text', text: /Из сообщения/ }))?.text).toContain(ANCHOR.excerpt)
    // Only the terminal lets a plugin scroll the transcript.
    expect((await ui.find({ key: 'jump' })) !== undefined).toBe(surface === 'terminal')
    await ui.unmount()
  }
})

test('the map draws cards with lines; a selected card carries its actions', async ($, on) => {
  const { add } = await start($, on)
  const branch = await add({ kind: 'branch', title: 'Сайт' })
  const task = await add({ kind: 'task', title: 'Вёрстка', parentId: branch })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: `card:${branch}` })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /└─/ }))?.text).toContain('└─')
    expect((await ui.find({ type: 'Text', text: /задача · открыто/ }))?.text).toBe('задача · открыто')

    await ui.press({ key: `row:${task}` })
    expect(await ui.find({ key: `done:${task}` })).toBeDefined()
    expect(await ui.find({ key: `reply:${task}` })).toBeDefined()
    await ui.press({ key: 'unselect' })
    await ui.unmount()
  }
})

test('closing a task moves it to history, and it can be put back', async ($, on) => {
  const { add, listed } = await start($, on)
  const branch = await add({ kind: 'branch', title: 'Сайт' })
  const task = await add({ kind: 'task', title: 'Вёрстка', parentId: branch })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `row:${task}` })
  await ui.press({ key: `done:${task}` })
  expect(await ui.find({ key: `card:${task}` })).toBeUndefined()
  expect(await listed()).toContain('Закрыта: Вёрстка')

  await ui.press({ key: 'tab:history' })
  expect((await ui.find({ type: 'Text', text: /^Закрыта: Вёрстка$/ }))?.text).toBe('Закрыта: Вёрстка')
  const restoreKey = (await ui.find({ type: 'Button', text: /Вернуть/ }))?.key
  expect(restoreKey).toBeDefined()
  await ui.press({ key: String(restoreKey) })
  expect(await listed()).toMatch(/«Вёрстка» · открыто/)
  expect(await listed()).not.toContain('Закрыта: Вёрстка')
  await ui.unmount()
})

test('a removal with a reason is remembered; without one it is gone', async ($, on) => {
  const { add, listed } = await start($, on)
  const branch = await add({ kind: 'branch', title: 'Мод' })
  const graph = await add({ kind: 'task', title: 'Граф', parentId: branch })
  const junk = await add({ kind: 'task', title: 'Мусор', parentId: branch })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `row:${graph}` })
  await ui.press({ key: `remove:${graph}` })
  await ui.input({ key: `why:${graph}`, text: 'влезает только 3 уровня' })
  await ui.press({ key: `row:${junk}` })
  await ui.press({ key: `remove:${junk}` })
  await ui.press({ key: `erase:${junk}` })
  await ui.unmount()

  const text = await listed()
  expect(text).toContain('Убрали: Граф')
  expect(text).not.toContain('Мусор')
})

test('trays: take into work, decide, drop', async ($, on) => {
  const { add, call, listed } = await start($, on)
  const branch = await add({ kind: 'branch', title: 'Сайт' })
  const idea = await add({ kind: 'idea', title: 'Тёмная тема' })
  const choice = await add({ kind: 'decision', title: 'Хостинг', options: ['VPS', 'Netlify'] })
  const finding = await add({ kind: 'finding', title: 'Кэш не сбрасывается' })
  expect(await call({ action: 'add', kind: 'task', title: 'Без ветки' })).toMatch(/«Идеи»/)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab:ideas' })
  await ui.select({ key: `take:${idea}`, value: branch })
  expect(await listed()).toMatch(/ветка · «Сайт».*\n {2}\[\w+\] · задача · «Тёмная тема»/)

  await ui.press({ key: 'tab:questions' })
  await ui.press({ key: `opt:${choice}:1` })
  await ui.press({ key: 'tab:findings' })
  await ui.press({ key: `dismiss:${finding}` })
  await ui.unmount()

  const text = await listed()
  expect(text).toContain('Решили: Хостинг → Netlify')
  expect(text).not.toContain('Кэш не сбрасывается')
})

test("Claude's proposal is answered on the card; Claude logs its own steps", async ($, on) => {
  const { add, call, listed } = await start($, on)
  const branch = await add({ kind: 'branch', title: 'Сайт' })
  const task = await add({ kind: 'task', title: 'Вёрстка', parentId: branch })
  await call({ action: 'update', id: task, status: 'done' })
  expect(await call({ action: 'log', title: 'Добавили кнопку «Ответить»', parentId: branch })).toBe('Записано в историю.')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Claude: статус → готово/ }))?.text).toBe('Claude: статус → готово')
  await ui.press({ key: `accept:${task}` })
  await ui.unmount()

  const text = await listed()
  expect(text).toContain('Закрыта: Вёрстка')
  expect(text).toContain('Добавили кнопку «Ответить»')
})

test('"Ответить" starts a reply in the prompt box, and the sent reply carries the node', async ($, on) => {
  // Stand for the prompt box: empty, and taking whatever is filled in.
  const filled: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  const sent: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.context)
    return { text: e.text }
  })
  const { add } = await start($, on)
  const id = await add({ kind: 'question', title: 'Какой хостинг', detail: 'Сравнить цены' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab:questions' })
  await ui.press({ key: `reply:${id}` })
  expect(filled).toEqual([`↪ вопрос «Какой хостинг» [${id}]: `])
  await ui.unmount()

  await $.prompt.submit({ text: `${filled[0]}возьмём Netlify` } as never)
  expect(sent.at(-1)?.join('\n')).toContain('Detail: Сравнить цены')
  await $.prompt.submit({ text: 'просто вопрос' } as never)
  expect(sent.at(-1)).toBeUndefined()
})
