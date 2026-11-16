import { expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { langOf, plural, setLang } from '../hooks/strings'
import { ageOf, briefing, digest, flatten, mergeById, migrate, parseEntry, trayList } from '../hooks/tree'
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

// Nothing sits beneath the plugin: each hook here stands for the engine. The
// project's files are `files`, by path; the plugin's store remembers Russian
// unless a test says otherwise.
async function start(
  $: Engine,
  on: Parameters<TestBody>[1],
  files = new Map<string, string>(),
  store = new Map<string, unknown>([['lang', 'ru']]),
) {
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.root', () => ({ value: '/proj' }))
  on('command.register', () => ({ value: { command: 'tree' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__project-tree__tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_, e) => (files.has(e.path) ? { value: files.get(e.path) ?? '' } : { deny: 'no file' }))
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({
    value: [...files.keys()].map(path => ({ name: path.split(/[\\/]/).pop() ?? '', kind: 'file', size: 1, mtimeMs: 1, isLink: false })),
  }))
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
  // The pane moves to where it went back to: the map, with the task on it.
  expect(await ui.find({ type: 'Text', text: /Вёрстка/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Закрыта/ })).toBeUndefined()
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

test('a merge keeps what each session changed', async () => {
  const one = (id: string, title: string) => ({ id, title })
  const base = [one('a', 'a'), one('b', 'b'), one('c', 'c')]
  const mine = [one('a', 'a2'), one('c', 'c'), one('m', 'mine')]
  const disk = [one('a', 'a'), one('b', 'b'), one('c', 'c3'), one('o', 'other')]

  // Mine: a changed, b removed, m added. Theirs: c changed, o added.
  expect(mergeById(base, mine, disk)).toEqual([one('a', 'a2'), one('c', 'c3'), one('o', 'other'), one('m', 'mine')])
})

test('two sessions on one tree keep each other work; a new tree leaves the old one', async ($, on) => {
  const files = new Map<string, string>()
  const { call, add, listed } = await start($, on, files)
  await add({ kind: 'branch', title: 'Моё' })
  // The engine hands the plugin's paths over in the platform's own spelling.
  const MAIN = [...files.keys()].find(path => /project-tree\.json$/.test(path)) ?? ''
  // Another session writes its own branch into the same file.
  const disk = JSON.parse(files.get(MAIN) ?? '{}') as { nodes: TreeNode[] }
  disk.nodes.push({ ...BASE, id: 'other1', kind: 'branch', title: 'Чужое' })
  files.set(MAIN, JSON.stringify(disk))
  await add({ kind: 'branch', title: 'Ещё моё' })

  const saved = (JSON.parse(files.get(MAIN) ?? '{}') as { nodes: TreeNode[] }).nodes.map(node => node.title)
  expect(saved).toEqual(['Моё', 'Чужое', 'Ещё моё'])

  expect(await call({ action: 'new', title: 'С нуля' })).toContain('«Основное» сохранено')
  expect(await listed()).toContain('Открыто дерево «С нуля»')
  expect(await listed()).not.toContain('Моё')
  expect(files.get(MAIN)).toContain('Чужое')

  expect(await call({ action: 'switch', id: 'main' })).toContain('«Основное»')
  expect(await listed()).toContain('«Ещё моё»')
  expect(await listed()).toContain('«С нуля»')
})

test('the language is told from what the person writes', async () => {
  expect(langOf('давай сделаем панель')).toBe('ru')
  expect(langOf('fix the README in the mod please')).toBe('en')
  // English words inside Russian text keep it Russian; a lone "ok" says nothing.
  expect(langOf('поправь README и hooks.json')).toBe('ru')
  expect(langOf('ok')).toBe(null)
  expect(langOf('/tree')).toBe(null)
})

test('ages, an entry and the digest read as English', async () => {
  setLang('en')
  try {
    expect(ageOf(0, 3 * 86_400_000)).toBe('3 days')
    expect(ageOf(0, 86_400_000)).toBe('1 day')
    expect(parseEntry('idea: dark theme')).toEqual({ kind: 'idea', title: 'dark theme' })
    // A kind's word in another language the mod speaks still counts.
    expect(parseEntry('идея: тёмная тема')).toEqual({ kind: 'idea', title: 'тёмная тема' })
    expect(digest([{ ...BASE, id: 'a', kind: 'task', title: 'a', isInbox: true }])).toContain('ideas: 1')
  } finally {
    setLang('ru')
  }
})

test('an English prompt turns the pane and the tool to English, and is remembered', async ($, on) => {
  const store = new Map<string, unknown>([['lang', 'ru']])
  on('prompt.submit', (_, e) => ({ text: e.text }))
  const { add, listed } = await start($, on, new Map(), store)
  const branch = await add({ kind: 'branch', title: 'Site' })
  await add({ kind: 'task', title: 'Layout', parentId: branch })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /задача · открыто/ }))?.text).toBe('задача · открыто')

  await $.prompt.submit({ text: 'please add a task for the docs' } as never)
  expect((await ui.find({ type: 'Text', text: /task · open/ }))?.text).toBe('task · open')
  expect(await ui.find({ key: 'tab:history', type: 'Button', text: /History/ })).toBeDefined()
  expect(await listed()).toContain('Opened tree "Main".')
  expect(store.get('lang')).toBe('en')

  // A slash command or a short word leaves it as it is.
  await $.prompt.submit({ text: '/tree' } as never)
  await $.prompt.submit({ text: 'ok' } as never)
  expect(await listed()).toContain('Opened tree "Main".')

  await $.prompt.submit({ text: 'теперь по-русски' } as never)
  expect(await listed()).toContain('Открыто дерево «Основное».')
  await ui.unmount()
})

