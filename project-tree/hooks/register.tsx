import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Anchor, EventKind, HistoryEvent, NodeKind, NodeStatus, Tab, Tray, TreeNode } from '../types'
import { isLang, langOf, setLang, shownName, systemLang, t } from './strings'
import type { Lang } from './strings'
import {
  EVENTS,
  KINDS,
  STATUSES,
  TRAYS,
  ageOf,
  briefOf,
  briefing,
  closingOf,
  dayOf,
  digest,
  eventTitle,
  excerptOf,
  fit,
  flatten,
  iconOf,
  isOnMap,
  isStale,
  makeNode,
  mentionedIds,
  mergeById,
  migrate,
  newId,
  nodeCard,
  outline,
  parseEntry,
  patch,
  pathOf,
  progressOf,
  replyLead,
  stepOf,
  takeOut,
  textOf,
  trayList,
  trayOf,
  treeFile,
  treeIdOf,
} from './tree'
import type { Row } from './tree'

const PANE = 'project-tree'
const TOOL = 'mcp__project-tree__tree'
const DIR = '.claude'
// The file's layout: 2 added history; an older file is migrated on load.
const VERSION = 2

// Change the tag when a stored shape's fields change: it declines what an
// earlier version stored, which outlives a reload.
const nodes = atom({ plugin: 'project-tree', key: 'nodes' } as const, [], { shape: 'nodes-1' })
const events = atom({ plugin: 'project-tree', key: 'events' } as const, [], { shape: 'events-1' })
const collapsed = atom({ plugin: 'project-tree', key: 'collapsed' } as const, [])
const tab = atom({ plugin: 'project-tree', key: 'tab' } as const, 'map')
const selected = atom({ plugin: 'project-tree', key: 'selected' } as const, '')
const lastPrompt = atom({ plugin: 'project-tree', key: 'lastPrompt' } as const, null)
const inputSeq = atom({ plugin: 'project-tree', key: 'inputSeq' } as const, 0)
const removing = atom({ plugin: 'project-tree', key: 'removing' } as const, '')
const tree = atom({ plugin: 'project-tree', key: 'tree' } as const, null)
const language = atom({ plugin: 'project-tree', key: 'lang' } as const, 'ru')
// The person's language, kept across sessions and projects in the plugin's store.
const LANG_KEY = 'lang'

type $ = EngineInterface
type Loaded = {
  name: string
  nodes: TreeNode[]
  events: HistoryEvent[]
  isOld: boolean
  isMissing: boolean
  isBroken: boolean
}

// Set at session start and on switching trees; a reload runs session.start again.
let root = '.'
let treeId = ''
// As stored; the main tree's default name is shown in the pane's language.
let treeName = ''
let trees: { id: string; name: string }[] = []
// What this session last read or wrote: the base its own changes are told from.
let base: { nodes: TreeNode[]; events: HistoryEvent[] } = { nodes: [], events: [] }
let guide = ''

const pathOfTree = (id: string) => `${root}/${DIR}/${treeFile(id)}`
const pointerKey = () => `current:${root}`
const openName = () => shownName(treeId, treeName)
const today = () => new Date().toLocaleDateString(t().locale, { day: 'numeric', month: 'long' })

const guideOf = (list: TreeNode[], log: HistoryEvent[]) =>
  `${t().guide(t().title, TOOL, openName(), trees.length)}\n${digest(list, log)}`

// Switches the mod to the language the person writes in.
async function speak($: $, lang: Lang): Promise<void> {
  setLang(lang)
  if ((await read($, language)) === lang) return
  await update($, language, () => lang)
  await $.store.set(LANG_KEY, lang).catch(() => undefined)
  trees = await listTrees($)
  guide = guideOf(await read($, nodes), await read($, events))
}

async function load($: $, id = treeId): Promise<Loaded> {
  const empty = { name: '', nodes: [], events: [], isOld: false, isMissing: false }
  if (!(await $.fs.exists(pathOfTree(id)).catch(() => false))) return { ...empty, isMissing: true, isBroken: false }
  try {
    const parsed = JSON.parse(String(await $.fs.read(pathOfTree(id)))) as {
      version?: number
      name?: string
      nodes?: TreeNode[]
      events?: HistoryEvent[]
    }
    const name = parsed.name ?? empty.name
    const list = Array.isArray(parsed.nodes) ? parsed.nodes : []
    if (parsed.version === VERSION) {
      const log = Array.isArray(parsed.events) ? parsed.events : []
      return { name, nodes: list, events: log, isOld: false, isMissing: false, isBroken: false }
    }

    return { name, ...migrate(list), isOld: true, isMissing: false, isBroken: false }
  } catch {
    // Half written by another session, or edited by hand: not a tree to merge with.
    return { ...empty, isBroken: true }
  }
}

async function write($: $, id: string, name: string, list: TreeNode[], log: HistoryEvent[]): Promise<void> {
  await $.fs.write(pathOfTree(id), `${JSON.stringify({ version: VERSION, name, nodes: list, events: log }, null, 2)}\n`)
}

