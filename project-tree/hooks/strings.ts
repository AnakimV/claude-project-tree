import type { EventKind, NodeKind, NodeStatus, Tray } from '../types'

// The pane speaks the language the person writes in: Russian for Cyrillic,
// English otherwise. There is no setting for it.
export type Lang = 'ru' | 'en'

// The Russian noun form for n: one, few (2-4) or many.
export function plural(n: number, forms: readonly [string, string, string]): string {
  const tens = n % 100
  const ones = n % 10
  if (tens >= 11 && tens <= 14) return forms[2]
  if (ones === 1) return forms[0]
  if (ones >= 2 && ones <= 4) return forms[1]

  return forms[2]
}

const ru = {
  locale: 'ru-RU',
  title: 'Дерево проекта',
  mainTree: 'Основное',
  kinds: {
    branch: 'ветка',
    task: 'задача',
    question: 'вопрос',
    decision: 'решение',
    idea: 'идея',
    finding: 'находка',
    note: 'заметка',
  } as Record<NodeKind, string>,
  statuses: { open: 'открыто', doing: 'в работе', done: 'готово', parked: 'отложено' } as Record<NodeStatus, string>,
  trays: {
    questions: { label: 'Вопросы', empty: 'Открытых вопросов и решений нет.' },
    ideas: { label: 'Идеи', empty: 'Идей пока нет. Сюда же попадают задачи от Claude без ветки.' },
    findings: { label: 'Находки', empty: 'Находок и заметок пока нет.' },
  } as Record<Tray, { label: string; empty: string }>,
  leads: { done: 'Закрыта: ', answered: 'Ответили: ', decided: 'Решили: ', removed: 'Убрали: ', step: '' } as Record<EventKind, string>,
  entryHint: '# ветка  - задача  ? вопрос  ! решение  * идея  > находка  ~ заметка',

  // How long ago, in the largest unit that fits: "12 мин", "3 ч", "2 дня", "3 нед".
  age: {
    underMinute: 'меньше минуты',
    minutes: (n: number) => `${n} мин`,
    hours: (n: number) => `${n} ч`,
    days: (n: number) => `${n} ${plural(n, ['день', 'дня', 'дней'])}`,
    weeks: (n: number) => `${n} нед`,
  },
  today: 'Сегодня',
  yesterday: 'Вчера',

  // What Claude reads: the outline, the digest, tool results.
  options: 'варианты',
  chosen: 'выбрано',
  awaitsYes: '(ждёт подтверждения)',
  mapHead: 'Схема:',
  emptyMap: '  (пусто)',
  trayHead: (label: string) => `${label} (ждут решения человека):`,
  historyHead: 'История, последнее:',
  emptyTree: 'Дерево проекта пока пусто.',
  inBranch: (path: string) => `в ветке: ${path}`,
  digestHead: (count: number, ready: number, waiting: string) =>
    `В дереве ${count} узлов, открытой работы: ${ready}; ждут решения — ${waiting}.`,
  openNow: 'Открыто сейчас:',
  notLoaded: 'Дерево проекта пока не загружено.',
  guide: (title: string, tool: string, name: string, count: number) =>
    `## Дерево проекта
Рядом с чатом у человека панель «${title}»: схема с ветками и задачами, вкладки с вопросами, идеями и находками, история важных шагов. Работай с ней инструментом ${tool}.
Открыто дерево «${name}»${count > 1 ? ` (всего деревьев в проекте: ${count})` : ''}.`,
  opened: (name: string) => `Открыто дерево «${name}».`,
  otherTrees: (names: string) => ` Другие деревья проекта: ${names}.`,
  treeOf: (date: string) => `Дерево от ${date}`,
  newTree: (name: string, before: string) =>
    `Начато новое пустое дерево «${name}». Дерево «${before}» сохранено, к нему можно вернуться в панели или action "switch".`,
  noSuchTree: (names: string) => `Такого дерева нет. Есть: ${names}.`,
  needTitle: 'Нужен title: что за шаг.',
  logged: 'Записано в историю.',
  needKind: 'Нужны kind (branch|task|question|decision|idea|finding|note) и title.',
  addedTray: (id: string, tray: string) => `Добавлено [${id}] во вкладку «${tray}»: человек решит, брать ли в работу.`,
  addedUnder: (id: string, parent: string) => `Добавлено [${id}] в «${parent}».`,
  addedRoot: (id: string) => `Добавлено [${id}] в корень схемы.`,
  noNode: (id: string) => `Узла [${id}] нет. Вызови action "list", чтобы увидеть id.`,
  updatedAsk: (id: string) => `Обновлено [${id}]; смена статуса или выбор решения ждёт подтверждения человека на карточке узла.`,
  updated: (id: string) => `Обновлено [${id}].`,
  toolFailed: 'Дерево проекта не ответило: сбой мода.',
  andMore: (n: number) => `и ещё ${n}`,
  waitingNow: 'Ждут решения человека:',
  briefHead: (name: string) => `Дерево «${name}»: где остановились`,
  briefRecent: 'Последние шаги:',
  briefDoing: 'В работе:',
  briefOpen: (n: number) => `Открытые задачи (${n}):`,
  briefTray: (label: string, n: number) => `${label} (${n}):`,
  briefParked: 'Отложено:',
  briefStale: 'Давно не трогали:',
  briefAsk: 'Перескажи человеку коротко и предложи, с чего продолжить.',
  removed: (title: string) => `Убрано «${title}». Оно в Истории, человек может вернуть.`,
  clearedTitle: (tab: string, n: number) => `Очистили вкладку «${tab}» (${n})`,
  cleared: (tab: string, n: number) => `Вкладка «${tab}» очищена, убрано: ${n}. Всё в Истории, человек может вернуть.`,
  nothingToClear: (tab: string) => `Вкладка «${tab}» и так пуста.`,
  needTarget: 'Нужен id узла или tray (questions|ideas|findings).',
  byRequest: 'По просьбе в чате.',

  // Toasts and the command.
  notSaved: (file: string, error: string) => `Дерево не сохранилось в ${file}: ${error}`,
  restoredTo: (title: string, place: string) => `Вернули «${title}» ${place}`,
  toTab: (tab: string) => `во вкладку «${tab}»`,
  toMap: (path: string) => `в Схему${path ? `, ветка «${path}»` : ''}`,
  promptBusy: 'Не получилось вставить в поле ввода: оно сейчас занято диалогом.',
  otherSession: (when: string, excerpt: string) => `Сообщение из другой сессии (${when}): «${excerpt}»`,
  noScroll: (reason: string) => `Не удалось прокрутить к сообщению: ${reason}`,
  command: 'Дерево проекта: открыть панель, /tree brief — где остановились, или добавить узел (/tree ? вопрос)',
  paneOpened: 'Панель дерева открыта.',
  addedByCommand: (kind: string, title: string) => `Добавлено в дерево: ${kind} «${title}».`,
  notUnderstood: (hint: string) => `Не понял, что добавить. ${hint}`,

  // The pane.
  proposalStatus: (status: string) => `статус → ${status}`,
  proposalChoose: (option: string) => `выбрать «${option}»`,
  accept: 'Принять',
  reject: 'Отклонить',
  why: 'Почему убираем?',
  whyHint: 'причина попадёт в историю',
  removeVerb: 'убрать',
  eraseNoTrace: 'Удалить без следа',
  cancel: 'Отмена',
  more: (n: number) => ` · ▸ ещё ${n}`,
  subtasks: (done: number, total: number) => ` · подзадачи ${done} из ${total}`,
  untouched: (age: string) => ` · не трогали ${age}`,
  lyingLong: (age: string) => `давно лежит: ${age}`,
  done: '✓ Готово',
  reply: '↪ Ответить',
  discuss: '↪ Обсудить',
  toWork: '● В работу',
  park: '⏸ Отложить',
  resume: '▶ Вернуть',
  toRoot: '— в корень —',
  fromClaudeNoBranch: 'задача от Claude без ветки',
  fromClaude: 'от Claude',
  yours: 'твоё',
  takeIntoWork: '→ В работу:',
  answered: '✓ Решён',
  notNeeded: '✕ Не нужно',
  restore: '↩ Вернуть',
  mapTab: 'Схема',
  historyTab: 'История',
  emptyMapHint: (hint: string) => `Пусто. Добавь первую ветку ниже, например «# Название проекта».\n${hint}`,
  emptyHistory: 'Здесь появятся важные шаги: закрытые задачи, принятые решения, убранное с причиной.',
  addedByClaude: 'добавил Claude',
  addedByYou: 'добавил ты',
  fromMessage: (when: string, excerpt: string) => `Из сообщения ${when}: «${excerpt}»`,
  jump: '↩ К сообщению в чате',
  unanchored: 'Не привязано к сообщению чата.',
  anchorTo: (excerpt: string) => `📌 Привязать к «${excerpt}»`,
  moveTo: 'Перенести в:',
  parkPlain: 'Отложить',
  treeLabel: 'Дерево:',
  newTreeOption: '＋ Новое дерево',
  addInto: (title: string, hint: string) => `в «${title}»: ${hint}`,
  addVerb: 'добавить',
}