test('a later session reads what a node is about: gist in the list, the node in full, titles in the digest', async ($, on) => {
  const { call, add, listed } = await start($, on)
  const long = `Суть идеи. ${'подробности '.repeat(30)}конец`
  const idea = await add({ kind: 'idea', title: 'Локализация', detail: long })

  expect(await listed()).toContain('Суть идеи.')
  expect(await listed()).not.toContain('конец')
  expect(await call({ action: 'list', id: idea })).toContain('конец')
  expect(await call({ action: 'list', id: 'nosuch' })).toContain('Узла [nosuch] нет')

  const nodes: TreeNode[] = [{ ...BASE, id: 'idea01', kind: 'idea', title: 'Локализация' }]
  const text = digest(nodes, [{ id: 'e1', at: 0, kind: 'step', title: 'Выложили мод' }])
  expect(text).toContain('Идеи: «Локализация» [idea01]')
  expect(text).toContain('Выложили мод')
})

test('the briefing tells where the project stands', async ($, on) => {
  const day = 86_400_000
  const now = 30 * day
  const nodes: TreeNode[] = [
    { ...BASE, id: 'a', kind: 'branch', title: 'Сайт' },
    { ...BASE, id: 'b', kind: 'task', title: 'Вёрстка', parentId: 'a', status: 'doing', updatedAt: now },
    { ...BASE, id: 'c', kind: 'task', title: 'Тексты', parentId: 'a', updatedAt: now - 9 * day },
    { ...BASE, id: 'd', kind: 'question', title: 'Какой хостинг', updatedAt: now - 3 * day },
    { ...BASE, id: 'e', kind: 'idea', title: 'Тёмная тема', updatedAt: now - 20 * day },
  ]
  const text = briefing('Основное', nodes, [{ id: 'e1', at: now - day, kind: 'done', title: 'Макет' }], now)

  expect(text).toContain('Дерево «Основное»: где остановились')
  expect(text).toContain('Вчера · Закрыта: Макет')
  expect(text).toMatch(/В работе:\n.*Вёрстка \(Сайт\)/)
  expect(text).toMatch(/Открытые задачи \(1\):\n.*Тексты/)
  expect(text).toMatch(/Вопросы \(1\):\n.*Какой хостинг/)
  // A task is called out after 5 days, what waits on a tab after 14.
  const stale = text.slice(text.indexOf('Давно не трогали:'))
  expect(stale).toContain('Тексты')
  expect(stale).toContain('Тёмная тема')
  expect(stale).not.toContain('Какой хостинг')

  await start($, on)
  const said = await $.command.run({ command: 'tree', args: 'brief' } as never)
  expect(String((said as { text?: string }).text)).toContain('Дерево проекта пока пусто')
})

test('Claude clears a tab or removes a node when asked; history can put it all back', async ($, on) => {
  const { call, add, listed } = await start($, on)
  const branch = await add({ kind: 'branch', title: 'Сайт' })
  const task = await add({ kind: 'task', title: 'Вёрстка', parentId: branch })
  await add({ kind: 'idea', title: 'Первая' })
  await add({ kind: 'idea', title: 'Вторая' })
  await add({ kind: 'question', title: 'Вопрос остаётся' })

  expect(await call({ action: 'remove' })).toContain('Нужен id узла или tray')
  expect(await call({ action: 'remove', tray: 'ideas', detail: 'Разобрали.' })).toContain('убрано: 2')
  expect(await call({ action: 'remove', tray: 'ideas' })).toContain('и так пуста')
  expect(await listed()).not.toContain('«Первая»')
  expect(await listed()).toContain('«Вопрос остаётся»')
  expect(await listed()).toContain('Убрали: Очистили вкладку «Идеи» (2)')

  expect(await call({ action: 'remove', id: task })).toContain('Убрано «Вёрстка»')
  expect(await listed()).toContain('Убрали: Вёрстка')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab:history' })
  const cleared = await ui.find({ type: 'Text', text: /Очистили вкладку/ })
  expect(cleared).toBeDefined()
  for (const button of await ui.findAll({ type: 'Button', text: /Вернуть/ })) {
    await ui.press({ key: String(button.key) })
    await ui.press({ key: 'tab:history' })
  }
  expect(await listed()).toContain('«Первая»')
  expect(await listed()).toContain('«Вторая»')
  expect(await listed()).toContain('«Вёрстка»')
  await ui.unmount()
})

test('the end of a turn takes in what another session wrote', async ($, on) => {
  const files = new Map<string, string>()
  on('turn.complete', () => ({ text: '' }))
  const { add, listed } = await start($, on, files)
  await add({ kind: 'branch', title: 'Моё' })
  const MAIN = [...files.keys()].find(path => /project-tree\.json$/.test(path)) ?? ''
  const disk = JSON.parse(files.get(MAIN) ?? '{}') as { nodes: TreeNode[] }
  disk.nodes.push({ ...BASE, id: 'other1', kind: 'branch', title: 'Чужое' })
  files.set(MAIN, JSON.stringify(disk))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Чужое/ })).toBeUndefined()
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 1, isAborted: false } as never)
  expect(await ui.find({ type: 'Text', text: /Чужое/ })).toBeDefined()
  await ui.unmount()
  expect(await listed()).toContain('«Чужое»')
})