// Writes the tree with what another session wrote since this one last looked.
async function save($: $, list: TreeNode[], log: HistoryEvent[]): Promise<void> {
  try {
    const disk = await load($)
    // No file, or one that does not parse: there is nothing to merge with.
    const isAlone = disk.isMissing || disk.isBroken
    const merged = isAlone
      ? { nodes: list, events: log }
      : { nodes: mergeById(base.nodes, list, disk.nodes), events: mergeById(base.events, log, disk.events) }
    const isSame =
      !isAlone &&
      JSON.stringify(merged.nodes) === JSON.stringify(disk.nodes) &&
      JSON.stringify(merged.events) === JSON.stringify(disk.events)
    if (!isSame) await write($, treeId, treeName, merged.nodes, merged.events)
    base = merged
    if (JSON.stringify(merged.nodes) !== JSON.stringify(list)) await update($, nodes, () => merged.nodes)
    if (JSON.stringify(merged.events) !== JSON.stringify(log)) await update($, events, () => merged.events)
  } catch (error) {
    $.ui.toast(t().notSaved(`${DIR}/${treeFile(treeId)}`, String(error)))
  }
}

// Takes in what another session wrote, and writes only what this one changed.
async function sync($: $): Promise<void> {
  await save($, await read($, nodes), await read($, events))
}

async function listTrees($: $): Promise<{ id: string; name: string }[]> {
  const entries = await $.fs.list(`${root}/${DIR}`).catch(() => [])
  const found = await Promise.all(
    entries.flatMap(entry => {
      const id = entry.kind === 'file' ? treeIdOf(entry.name) : null
      return id === null ? [] : [load($, id).then(one => ({ id, name: shownName(id, one.name) || id }))]
    }),
  )
  const hasMain = found.some(one => one.id === '')

  return [...(hasMain ? [] : [{ id: '', name: shownName('', '') }]), ...found].sort(
    (a, b) => Number(b.id === '') - Number(a.id === '') || a.name.localeCompare(b.name),
  )
}

// Opens a tree in this session; a new session opens the one opened last.
async function openTree($: $, id: string): Promise<Loaded> {
  treeId = id
  const loaded = await load($, id)
  treeName = loaded.name
  base = { nodes: loaded.nodes, events: loaded.events }
  await update($, nodes, () => loaded.nodes)
  await update($, events, () => loaded.events)
  await update($, tree, () => id)
  await $.store.set(pointerKey(), id).catch(() => undefined)
  // Migration makes new history ids each time, so the migrated file is written as is.
  if (loaded.isOld) await write($, id, treeName, loaded.nodes, loaded.events)
  trees = await listTrees($)
  guide = guideOf(loaded.nodes, loaded.events)

  return loaded
}

async function switchTree($: $, id: string): Promise<void> {
  if (id === treeId) return
  await openTree($, id)
  await update($, selected, () => '')
  await update($, removing, () => '')
  await update($, collapsed, () => [])
  await update($, tab, () => 'map')
  $.ui.toast(t().opened(openName()))
}

// A fresh tree beside the others, which stay as they are.
async function newTree($: $, name: string): Promise<string> {
  const id = newId()
  await write($, id, name, [], [])
  await switchTree($, id)

  return id
}

// Every change goes through here, so the file follows the state. Each change
// may also add steps to history.
async function commit(
  $: $,
  change: (list: TreeNode[]) => TreeNode[],
  steps: (list: TreeNode[]) => HistoryEvent[] = () => [],
): Promise<TreeNode[]> {
  let made: HistoryEvent[] = []
  const list = await update($, nodes, before => {
    made = steps(before)
    return change(before)
  })
  const log = await update($, events, all => (made.length ? [...all, ...made] : all))
  await save($, list, log)

  return list
}

async function record($: $, step: HistoryEvent): Promise<void> {
  const log = await update($, events, all => [...all, step])
  await save($, await update($, nodes, same => same), log)
}

async function addEntry($: $, text: string, parentId: string | null): Promise<TreeNode | null> {
  const entry = parseEntry(text)
  if (!entry) return null
  const node = makeNode({ ...entry, parentId, source: 'person' }, await read($, lastPrompt), Date.now())
  await commit($, list => [...list, node])

  return node
}

// Takes the node out of the tree into history, as the step `kind`.
async function closeOut(
  $: $,
  id: string,
  kind: EventKind,
  extra: { option?: string; reason?: string } = {},
): Promise<void> {
  const anchor = await read($, lastPrompt)
  const now = Date.now()
  await commit(
    $,
    list => takeOut(list, id).rest,
    list => {
      const node = list.find(one => one.id === id)
      if (!node) return []
      const chosen = extra.option !== undefined ? { ...node, chosen: extra.option } : node
      return [stepOf(list, chosen, kind, takeOut(list, id).taken, now, { ...extra, anchor })]
    },
  )
  await update($, selected, at => (at === id ? '' : at))
  await update($, removing, at => (at === id ? '' : at))
}

async function setStatus($: $, id: string, status: NodeStatus): Promise<void> {
  if (status === 'done') {
    const node = (await update($, nodes, same => same)).find(one => one.id === id)
    if (node) await closeOut($, id, closingOf(node))
    return
  }
  await commit($, list => patch(list, id, node => ({ ...node, status, proposal: undefined }), Date.now()))
}

async function decide($: $, id: string, option: string): Promise<void> {
  await closeOut($, id, 'decided', { option })
}

async function acceptProposal($: $, id: string): Promise<void> {
  const node = (await update($, nodes, same => same)).find(one => one.id === id)
  if (!node?.proposal) return
  if (node.proposal.chosen !== undefined) return decide($, id, node.proposal.chosen)
  if (node.proposal.status !== undefined) return setStatus($, id, node.proposal.status)
}

