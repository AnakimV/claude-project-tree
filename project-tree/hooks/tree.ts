import type { Color } from 'claude-code'

import type { Anchor, EventKind, HistoryEvent, NodeKind, NodeStatus, Tray, TreeNode } from '../types'

// Colors are theme keys, so both light and dark themes keep them readable.
export const KINDS: Record<NodeKind, { label: string; icon: string; color: Color }> = {
  branch: { label: 'ветка', icon: '▤', color: 'claude' },
  task: { label: 'задача', icon: '○', color: 'suggestion' },
  question: { label: 'вопрос', icon: '?', color: 'warning' },
  decision: { label: 'решение', icon: '◇', color: 'merged' },
  idea: { label: 'идея', icon: '✦', color: 'planMode' },
  finding: { label: 'находка', icon: '⚑', color: 'success' },
  note: { label: 'заметка', icon: '·', color: 'inactive' },
}

export const STATUSES: Record<NodeStatus, string> = {
  open: 'открыто',
  doing: 'в работе',
  done: 'готово',
  parked: 'отложено',
}

export const TRAYS: Record<Tray, { label: string; empty: string }> = {
  questions: { label: 'Вопросы', empty: 'Открытых вопросов и решений нет.' },
  ideas: { label: 'Идеи', empty: 'Идей пока нет. Сюда же попадают задачи от Claude без ветки.' },
  findings: { label: 'Находки', empty: 'Находок и заметок пока нет.' },
}

export const EVENTS: Record<EventKind, { icon: string; color: Color; lead: string }> = {
  done: { icon: '✓', color: 'suggestion', lead: 'Закрыта: ' },
  answered: { icon: '✓', color: 'warning', lead: 'Ответили: ' },
  decided: { icon: '◆', color: 'merged', lead: 'Решили: ' },
  removed: { icon: '✕', color: 'error', lead: 'Убрали: ' },
  step: { icon: '+', color: 'success', lead: '' },
}

const PREFIXES: Record<string, NodeKind> = {
  '#': 'branch',
  '-': 'task',
  '?': 'question',
  '!': 'decision',
  '*': 'idea',
  '>': 'finding',
  '~': 'note',
}

export const ENTRY_HINT = '# ветка  - задача  ? вопрос  ! решение  * идея  > находка  ~ заметка'

// "? как показывать связи" or "вопрос: как показывать связи"; plain text is a task.
export function parseEntry(text: string): { kind: NodeKind; title: string } | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const prefixed = PREFIXES[trimmed.charAt(0)]
  if (prefixed) {
    const title = trimmed.slice(1).trim()
    return title === '' ? null : { kind: prefixed, title }
  }
  const [, word, rest] = /^([\p{L}]+)\s*:\s*(.+)$/u.exec(trimmed) ?? []
  if (word !== undefined && rest !== undefined) {
    const lower = word.toLowerCase()
    const kind = (Object.keys(KINDS) as NodeKind[]).find(
      k => KINDS[k].label === lower || k === lower,
    )
    if (kind) return { kind, title: rest.trim() }
  }

  return { kind: 'task', title: trimmed }
}

export function iconOf(node: TreeNode): string {
  if (node.kind === 'task' && node.status === 'done') return '✓'
  if (node.kind === 'task' && node.status === 'doing') return '●'
  if (node.kind === 'decision' && node.chosen !== undefined) return '◆'

  return KINDS[node.kind].icon
}

// The map holds branches and the tasks filed under them; all else waits on a tray.
export function isOnMap(node: TreeNode): boolean {
  return (node.kind === 'branch' || node.kind === 'task') && !node.isInbox
}

export function trayOf(node: TreeNode): Tray | null {
  if (isOnMap(node)) return null
  if (node.kind === 'question' || node.kind === 'decision') return 'questions'
  if (node.kind === 'finding' || node.kind === 'note') return 'findings'

  return 'ideas'
}

export function newId(): string {
  return Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6)
}

