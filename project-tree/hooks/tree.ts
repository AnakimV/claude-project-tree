import type { Color } from 'claude-code'

import type { Anchor, EventKind, HistoryEvent, NodeKind, NodeStatus, Tray, TreeNode } from '../types'
import { STRINGS, t } from './strings'

// Colors are theme keys, so both light and dark themes keep them readable.
// Labels are in strings.ts, in each language.
export const KINDS: Record<NodeKind, { icon: string; color: Color }> = {
  branch: { icon: '▤', color: 'claude' },
  task: { icon: '○', color: 'suggestion' },
  question: { icon: '?', color: 'warning' },
  decision: { icon: '◇', color: 'merged' },
  idea: { icon: '✦', color: 'planMode' },
  finding: { icon: '⚑', color: 'success' },
  note: { icon: '·', color: 'inactive' },
}

export const STATUSES: readonly NodeStatus[] = ['open', 'doing', 'done', 'parked']

export const TRAYS: readonly Tray[] = ['questions', 'ideas', 'findings']

export const EVENTS: Record<EventKind, { icon: string; color: Color }> = {
  done: { icon: '✓', color: 'suggestion' },
  answered: { icon: '✓', color: 'warning' },
  decided: { icon: '◆', color: 'merged' },
  removed: { icon: '✕', color: 'error' },
  step: { icon: '+', color: 'success' },
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

// "? как показывать связи" or "вопрос: как показывать связи"; plain text is a
// task. A kind's word is taken in any language the mod speaks.
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
      k => k === lower || Object.values(STRINGS).some(one => one.kinds[k] === lower),
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

// Two sessions can hold one tree. Before a write, what this session changed
// since `base` (its last read or write) wins; the rest is what is on disk now.
export function mergeById<T extends { id: string }>(base: readonly T[], mine: readonly T[], disk: readonly T[]): T[] {
  const was = new Map(base.map(one => [one.id, JSON.stringify(one)]))
  const ours = new Map(mine.map(one => [one.id, one]))
  const changed = new Set(mine.filter(one => was.get(one.id) !== JSON.stringify(one)).map(one => one.id))
  const dropped = new Set(base.filter(one => !ours.has(one.id)).map(one => one.id))
  const onDisk = new Set(disk.map(one => one.id))
  const kept = disk.filter(one => !dropped.has(one.id)).map(one => (changed.has(one.id) ? (ours.get(one.id) ?? one) : one))

  return [...kept, ...mine.filter(one => changed.has(one.id) && !onDisk.has(one.id))]
}

// A project keeps several trees in .claude: the main one under the original
// file name, each other one under its id.
export function treeFile(id: string): string {
  return id === '' ? 'project-tree.json' : `project-tree-${id}.json`
}

export function treeIdOf(fileName: string): string | null {
  const match = /^project-tree(?:-([a-z0-9]+))?\.json$/.exec(fileName)

  return match ? (match[1] ?? '') : null
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
  const parts = [`[${node.id}]`, t().kinds[node.kind], `«${node.title}»`, t().statuses[node.status]]
  if (node.kind === 'decision') {
    if (node.options?.length) parts.push(`${t().options}: ${node.options.join(' | ')}`)
    if (node.chosen !== undefined) parts.push(`${t().chosen}: ${node.chosen}`)
  }
  if (node.proposal) parts.push(t().awaitsYes)

  return parts.join(' · ')
}

export function eventTitle(event: HistoryEvent): string {
  return `${t().leads[event.kind]}${event.title}`
}

// A node's line with the gist of its detail under it, so a later session reads
// what the node is about, not only its title.
function entry(node: TreeNode, indent: string): string[] {
  return [`${indent}${line(node)}`, ...(node.detail ? [`${indent}    ${excerptOf(node.detail, DETAIL_GIST)}`] : [])]
}

// One node in full, for Claude's `list` with an id.
export function nodeCard(list: TreeNode[], node: TreeNode): string {
  const path = pathOf(list, node.id)
  const kids = list.filter(one => one.parentId === node.id)

  return [
    line(node),
    path.length ? t().inBranch(path.join(' › ')) : '',
    node.detail ?? '',
    node.anchor ? t().fromMessage(new Date(node.anchor.at).toLocaleString(t().locale), node.anchor.excerpt) : '',
    ...kids.map(one => `  ${line(one)}`),
  ]
    .filter(Boolean)
    .join('\n')
}

// The whole tree as indented text, for Claude's `list`.
export function outline(list: TreeNode[], events: HistoryEvent[]): string {
  const map = flatten(list, []).flatMap(row => entry(row.node, '  '.repeat(row.depth)))
  const trays = TRAYS.flatMap(tray => {
    const items = trayList(list, tray)
    return items.length ? ['', t().trayHead(t().trays[tray].label), ...items.flatMap(node => entry(node, '  '))] : []
  })
  const recent = [...events].sort((a, b) => b.at - a.at).slice(0, 10)

  return [
    t().mapHead,
    ...(map.length ? map : [t().emptyMap]),
    ...trays,
    ...(recent.length
      ? ['', t().historyHead, ...recent.map(event => `  ${new Date(event.at).toLocaleDateString(t().locale)} ${eventTitle(event)}`)]
      : []),
  ].join('\n')
}

// A short digest for the system prompt, fixed for the session: enough to know
// where the project stands before the first `list`.
export function digest(list: TreeNode[], events: HistoryEvent[] = []): string {
  const ready = readyList(list)
  if (list.length === 0 && events.length === 0) return t().emptyTree
  const top = ready.slice(0, 8).map(node => {
    const path = pathOf(list, node.id)
    return `- ${line(node)}${path.length ? ` (${t().inBranch(path.join(' › '))})` : ''}`
  })
  const waiting = TRAYS.map(tray => `${t().trays[tray].label.toLowerCase()}: ${trayList(list, tray).length}`).join(', ')
  const named = TRAYS.flatMap(tray => {
    const items = trayList(list, tray)
    const titles = items.slice(0, DIGEST_TITLES).map(node => `«${node.title}» [${node.id}]`)
    const more = items.length > DIGEST_TITLES ? ` ${t().andMore(items.length - DIGEST_TITLES)}` : ''
    return items.length ? [`- ${t().trays[tray].label}: ${titles.join(', ')}${more}`] : []
  })
  const recent = [...events].sort((a, b) => b.at - a.at).slice(0, 3)

  return [
    t().digestHead(list.length, ready.length, waiting),
    ...(top.length ? [t().openNow, ...top] : []),
    ...(named.length ? [t().waitingNow, ...named] : []),
    ...(recent.length
      ? [t().historyHead, ...recent.map(event => `- ${new Date(event.at).toLocaleDateString(t().locale)} ${eventTitle(event)}`)]
      : []),
  ].join('\n')
}

// What a person coming back to the project reads first: the latest steps, the
// work in progress, what waits on them and what has lain untouched.
export function briefing(name: string, list: TreeNode[], events: HistoryEvent[], now: number): string {
  if (list.length === 0 && events.length === 0) return t().emptyTree
  const recent = [...events].sort((a, b) => b.at - a.at).slice(0, 5)
  const ready = readyList(list)
  const doing = ready.filter(node => node.status === 'doing')
  const open = ready.filter(node => node.status !== 'doing' && node.kind === 'task')
  const parked = list.filter(node => node.status === 'parked')
  const stale = list.filter(node => node.kind !== 'branch' && isStale(node, now)).sort((a, b) => a.updatedAt - b.updatedAt)
  const titled = (node: TreeNode) => {
    const path = pathOf(list, node.id)
    return `  ${iconOf(node)} ${node.title}${path.length ? ` (${path.join(' › ')})` : ''}`
  }
  const block = (head: string, lines: string[], max = 5) =>
    lines.length ? ['', head, ...lines.slice(0, max), ...(lines.length > max ? [`  ${t().andMore(lines.length - max)}`] : [])] : []

  return [
    t().briefHead(name),
    ...block(t().briefRecent, recent.map(event => `  ${dayOf(event.at, now)} · ${eventTitle(event)}`)),
    ...block(t().briefDoing, doing.map(titled)),
    ...block(t().briefOpen(open.length), open.map(titled)),
    ...TRAYS.flatMap(tray => {
      const items = trayList(list, tray)
      return block(t().briefTray(t().trays[tray].label, items.length), items.map(titled), 4)
    }),
    ...block(t().briefParked, parked.map(titled), 3),
    ...block(t().briefStale, stale.map(node => `${titled(node)} · ${ageOf(node.updatedAt, now)}`), 4),
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
// A question, idea or finding may wait longer before it is called out.
export const STALE_TRAY_DAYS = 14
// How much of a node's detail the outline carries, and how many titles of a
// tray the digest names.
const DETAIL_GIST = 200
const DIGEST_TITLES = 5

// How long ago, in the largest unit that fits: "12 мин", "3 ч", "2 дня", "3 нед".
export function ageOf(at: number, now: number): string {
  const span = Math.max(0, now - at)
  const age = t().age
  if (span < MINUTE) return age.underMinute
  if (span < HOUR) return age.minutes(Math.floor(span / MINUTE))
  if (span < DAY) return age.hours(Math.floor(span / HOUR))
  const days = Math.floor(span / DAY)
  if (days < 14) return age.days(days)

  return age.weeks(Math.floor(days / 7))
}

// The heading a history day goes under: today, yesterday, else its date.
export function dayOf(at: number, now: number): string {
  const day = (ms: number) => new Date(ms).toDateString()
  if (day(at) === day(now)) return t().today
  if (day(at) === day(now - DAY)) return t().yesterday

  return new Date(at).toLocaleDateString(t().locale, { day: 'numeric', month: 'long' })
}

export function isStale(node: TreeNode, now: number): boolean {
  const days = trayOf(node) === null ? STALE_DAYS : STALE_TRAY_DAYS

  return node.status === 'open' && now - node.updatedAt > days * DAY
}

// The node's direct subtasks: how many there are and how many are done.
export function progressOf(list: TreeNode[], id: string): { done: number; total: number } {
  const kids = list.filter(node => node.parentId === id && isOnMap(node) && node.kind === 'task')

  return { done: kids.filter(node => node.status === 'done').length, total: kids.length }
}

// What "Ответить" puts in the prompt box ahead of the person's answer; the id
// in brackets is how the sent prompt is tied back to the node.
export function replyLead(node: TreeNode): string {
  return `↪ ${t().kinds[node.kind]} «${node.title}» [${node.id}]: `
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
    `The person is answering this node of their project tree: [${node.id}] ${t().kinds[node.kind]} «${node.title}», ${t().statuses[node.status]}.`,
    path.length ? `In branch: ${path.join(' › ')}.` : '',
    node.detail ? `Detail: ${node.detail}` : '',
    node.options?.length ? `Options: ${node.options.join(' | ')}${node.chosen ? `; chosen: ${node.chosen}` : ''}.` : '',
    node.anchor ? `It came from the person's message: «${node.anchor.excerpt}».` : '',
    'Act on the answer. Then record it with the tree tool: update this node\'s detail with the gist; where the answer settles it, propose the status, or the chosen option for a decision.',
  ]

  return lines.filter(Boolean).join('\n')
}