async function rejectProposal($: $, id: string): Promise<void> {
  await commit($, all => patch(all, id, node => ({ ...node, proposal: undefined }), Date.now()))
}

async function place($: $, id: string, parentId: string | null): Promise<void> {
  await commit($, all => patch(all, id, node => ({ ...node, parentId, isInbox: false }), Date.now()))
}

// A question, idea or finding taken into work becomes a task on the map.
async function takeIntoWork($: $, id: string, parentId: string | null): Promise<void> {
  await commit($, all =>
    patch(all, id, node => ({ ...node, kind: 'task', parentId, isInbox: false, status: 'open', proposal: undefined }), Date.now()),
  )
  await update($, selected, () => id)
  await update($, tab, () => 'map')
}

// Gone without a trace: what was dropped, or removed with no reason given.
async function erase($: $, id: string): Promise<void> {
  await commit($, all => takeOut(all, id).rest)
  await update($, selected, at => (at === id ? '' : at))
  await update($, removing, at => (at === id ? '' : at))
}

// With a reason, a removal is a step worth remembering; without one, it is erased.
async function removeWithReason($: $, id: string, reason: string): Promise<void> {
  if (reason.trim() === '') return erase($, id)
  await closeOut($, id, 'removed', { reason: reason.trim() })
}

// Empties a tab in one step of history, so one "put back" returns all of it.
async function clearTray($: $, tray: Tray, reason: string): Promise<number> {
  const gone = trayList(await read($, nodes), tray)
  if (gone.length === 0) return 0
  const anchor = (await read($, lastPrompt)) ?? undefined
  const now = Date.now()
  await commit(
    $,
    list => gone.reduce((rest, node) => takeOut(rest, node.id).rest, list),
    list => [
      {
        id: newId(),
        at: now,
        kind: 'removed',
        title: t().clearedTitle(t().trays[tray].label, gone.length),
        detail: `${reason} ${gone.map(node => `«${node.title}»`).join(', ')}`,
        anchor,
        restore: gone.flatMap(node => takeOut(list, node.id).taken),
      },
    ],
  )
  await update($, selected, at => (gone.some(node => node.id === at) ? '' : at))

  return gone.length
}

// Puts what a step took out back into the tree, and drops the step. The pane
// then shows where it went: its tab, its branch unfolded, the node selected.
async function restore($: $, eventId: string): Promise<void> {
  const step = (await update($, events, same => same)).find(one => one.id === eventId)
  if (!step?.restore?.length) return
  const back = step.restore
  const list = await update($, nodes, all => [...all.filter(node => !back.some(one => one.id === node.id)), ...back])
  const log = await update($, events, all => all.filter(one => one.id !== eventId))
  await save($, list, log)

  const node = back.find(one => !back.some(other => other.id === one.parentId)) ?? back[0]
  if (!node) return
  const where = trayOf(node)
  const ancestors = new Set<string>()
  for (let at = node.parentId; at !== null && !ancestors.has(at); at = list.find(one => one.id === at)?.parentId ?? null) {
    ancestors.add(at)
  }
  await update($, collapsed, ids => ids.filter(id => !ancestors.has(id)))
  await update($, tab, () => where ?? 'map')
  await update($, selected, () => node.id)
  const path = pathOf(list, node.id)
  const place = where ? t().toTab(t().trays[where].label) : t().toMap(path.join(' › '))
  $.ui.toast(t().restoredTo(node.title, place))
}

// Starts a reply to the node in the prompt box, so the person only adds their
// answer, typed or dictated. A draft already there is kept, the lead after it.
async function reply($: $, node: TreeNode): Promise<void> {
  const lead = replyLead(node)
  const draft = (await $.prompt.read()).text
  const text = draft.trim() === '' ? lead : `\n${lead}`
  const filled = await $.prompt.fill({
    text,
    mode: draft.trim() === '' ? 'replace' : 'append',
    decorations: [{ start: text.length - lead.length, end: text.length, color: KINDS[node.kind].color }],
  })
  if (!filled.isFilled) $.ui.toast(t().promptBusy)
}

async function jump($: $, anchor: Anchor): Promise<void> {
  if (anchor.sessionId !== (await $.session.id())) {
    const when = new Date(anchor.at).toLocaleString(t().locale)
    $.ui.toast(t().otherSession(when, anchor.excerpt))
    return
  }
  const moved = await $.ui.scroll({ to: { requestId: anchor.messageId }, block: 'center' })
  if (moved.deny !== undefined) $.ui.toast(t().noScroll(moved.deny))
}

type ToolInput = {
  action?: 'list' | 'brief' | 'add' | 'update' | 'log' | 'remove' | 'new' | 'switch'
  tray?: Tray
  id?: string
  kind?: NodeKind
  title?: string
  detail?: string
  parentId?: string
  options?: string[]
  status?: NodeStatus
  chosen?: string
}