export function makeNode(
  fields: Pick<TreeNode, 'kind' | 'title' | 'source'> &
    Partial<Pick<TreeNode, 'parentId' | 'detail' | 'options' | 'isInbox'>>,
  anchor: Anchor | null,
  now: number,
): TreeNode {
  return {
    id: newId(),
    parentId: fields.parentId ?? null,
    kind: fields.kind,
    title: fields.title,
    status: 'open',
    detail: fields.detail,
    options: fields.options,
    anchor: anchor ?? undefined,
    source: fields.source,
    isInbox: fields.isInbox ?? false,
    createdAt: now,
    updatedAt: now,
  }
}

export function patch(
  list: TreeNode[],
  id: string,
  change: (node: TreeNode) => TreeNode,
  now: number,
): TreeNode[] {
  return list.map(node => (node.id === id ? { ...change(node), updatedAt: now } : node))
}

// Splits the node and everything under it from the rest of the list.
export function takeOut(list: TreeNode[], id: string): { rest: TreeNode[]; taken: TreeNode[] } {
  const gone = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const node of list) {
      if (node.parentId !== null && gone.has(node.parentId) && !gone.has(node.id)) {
        gone.add(node.id)
        grew = true
      }
    }
  }

  return { rest: list.filter(node => !gone.has(node.id)), taken: list.filter(node => gone.has(node.id)) }
}

export function childrenOf(list: TreeNode[]): Map<string | null, TreeNode[]> {
  const onMap = list.filter(isOnMap)
  const ids = new Set(onMap.map(node => node.id))
  const byParent = new Map<string | null, TreeNode[]>()
  for (const node of onMap) {
    // A node whose parent is gone shows at the top rather than vanishing.
    const parent = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null
    byParent.set(parent, [...(byParent.get(parent) ?? []), node])
  }
  for (const kids of byParent.values()) kids.sort((a, b) => a.createdAt - b.createdAt)

  return byParent
}

// `rails[k]` says whether the line of the ancestor at depth k+1 runs on past
// this row, and `isLast` whether this row ends its parent's line: what the
// map draws its connectors from.
export type Row = { node: TreeNode; depth: number; childCount: number; isLast: boolean; rails: boolean[] }

// The map's rows, branches and tasks only, depth first.
export function flatten(list: TreeNode[], collapsed: readonly string[]): Row[] {
  const byParent = childrenOf(list)
  const closed = new Set(collapsed)
  const rows: Row[] = []
  const walk = (parent: string | null, depth: number, rails: boolean[]) => {
    const kids = byParent.get(parent) ?? []
    kids.forEach((node, at) => {
      const childCount = byParent.get(node.id)?.length ?? 0
      const isLast = at === kids.length - 1
      rows.push({ node, depth, childCount, isLast, rails })
      // Top-level nodes draw no connector, so they add no rail.
      if (!closed.has(node.id)) walk(node.id, depth + 1, depth === 0 ? rails : [...rails, !isLast])
    })
  }
  walk(null, 0, [])

  return rows
}

// What waits on one tray, oldest first.
export function trayList(list: TreeNode[], tray: Tray): TreeNode[] {
  return list.filter(node => trayOf(node) === tray).sort((a, b) => a.createdAt - b.createdAt)
}

function isOpenWork(node: TreeNode): boolean {
  if (node.status === 'done' || node.status === 'parked') return false
  if (node.kind === 'task') return isOnMap(node)

  return node.kind === 'question' || (node.kind === 'decision' && node.chosen === undefined)
}

// What can be picked up next: work in progress first, then the oldest.
export function readyList(list: TreeNode[]): TreeNode[] {
  return list
    .filter(isOpenWork)
    .sort(
      (a, b) =>
        Number(b.status === 'doing') - Number(a.status === 'doing') ||
        a.createdAt - b.createdAt,
    )
}