export type Strings = typeof ru

const en: Strings = {
  locale: 'en-US',
  title: 'Project tree',
  mainTree: 'Main',
  kinds: {
    branch: 'branch',
    task: 'task',
    question: 'question',
    decision: 'decision',
    idea: 'idea',
    finding: 'finding',
    note: 'note',
  },
  statuses: { open: 'open', doing: 'in progress', done: 'done', parked: 'parked' },
  trays: {
    questions: { label: 'Questions', empty: 'No open questions or decisions.' },
    ideas: { label: 'Ideas', empty: 'No ideas yet. Tasks from Claude with no branch land here too.' },
    findings: { label: 'Findings', empty: 'No findings or notes yet.' },
  },
  leads: { done: 'Done: ', answered: 'Answered: ', decided: 'Decided: ', removed: 'Removed: ', step: '' },
  entryHint: '# branch  - task  ? question  ! decision  * idea  > finding  ~ note',

  age: {
    underMinute: 'under a minute',
    minutes: n => `${n} min`,
    hours: n => `${n} h`,
    days: n => `${n} ${n === 1 ? 'day' : 'days'}`,
    weeks: n => `${n} wk`,
  },
  today: 'Today',
  yesterday: 'Yesterday',

  options: 'options',
  chosen: 'chosen',
  awaitsYes: '(awaiting confirmation)',
  mapHead: 'Map:',
  emptyMap: '  (empty)',
  trayHead: label => `${label} (awaiting the person's decision):`,
  historyHead: 'History, latest:',
  emptyTree: 'The project tree is empty so far.',
  inBranch: path => `in branch: ${path}`,
  digestHead: (count, ready, waiting) => `The tree holds ${count} nodes, open work: ${ready}; awaiting decision — ${waiting}.`,
  openNow: 'Open now:',
  notLoaded: 'The project tree is not loaded yet.',
  guide: (title, tool, name, count) =>
    `## Project tree
Beside the chat the person has the "${title}" pane: a map of branches and tasks, tabs for questions, ideas and findings, a history of key steps. Work with it through the ${tool} tool.
The open tree is "${name}"${count > 1 ? ` (trees in the project: ${count})` : ''}.`,
  opened: name => `Opened tree "${name}".`,
  otherTrees: names => ` Other trees in the project: ${names}.`,
  treeOf: date => `Tree of ${date}`,
  newTree: (name, before) =>
    `Started a new empty tree "${name}". Tree "${before}" is kept; switch back in the pane or with action "switch".`,
  noSuchTree: names => `No such tree. There are: ${names}.`,
  needTitle: 'Needs a title: what the step was.',
  logged: 'Recorded in history.',
  needKind: 'Needs kind (branch|task|question|decision|idea|finding|note) and title.',
  addedTray: (id, tray) => `Added [${id}] to the "${tray}" tab: the person decides whether to take it into work.`,
  addedUnder: (id, parent) => `Added [${id}] under "${parent}".`,
  addedRoot: id => `Added [${id}] at the top of the map.`,
  noNode: id => `No node [${id}]. Call action "list" to see the ids.`,
  updatedAsk: id => `Updated [${id}]; the status change or chosen option awaits the person's confirmation on the node's card.`,
  updated: id => `Updated [${id}].`,
  toolFailed: 'The project tree did not answer: the mod failed.',
  andMore: n => `and ${n} more`,
  waitingNow: "Awaiting the person's decision:",
  briefHead: name => `Tree "${name}": where things stand`,
  briefRecent: 'Latest steps:',
  briefDoing: 'In progress:',
  briefOpen: n => `Open tasks (${n}):`,
  briefTray: (label, n) => `${label} (${n}):`,
  briefParked: 'Parked:',
  briefStale: 'Untouched for a while:',
  briefAsk: 'Retell it to the person briefly and suggest where to pick up.',
  removed: title => `Removed "${title}". It is in History; the person can put it back.`,
  clearedTitle: (tab, n) => `Cleared the "${tab}" tab (${n})`,
  cleared: (tab, n) => `The "${tab}" tab is cleared, removed: ${n}. All of it is in History; the person can put it back.`,
  nothingToClear: tab => `The "${tab}" tab is already empty.`,
  needTarget: 'Needs a node id or a tray (questions|ideas|findings).',
  byRequest: 'Asked for in chat.',

  notSaved: (file, error) => `The tree was not saved to ${file}: ${error}`,
  restoredTo: (title, place) => `Put "${title}" back ${place}`,
  toTab: tab => `on the "${tab}" tab`,
  toMap: path => `on the Map${path ? `, branch "${path}"` : ''}`,
  promptBusy: 'Could not fill the prompt box: a dialog has it now.',
  otherSession: (when, excerpt) => `A message from another session (${when}): "${excerpt}"`,
  noScroll: reason => `Could not scroll to the message: ${reason}`,
  command: 'Project tree: open the pane, /tree brief for where things stand, or add a node (/tree ? question)',
  paneOpened: 'The tree pane is open.',
  addedByCommand: (kind, title) => `Added to the tree: ${kind} "${title}".`,
  notUnderstood: hint => `Could not tell what to add. ${hint}`,

  proposalStatus: status => `status → ${status}`,
  proposalChoose: option => `choose "${option}"`,
  accept: 'Accept',
  reject: 'Reject',
  why: 'Why remove it?',
  whyHint: 'the reason goes into history',
  removeVerb: 'remove',
  eraseNoTrace: 'Delete without a trace',
  cancel: 'Cancel',
  more: n => ` · ▸ ${n} more`,
  subtasks: (done, total) => ` · subtasks ${done} of ${total}`,
  untouched: age => ` · untouched ${age}`,
  lyingLong: age => `waiting long: ${age}`,
  done: '✓ Done',
  reply: '↪ Reply',
  discuss: '↪ Discuss',
  toWork: '● Start',
  park: '⏸ Park',
  resume: '▶ Resume',
  toRoot: '— top level —',
  fromClaudeNoBranch: 'task from Claude, no branch',
  fromClaude: 'from Claude',
  yours: 'yours',
  takeIntoWork: '→ Into work:',
  answered: '✓ Answered',
  notNeeded: '✕ Not needed',
  restore: '↩ Put back',
  mapTab: 'Map',
  historyTab: 'History',
  emptyMapHint: hint => `Empty. Add the first branch below, e.g. "# Project name".\n${hint}`,
  emptyHistory: 'Key steps show up here: closed tasks, decisions made, things removed with a reason.',
  addedByClaude: 'added by Claude',
  addedByYou: 'added by you',
  fromMessage: (when, excerpt) => `From the message of ${when}: "${excerpt}"`,
  jump: '↩ To the message in chat',
  unanchored: 'Not tied to a chat message.',
  anchorTo: excerpt => `📌 Tie to "${excerpt}"`,
  moveTo: 'Move to:',
  parkPlain: 'Park',
  treeLabel: 'Tree:',
  newTreeOption: '＋ New tree',
  addInto: (title, hint) => `in "${title}": ${hint}`,
  addVerb: 'add',
}