async function runTool($: $, input: ToolInput): Promise<string> {
  if (input.action === 'list' || input.action === undefined) {
    trees = await listTrees($)
    // Another session may have written since: show the tree as it stands.
    await sync($)
    const all = await read($, nodes)
    if (input.id !== undefined) {
      const one = all.find(node => node.id === input.id)
      return one ? nodeCard(all, one) : t().noNode(input.id)
    }
    const others = trees.filter(one => one.id !== treeId).map(one => `«${one.name}» [${one.id || 'main'}]`)
    const head = `${t().opened(openName())}${others.length ? t().otherTrees(others.join(', ')) : ''}`

    return `${head}\n\n${outline(all, await read($, events))}`
  }

  if (input.action === 'brief') {
    await sync($)
    return `${briefing(openName(), await read($, nodes), await read($, events), Date.now())}\n\n${t().briefAsk}`
  }

  if (input.action === 'new') {
    const name = input.title?.trim() || t().treeOf(today())
    const before = openName()
    await newTree($, name)
    return t().newTree(name, before)
  }

  if (input.action === 'switch') {
    trees = await listTrees($)
    const wanted = input.id === 'main' ? '' : input.id
    const found = trees.find(one => one.id === wanted || one.name === input.title?.trim())
    if (!found) return t().noSuchTree(trees.map(one => `«${one.name}» [${one.id || 'main'}]`).join(', '))
    await switchTree($, found.id)
    return t().opened(found.name)
  }

  const list = await read($, nodes)

  if (input.action === 'log') {
    if (!input.title?.trim()) return t().needTitle
    const parent = list.find(node => node.id === input.parentId)
    const path = parent ? [...pathOf(list, parent.id), parent.title] : []
    await record($, {
      id: newId(),
      at: Date.now(),
      kind: 'step',
      title: input.title.trim(),
      detail: input.detail,
      branch: path.length ? path.join(' › ') : undefined,
      anchor: (await read($, lastPrompt)) ?? undefined,
    })
    return t().logged
  }

  if (input.action === 'add') {
    if (!input.kind || !KINDS[input.kind] || !input.title?.trim()) {
      return t().needKind
    }
    const parent = list.find(node => node.id === input.parentId && isOnMap(node))
    const node = makeNode(
      {
        kind: input.kind,
        title: input.title.trim(),
        detail: input.detail,
        options: input.options,
        parentId: parent?.id ?? null,
        source: 'claude',
        // A task with no branch to go in waits on the Ideas tab for the person to file.
        isInbox: input.kind === 'task' && parent === undefined,
      },
      await read($, lastPrompt),
      Date.now(),
    )
    await commit($, all => [...all, node])

    const tray = trayOf(node)
    if (tray) return t().addedTray(node.id, t().trays[tray].label)

    return parent ? t().addedUnder(node.id, parent.title) : t().addedRoot(node.id)
  }

  if (input.action === 'remove') {
    const reason = input.detail?.trim() || t().byRequest
    if (input.tray !== undefined && TRAYS.includes(input.tray)) {
      const label = t().trays[input.tray].label
      const count = await clearTray($, input.tray, reason)
      return count ? t().cleared(label, count) : t().nothingToClear(label)
    }
    const gone = list.find(node => node.id === input.id)
    if (!gone) return input.id === undefined ? t().needTarget : t().noNode(input.id)
    await closeOut($, gone.id, 'removed', { reason })
    return t().removed(gone.title)
  }

  const target = list.find(node => node.id === input.id)
  if (!target) return t().noNode(input.id ?? '')
  const proposal = {
    ...(input.status !== undefined && input.status !== target.status ? { status: input.status } : {}),
    ...(input.chosen !== undefined ? { chosen: input.chosen } : {}),
  }
  const hasProposal = Object.keys(proposal).length > 0
  await commit($, all =>
    patch(
      all,
      target.id,
      node => ({
        ...node,
        title: input.title?.trim() || node.title,
        detail: input.detail ?? node.detail,
        options: input.options ?? node.options,
        proposal: hasProposal ? { ...node.proposal, ...proposal } : node.proposal,
      }),
      Date.now(),
    ),
  )

  return hasProposal ? t().updatedAsk(target.id) : t().updated(target.id)
}