export function pathOf(list: TreeNode[], id: string): string[] {
  const byId = new Map(list.map(node => [node.id, node]))
  const names: string[] = []
  let at = byId.get(id)?.parentId ?? null
  while (at !== null && names.length < 20) {
    const node = byId.get(at)
    if (!node) break
    names.unshift(node.title)
    at = node.parentId
  }

  return names
}

// The step a node leaves the tree by: closing a task, answering a question,
// choosing an option, or removing it with a reason.
export function stepOf(
  list: TreeNode[],
  node: TreeNode,
  kind: EventKind,
  taken: TreeNode[],
  at: number,
  extra: { option?: string; reason?: string; anchor?: Anchor | null } = {},
): HistoryEvent {
  const path = pathOf(list, node.id)

  return {
    id: newId(),
    at,
    kind,
    title: extra.option !== undefined ? `${node.title} → ${extra.option}` : node.title,
    detail: extra.reason ?? node.detail,
    branch: path.length ? path.join(' › ') : undefined,
    anchor: extra.anchor ?? node.anchor,
    restore: taken.map(one => (one.id === node.id ? { ...one, status: 'open', proposal: undefined } : one)),
  }
}

// Which step closing a node of this kind is.
export function closingOf(node: TreeNode): EventKind {
  if (node.kind === 'question') return 'answered'
  if (node.kind === 'decision' && node.chosen !== undefined) return 'decided'

  return 'done'
}

// A file written before history existed kept closed nodes in the tree: they become history.
export function migrate(list: TreeNode[]): { nodes: TreeNode[]; events: HistoryEvent[] } {
  let rest = list.map(node => (isOnMap(node) || node.kind === 'task' ? node : { ...node, isInbox: false }))
  const events: HistoryEvent[] = []
  for (const node of list.filter(one => one.status === 'done' && one.kind !== 'branch')) {
    if (!rest.some(one => one.id === node.id)) continue
    const out = takeOut(rest, node.id)
    events.push(stepOf(rest, node, closingOf(node), out.taken, node.updatedAt, { option: node.chosen }))
    rest = out.rest
  }

  return { nodes: rest, events }
}

function line(node: TreeNode): string {
  const parts = [`[${node.id}]`, KINDS[node.kind].label, `«${node.title}»`, STATUSES[node.status]]
  if (node.kind === 'decision') {
    if (node.options?.length) parts.push(`варианты: ${node.options.join(' | ')}`)
    if (node.chosen !== undefined) parts.push(`выбрано: ${node.chosen}`)
  }
  if (node.proposal) parts.push('(ждёт подтверждения)')

  return parts.join(' · ')
}

export function eventTitle(event: HistoryEvent): string {
  return `${EVENTS[event.kind].lead}${event.title}`
}

// The whole tree as indented text, for Claude's `list`.
export function outline(list: TreeNode[], events: HistoryEvent[]): string {
  const map = flatten(list, []).map(row => `${'  '.repeat(row.depth)}${line(row.node)}`)
  const trays = (Object.keys(TRAYS) as Tray[]).flatMap(tray => {
    const items = trayList(list, tray)
    return items.length ? ['', `${TRAYS[tray].label} (ждут решения человека):`, ...items.map(node => `  ${line(node)}`)] : []
  })
  const recent = [...events].sort((a, b) => b.at - a.at).slice(0, 10)

  return [
    'Схема:',
    ...(map.length ? map : ['  (пусто)']),
    ...trays,
    ...(recent.length
      ? ['', 'История, последнее:', ...recent.map(event => `  ${new Date(event.at).toLocaleDateString('ru-RU')} ${eventTitle(event)}`)]
      : []),
  ].join('\n')
}