export const STRINGS: Record<Lang, Strings> = { ru, en }

let current: Lang = 'ru'

export function setLang(lang: Lang): void {
  current = lang
}

export function lang(): Lang {
  return current
}

// The strings of the language the pane speaks now.
export function t(): Strings {
  return STRINGS[current]
}

export function isLang(value: unknown): value is Lang {
  return value === 'ru' || value === 'en'
}

// The language a message is written in, or null when it does not say: any
// Cyrillic word makes it Russian; English takes a few Latin words and no
// Cyrillic, so a lone "ok" or a command leaves the language as it was.
export function langOf(text: string): Lang | null {
  if (/[Ѐ-ӿ]{2,}/.test(text)) return 'ru'
  const words = text.match(/\b[A-Za-z]{2,}\b/g) ?? []

  return words.length >= 3 ? 'en' : null
}

// Before the person has written anything: the system's language.
export function systemLang(): Lang {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('ru') ? 'ru' : 'en'
  } catch {
    return 'en'
  }
}

// The main tree's name as stored, shown in the pane's language: a name the
// mod gave it in some language reads as today's one; a name the person gave stays.
export function shownName(id: string, name: string): string {
  if (id !== '') return name
  const isDefault = name === '' || Object.values(STRINGS).some(one => one.mainTree === name)

  return isDefault ? t().mainTree : name
}