const TOOL_DESCRIPTION = `The project tree the person keeps beside the chat. The map holds branches (features, areas) and the tasks under them. Questions, decisions (with options), ideas, findings and notes wait on their own tabs until the person takes them into work, where they become tasks, or drops them. History records the important steps.
- action "list": the map, the waiting tabs and recent history, with ids and the gist of each node's detail. With id: that one node in full. Call it before working on a node, or when the person asks what is open.
- action "brief": where the project stands, for a person coming back to it: the latest steps, work in progress, what waits on them, what has lain untouched. Call it when the person returns or asks where they left off, and retell it briefly.
- action "add": a branch, or a task under parentId, goes on the map; a task with no parentId waits on the Ideas tab. Other kinds go to their tab, parentId naming the branch they concern. Add, without being asked, a finding, open question or follow-up idea that turns up during the work and is not being handled right now.
- action "update": change title, detail or options of a node by id. A new status (open|doing|done|parked) or a chosen option is a proposal the person confirms on the card.
- action "log": record an important step in history (title, detail, parentId for the branch): a feature added or dropped, a direction decided in chat. Do it unasked when such a step happens. Closing a task or choosing an option records itself.
- action "remove": only when the person asks to remove a node (id) or to clear a tab (tray: questions|ideas|findings); detail is the reason. What is removed goes to History, where the person can put it back.
- action "new": when the person asks to clear the tree or start afresh, begin a new empty tree (title: its name). The old tree is kept; never empty it node by node.
- action "switch": open another tree of the project, by id from "list" ("main" for the main one) or by name in title.
Write titles in the person's language, short.`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    root = (await $.session.root()).replace(/\\/g, '/')
    // Until the person writes, the language they wrote in last, else the system's.
    const said = await $.store.get(LANG_KEY).catch(() => undefined)
    setLang(isLang(said) ? said : systemLang())
    await update($, language, () => (isLang(said) ? said : systemLang()))
    // A reload keeps the session's tree; a new session takes the one opened last.
    const kept = await read($, tree)
    const last = kept ?? (await $.store.get(pointerKey()).catch(() => undefined))
    const id = typeof last === 'string' && (last === '' || (await $.fs.exists(pathOfTree(last)).catch(() => false))) ? last : ''
    await openTree($, id)

    await $.command.register({
      name: 'tree',
      description: t().command,
      argumentHint: t().entryHint,
    })
    await $.tool.register({
      name: 'tree',
      description: TOOL_DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'brief', 'add', 'update', 'log', 'remove', 'new', 'switch'] },
          id: { type: 'string', description: 'Node id for update, remove, or list of one node; tree id for switch' },
          tray: { type: 'string', enum: [...TRAYS], description: 'For remove: the tab to clear' },
          kind: { type: 'string', enum: Object.keys(KINDS) },
          title: { type: 'string' },
          detail: { type: 'string', description: 'A sentence or two of context' },
          parentId: { type: 'string', description: 'For add and log: the branch or task it belongs to' },
          options: { type: 'array', items: { type: 'string' }, description: 'For decisions' },
          status: { type: 'string', enum: [...STATUSES] },
          chosen: { type: 'string', description: 'For decisions: the option chosen' },
        },
        required: ['action'],
      },
    })
    void $.ui.open({ id: PANE, title: t().title })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      sections: [...composed.sections, { id: 'project-tree:guide', text: guide || t().notLoaded, scope: 'session' }],
    }
  })

  // A prompt that names a node, as "Ответить" writes it, carries the whole node
  // to the model: the person sees one line, Claude reads the rest. The prompt
  // also tells the language the mod speaks; a slash command does not.
  on('prompt.submit', async ($, e, next) => {
    const said = e.text.trimStart().startsWith('/') ? null : langOf(e.text)
    if (said) await speak($, said)
    const list = await read($, nodes)
    const briefs = mentionedIds(e.text, list).flatMap(id => {
      const node = list.find(one => one.id === id)
      return node ? [briefOf(list, node)] : []
    })
    if (briefs.length === 0) return next(e)

    return next({ ...e, context: [...(e.context ?? []), ...briefs] })
  }).catch(($, e, next) => next(e))

  // Remembers the person's latest prompt: a node made now is anchored to it.
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    const stored = await next(e)
    if (stored.deny !== undefined || e.agentId !== undefined || e.message.isMeta) return stored
    const text = textOf(stored.message.content)
    if (text !== '') {
      const anchor: Anchor = {
        sessionId: await $.session.id(),
        messageId: stored.uuid,
        excerpt: excerptOf(text),
        at: Date.now(),
      }
      await update($, lastPrompt, () => anchor)
    }

    return stored
  }).catch(($, e, next) => next(e))

  // When a turn ends, the pane takes in what other sessions wrote meanwhile.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await sync($).catch(() => undefined)

    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: TOOL }, async ($, e) => ({
    result: await runTool($, e as unknown as ToolInput),
  })).catch(($, e, next) => (next.called ? next(e) : { deny: t().toolFailed }))

  on('command.run', { command: 'tree' }, async ($, e) => {
    if (e.args.trim() === '') {
      await $.ui.open({ id: PANE, title: t().title })
      return { text: t().paneOpened }
    }
    if (/^(brief|бриф|сводка)$/i.test(e.args.trim())) {
      await sync($)
      return { text: briefing(openName(), await read($, nodes), await read($, events), Date.now()) }
    }
    const node = await addEntry($, e.args, null)
    void $.ui.open({ id: PANE, title: t().title })

    return node ? { text: t().addedByCommand(t().kinds[node.kind], node.title) } : { text: t().notUnderstood(t().entryHint) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Read first: the pane draws again when the person's language changes.
    setLang(await read($, language))
    const s = t()
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : undefined
    const Select = 'Select' in table ? table.Select : undefined
    const list = await read($, nodes)
    const log = await read($, events)
    const closed = await read($, collapsed)
    const stored: Tab = await read($, tab)
    // Views since dropped: the old lists open the map, the old inbox the Ideas tab.
    const current: Tab = stored === 'inbox' ? 'ideas' : stored === 'tree' || stored === 'graph' || stored === 'ready' ? 'map' : stored
    const selectedId = await read($, selected)
    const removingId = await read($, removing)
    const seq = await read($, inputSeq)
    const latest = await read($, lastPrompt)
    const width = Math.max(20, e.props.bodyColumns ?? 40)
    const chosen = list.find(node => node.id === selectedId)
    const now = Date.now()
    const trays: Record<Tray, TreeNode[]> = {
      questions: trayList(list, 'questions'),
      ideas: trayList(list, 'ideas'),
      findings: trayList(list, 'findings'),
    }

    const select = (id: string) =>
      void (async () => {
        if ((await read($, selected)) === id) {
          await update($, collapsed, ids =>
            ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id],
          )
          return
        }
        await update($, selected, () => id)
        await update($, removing, () => '')
      })()

    const roomy = e.surface === 'terminal' ? 1 : 1.3
    const byId = new Map(list.map(node => [node.id, node]))
    const ancestorsOf = (node: TreeNode): TreeNode[] => {
      const found: TreeNode[] = []
      let at = node.parentId
      while (at !== null && found.length < 20) {
        const parent = byId.get(at)
        if (!parent) break
        found.unshift(parent)
        at = parent.parentId
      }
      return found
    }
    // The color of the line at depth k is that of the ancestor it hangs from,
    // so a subtask's line takes its task's color, not the branch's.
    const lineColor = (node: TreeNode, depth: number): Color => {
      const owner = ancestorsOf(node)[depth]
      return owner ? KINDS[owner.kind].color : 'inactive'
    }

    const proposalText = (node: TreeNode) =>
      [
        node.proposal?.status && s.proposalStatus(s.statuses[node.proposal.status]),
        node.proposal?.chosen && s.proposalChoose(node.proposal.chosen),
      ]
        .filter(Boolean)
        .join(', ')

    // Claude's proposed change, answered on the card it concerns.
    const proposalLine = (node: TreeNode) =>
      node.proposal && (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Text color="warning">{`Claude: ${proposalText(node)}`}</Text>
          <Button key={`accept:${node.id}`} variant="primary" onPress={() => void acceptProposal($, node.id)}>
            {s.accept}
          </Button>
          <Button key={`reject:${node.id}`} onPress={() => void rejectProposal($, node.id)}>
            {s.reject}
          </Button>
        </Box>
      )

    // Asks why before a removal: a reason keeps it in history, none erases it.
    const removalAsk = (node: TreeNode) =>
      removingId === node.id && (
        <Box flexDirection="column">
          {Input && (
            <Input
              key={`why:${node.id}`}
              label={s.why}
              placeholder={s.whyHint}
              submitLabel={s.removeVerb}
              onSubmit={text => void removeWithReason($, node.id, text)}
            />
          )}
          <Box flexDirection="row" gap={1}>
            <Button key={`erase:${node.id}`} onPress={() => void erase($, node.id)}>
              {s.eraseNoTrace}
            </Button>
            <Button key={`cancel:${node.id}`} onPress={() => void update($, removing, () => '')}>
              {s.cancel}
            </Button>
          </Box>
        </Box>
      )
    // Without a text field the reason cannot be asked: the removal erases at once.
    const askRemoval = (id: string) => void (Input ? update($, removing, () => id) : erase($, id))

    // A line is box-drawing glyphs, one per row. Every card is CARD_ROWS
    // tall, so the column beside it is that many rows.
    const CARD_ROWS = 4
    const glyphColumn = (key: string, cells: string[], color: Color) => (
      <Box key={key} flexDirection="column" width={3} flexShrink={0}>
        {cells.map(cell => (
          <Text color={color}>{cell}</Text>
        ))}
      </Box>
    )

    const mapCard = (node: TreeNode, childCount: number, cardWidth: number) => {
      const kind = KINDS[node.kind]
      const isParked = node.status === 'parked'
      const isSelected = node.id === selectedId
      const inner = cardWidth - 4
      const { done, total } = progressOf(list, node.id)
      const hidden = childCount > 0 && closed.includes(node.id) ? s.more(childCount) : ''
      const progress = total > 0 ? s.subtasks(done, total) : ''
      const stale = node.kind === 'task' && isStale(node, now) ? s.untouched(ageOf(node.updatedAt, now)) : ''
      const meta = `${s.kinds[node.kind]} · ${s.statuses[node.status]}${progress}${stale}${hidden}`

      return (
        <Box
          key={`card:${node.id}`}
          flexDirection="column"
          width={cardWidth}
          flexShrink={0}
          paddingX={1}
          borderStyle={isSelected ? 'double' : node.status === 'doing' ? 'bold' : 'round'}
          borderColor={isSelected ? 'text' : kind.color}
          borderDimColor={isParked && !isSelected}
          hover={{ borderColor: 'text' }}
        >
          <Button key={`row:${node.id}`} plain onPress={() => select(node.id)}>
            <Text color={kind.color} dimColor={isParked}>{`${iconOf(node)} `}</Text>
            <Text bold={!isParked} dimColor={isParked}>
              {/* A card stays CARD_ROWS tall for the line beside it, so a title
                  keeps to one row; a desktop's font fits about a third more than cells say. */}
              {fit(node.title, Math.max(6, Math.round((inner - 2) * roomy)))}
            </Text>
          </Button>
          {isSelected ? (
            // The selected card carries its actions in place of its status line.
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {node.kind === 'task' && (
                <Button key={`done:${node.id}`} plain onPress={() => void setStatus($, node.id, 'done')}>
                  {s.done}
                </Button>
              )}
              <Button key={`reply:${node.id}`} plain onPress={() => void reply($, node)}>
                {node.kind === 'task' ? s.reply : s.discuss}
              </Button>
              {node.kind === 'task' && node.status === 'open' && (
                <Button key={`doing:${node.id}`} plain onPress={() => void setStatus($, node.id, 'doing')}>
                  {s.toWork}
                </Button>
              )}
              {node.kind === 'task' && node.status === 'doing' && (
                <Button key={`park:${node.id}`} plain onPress={() => void setStatus($, node.id, 'parked')}>
                  {s.park}
                </Button>
              )}
              {isParked && (
                <Button key={`resume:${node.id}`} plain onPress={() => void setStatus($, node.id, 'open')}>
                  {s.resume}
                </Button>
              )}
              <Button key={`remove:${node.id}`} plain onPress={() => askRemoval(node.id)}>
                ✕
              </Button>
            </Box>
          ) : (
            <Text dimColor>{fit(meta, Math.round(inner * roomy))}</Text>
          )}
          {proposalLine(node)}
          {removalAsk(node)}
        </Box>
      )
    }

    const mapRow = (row: Row, isFirst: boolean) => {
      const { node, depth, childCount, isLast, rails } = row
      const prefix = [
        ...rails.map((runs, level) =>
          glyphColumn(`rail:${level}`, Array(CARD_ROWS).fill(runs ? '│  ' : '   '), lineColor(node, level)),
        ),
        ...(depth > 0
          ? [
              glyphColumn(
                'link',
                ['│  ', isLast ? '└─ ' : '├─ ', ...Array(CARD_ROWS - 2).fill(isLast ? '   ' : '│  ')],
                lineColor(node, depth - 1),
              ),
            ]
          : []),
      ]

      return (
        <Box flexDirection="row" marginTop={depth === 0 && !isFirst ? 1 : 0}>
          {prefix}
          {mapCard(node, childCount, Math.max(16, width - depth * 3))}
        </Box>
      )
    }

    // Where a node can go on the map: a branch, or a task to sit under.
    const mapPlaces = (id: string) => [
      { value: '', label: s.toRoot },
      ...flatten(list, [])
        .filter(row => row.node.id !== id)
        .map(row => ({
          value: row.node.id,
          label: fit(`${'  '.repeat(row.depth)}${iconOf(row.node)} ${row.node.title}`, width - 4),
        })),
    ]

    // Where the node sits: its top branch in that branch's color, the rest dim.
    const pathLine = (node: TreeNode, tail: string) => {
      const [top, ...rest] = ancestorsOf(node)
      if (!top) return <Text dimColor>{tail}</Text>

      return (
        <Text>
          <Text color={KINDS[top.kind].color}>{`${iconOf(top)} ${top.title}`}</Text>
          <Text dimColor>{`${rest.map(one => ` › ${one.title}`).join('')} · ${tail}`}</Text>
        </Text>
      )
    }

    // A card on a tray: no line runs beside it, so a title may wrap.
    const trayCard = (node: TreeNode) => {
      const kind = KINDS[node.kind]
      const isSelected = node.id === selectedId
      const asks = node.kind === 'question' || node.kind === 'decision'
      const who = node.isInbox ? s.fromClaudeNoBranch : node.source === 'claude' ? s.fromClaude : s.yours

      return (
        <Box
          key={`card:${node.id}`}
          flexDirection="column"
          paddingX={1}
          borderStyle={isSelected ? 'double' : 'round'}
          borderColor={isSelected ? 'text' : kind.color}
          hover={{ borderColor: 'text' }}
        >
          <Button key={`row:${node.id}`} plain onPress={() => select(node.id)}>
            <Text color={kind.color}>{`${iconOf(node)} `}</Text>
            <Text bold>{node.title}</Text>
          </Button>
          {pathLine(node, `${who} · ${ageOf(node.createdAt, now)}`)}
          {isStale(node, now) && <Text color="warning">{s.lyingLong(ageOf(node.updatedAt, now))}</Text>}
          {node.detail && <Text dimColor>{excerptOf(node.detail, 160)}</Text>}
          {proposalLine(node)}
          {node.kind === 'decision' && (node.options ?? []).length > 0 && (
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {(node.options ?? []).map((option, at) => (
                <Button key={`opt:${node.id}:${at}`} onPress={() => void decide($, node.id, option)}>
                  {option}
                </Button>
              ))}
            </Box>
          )}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {Select && (
              <Select
                key={`take:${node.id}`}
                label={s.takeIntoWork}
                options={mapPlaces(node.id)}
                onSelect={value => void takeIntoWork($, node.id, value || null)}
              />
            )}
            <Button key={`reply:${node.id}`} plain onPress={() => void reply($, node)}>
              {asks ? s.reply : s.discuss}
            </Button>
            {node.kind === 'question' && (
              <Button key={`answered:${node.id}`} plain onPress={() => void closeOut($, node.id, 'answered')}>
                {s.answered}
              </Button>
            )}
            <Button key={`dismiss:${node.id}`} plain onPress={() => void erase($, node.id)}>
              {s.notNeeded}
            </Button>
          </Box>
        </Box>
      )
    }

    const historyBody = () => {
      const sorted = [...log].sort((a, b) => b.at - a.at)
      const days: [string, HistoryEvent[]][] = []
      for (const step of sorted) {
        const day = dayOf(step.at, now)
        const last = days[days.length - 1]
        if (last && last[0] === day) last[1].push(step)
        else days.push([day, [step]])
      }

      return days.map(([day, steps]) => (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{day}</Text>
          {steps.map(step => {
            const look = EVENTS[step.kind]
            const time = new Date(step.at).toLocaleTimeString(s.locale, { hour: '2-digit', minute: '2-digit' })
            const under = [step.detail && excerptOf(step.detail, 160), step.branch, time].filter(Boolean).join(' · ')
            return (
              <Box key={`step:${step.id}`} flexDirection="column" marginBottom={1}>
                <Text>
                  <Text color={look.color}>{`${look.icon} `}</Text>
                  <Text>{eventTitle(step)}</Text>
                </Text>
                <Text dimColor>{under}</Text>
                {(step.restore?.length ?? 0) > 0 && (
                  <Button key={`restore:${step.id}`} plain dimColor onPress={() => void restore($, step.id)}>
                    {s.restore}
                  </Button>
                )}
              </Box>
            )
          })}
        </Box>
      ))
    }

    const tabs = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {(
          [
            ['map', s.mapTab],
            ['questions', `${s.trays.questions.label} ${trays.questions.length}`],
            ['ideas', `${s.trays.ideas.label} ${trays.ideas.length}`],
            ['findings', `${s.trays.findings.label} ${trays.findings.length}`],
            ['history', s.historyTab],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={`tab:${id}`}
            variant={current === id ? 'primary' : 'secondary'}
            onPress={() => void update($, tab, () => id)}
          >
            {label}
          </Button>
        ))}
      </Box>
    )

    const rows = flatten(list, closed)
    const body: RenderChildren =
      current === 'map' ? (
        rows.length === 0 ? (
          <Text dimColor>{s.emptyMapHint(s.entryHint)}</Text>
        ) : (
          <Box flexDirection="column">{rows.map((row, at) => mapRow(row, at === 0))}</Box>
        )
      ) : current === 'history' ? (
        log.length === 0 ? (
          <Text dimColor>{s.emptyHistory}</Text>
        ) : (
          <Box flexDirection="column">{historyBody()}</Box>
        )
      ) : (
        <Box flexDirection="column" gap={1}>
          {trays[current as Tray].length === 0 ? (
            <Text dimColor>{s.trays[current as Tray].empty}</Text>
          ) : (
            trays[current as Tray].map(trayCard)
          )}
        </Box>
      )

    const details = chosen && (
      <Box flexDirection="column" marginTop={1} borderStyle="round" paddingX={1}>
        <Text bold>{`${iconOf(chosen)} ${chosen.title}`}</Text>
        <Text dimColor>
          {`${s.kinds[chosen.kind]} · ${s.statuses[chosen.status]} · ${chosen.source === 'claude' ? s.addedByClaude : s.addedByYou} · ${new Date(chosen.createdAt).toLocaleDateString(s.locale)}`}
        </Text>
        {pathOf(list, chosen.id).length > 0 && (
          <Text dimColor>{s.inBranch(pathOf(list, chosen.id).join(' › '))}</Text>
        )}
        {chosen.detail && <Text>{chosen.detail}</Text>}
        {chosen.kind === 'decision' &&
          (chosen.options ?? []).map(option => <Text>{`◇ ${option}`}</Text>)}
        {chosen.anchor ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{s.fromMessage(new Date(chosen.anchor.at).toLocaleString(s.locale), chosen.anchor.excerpt)}</Text>
            {/* The desktop keeps the transcript to the person; the terminal lets a plugin scroll it. */}
            {e.surface === 'terminal' && (
              <Button key="jump" onPress={() => void jump($, chosen.anchor as Anchor)}>
                {s.jump}
              </Button>
            )}
          </Box>
        ) : (
          // A node made before any prompt was seen has no source; let the person give it one.
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{s.unanchored}</Text>
            {latest && (
              <Button
                key="anchor"
                onPress={() =>
                  void commit($, all => patch(all, chosen.id, node => ({ ...node, anchor: latest }), Date.now()))
                }
              >
                {s.anchorTo(fit(latest.excerpt, Math.max(10, width - 20)))}
              </Button>
            )}
          </Box>
        )}
        {isOnMap(chosen) && Select && (
          <Select
            key="place"
            label={s.moveTo}
            value={chosen.parentId ?? ''}
            options={mapPlaces(chosen.id)}
            onSelect={value => void place($, chosen.id, value || null)}
          />
        )}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {isOnMap(chosen) && chosen.kind === 'task' && chosen.status !== 'parked' && (
            <Button key="park" onPress={() => void setStatus($, chosen.id, 'parked')}>{s.parkPlain}</Button>
          )}
          <Button key="unselect" onPress={() => void update($, selected, () => '')}>×</Button>
        </Box>
      </Box>
    )

    const parentForNew = chosen && isOnMap(chosen) ? chosen : undefined
    // The project's trees; the session keeps to the one it opened.
    const shelf = Select && (
      <Select
        key="trees"
        label={s.treeLabel}
        value={(await read($, tree)) ?? treeId}
        options={[
          ...trees.map(one => ({ value: one.id, label: fit(one.name, width - 12) })),
          { value: '+new', label: s.newTreeOption },
        ]}
        onSelect={value =>
          void (value === '+new'
            ? newTree($, s.treeOf(today()))
            : switchTree($, value))
        }
      />
    )

    return (
      <Box flexDirection="column">
        {shelf}
        {tabs}
        <Box flexDirection="column" marginTop={1}>
          {body}
        </Box>
        {details}
        {Input && (
          <Box marginTop={1}>
            <Input
              key={`add:${seq}`}
              label="+"
              placeholder={parentForNew ? s.addInto(fit(parentForNew.title, 20), s.entryHint) : s.entryHint}
              submitLabel={s.addVerb}
              onSubmit={text =>
                void (async () => {
                  const node = await addEntry($, text, parentForNew?.id ?? null)
                  if (!node) return
                  await update($, inputSeq, n => n + 1)
                  if (parentForNew) {
                    await update($, collapsed, ids => ids.filter(id => id !== parentForNew.id))
                  }
                })()
              }
            />
          </Box>
        )}
      </Box>
    )
  })
}