// A short digest for the system prompt, fixed for the session.
export function digest(list: TreeNode[]): string {
  const ready = readyList(list)
  if (list.length === 0) return 'Дерево проекта пока пусто.'
  const top = ready.slice(0, 8).map(node => {
    const path = pathOf(list, node.id)
    return `- ${line(node)}${path.length ? ` (в ветке: ${path.join(' › ')})` : ''}`
  })
  const waiting = (Object.keys(TRAYS) as Tray[])
    .map(tray => `${TRAYS[tray].label.toLowerCase()}: ${trayList(list, tray).length}`)
    .join(', ')

  return [
    `В дереве ${list.length} узлов, открытой работы: ${ready.length}; ждут решения — ${waiting}.`,
    ...(top.length ? ['Открыто сейчас:', ...top] : []),
  ].join('\n')
}

export function textOf(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

export function excerptOf(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function fit(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
// Open work untouched this long is called out: it is the work that gets forgotten.
export const STALE_DAYS = 5

// The Russian noun form for n: one, few (2-4) or many.
export function plural(n: number, forms: readonly [string, string, string]): string {
  const tens = n % 100
  const ones = n % 10
  if (tens >= 11 && tens <= 14) return forms[2]
  if (ones === 1) return forms[0]
  if (ones >= 2 && ones <= 4) return forms[1]

  return forms[2]
}

// How long ago, in the largest unit that fits: "12 мин", "3 ч", "2 дня", "3 нед".
export function ageOf(at: number, now: number): string {
  const span = Math.max(0, now - at)
  if (span < MINUTE) return 'меньше минуты'
  if (span < HOUR) return `${Math.floor(span / MINUTE)} мин`
  if (span < DAY) return `${Math.floor(span / HOUR)} ч`
  const days = Math.floor(span / DAY)
  if (days < 14) return `${days} ${plural(days, ['день', 'дня', 'дней'])}`

  return `${Math.floor(days / 7)} нед`
}

// The heading a history day goes under: today, yesterday, else its date.
export function dayOf(at: number, now: number): string {
  const day = (ms: number) => new Date(ms).toDateString()
  if (day(at) === day(now)) return 'Сегодня'
  if (day(at) === day(now - DAY)) return 'Вчера'

  return new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function isStale(node: TreeNode, now: number): boolean {
  return node.status === 'open' && now - node.updatedAt > STALE_DAYS * DAY
}

// The node's direct subtasks: how many there are and how many are done.
export function progressOf(list: TreeNode[], id: string): { done: number; total: number } {
  const kids = list.filter(node => node.parentId === id && isOnMap(node) && node.kind === 'task')

  return { done: kids.filter(node => node.status === 'done').length, total: kids.length }
}

// What "Ответить" puts in the prompt box ahead of the person's answer; the id
// in brackets is how the sent prompt is tied back to the node.
export function replyLead(node: TreeNode): string {
  return `↪ ${KINDS[node.kind].label} «${node.title}» [${node.id}]: `
}

// The ids of nodes a prompt names in brackets, as replyLead writes them.
export function mentionedIds(text: string, list: TreeNode[]): string[] {
  const ids = new Set(list.map(node => node.id))
  const found = [...text.matchAll(/\[([a-z0-9]{6,12})\]/g)].map(match => match[1] ?? '')

  return [...new Set(found)].filter(id => ids.has(id))
}

// The node in full, for the model alongside a prompt that answers it.
export function briefOf(list: TreeNode[], node: TreeNode): string {
  const path = pathOf(list, node.id)
  const lines = [
    `The person is answering this node of their project tree: [${node.id}] ${KINDS[node.kind].label} «${node.title}», ${STATUSES[node.status]}.`,
    path.length ? `In branch: ${path.join(' › ')}.` : '',
    node.detail ? `Detail: ${node.detail}` : '',
    node.options?.length ? `Options: ${node.options.join(' | ')}${node.chosen ? `; chosen: ${node.chosen}` : ''}.` : '',
    node.anchor ? `It came from the person's message: «${node.anchor.excerpt}».` : '',
    'Act on the answer. Then record it with the tree tool: update this node\'s detail with the gist; where the answer settles it, propose the status, or the chosen option for a decision.',
  ]

  return lines.filter(Boolean).join('\n')
}
