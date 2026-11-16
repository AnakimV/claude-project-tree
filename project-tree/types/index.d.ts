export type NodeKind =
  | 'branch'
  | 'task'
  | 'question'
  | 'decision'
  | 'idea'
  | 'finding'
  | 'note'

export type NodeStatus = 'open' | 'doing' | 'done' | 'parked'

// The chat message a node came from: the person's latest prompt when it was made.
export type Anchor = {
  sessionId: string
  messageId: string
  excerpt: string
  at: number
}

// A change Claude asked for, waiting on the person's yes.
export type Proposal = { status?: NodeStatus; chosen?: string }

export type TreeNode = {
  id: string
  parentId: string | null
  kind: NodeKind
  title: string
  status: NodeStatus
  detail?: string
  options?: string[]
  chosen?: string
  anchor?: Anchor
  source: 'person' | 'claude'
  // A task Claude added with no branch to put it in: it waits on the Ideas tab.
  isInbox: boolean
  proposal?: Proposal
  createdAt: number
  updatedAt: number
}

// The tabs that hold what is not yet work, until it is taken into the map or dropped.
export type Tray = 'questions' | 'ideas' | 'findings'

export type EventKind = 'done' | 'answered' | 'decided' | 'removed' | 'step'

// One important step, as the History tab lists it.
export type HistoryEvent = {
  id: string
  at: number
  kind: EventKind
  title: string
  detail?: string
  // Where in the tree it happened: the branch path, joined.
  branch?: string
  anchor?: Anchor
  // What the step took out of the tree, so it can be put back.
  restore?: TreeNode[]
}

// 'tree', 'graph', 'ready' and 'inbox' are kept only to read a choice stored
// before those views were dropped.
export type Tab = 'map' | Tray | 'history' | 'tree' | 'graph' | 'ready' | 'inbox'

declare module 'claude-code' {
  interface PluginState {
    'project-tree': {
      nodes: Shaped<TreeNode[]>
      events: Shaped<HistoryEvent[]>
      collapsed: string[]
      tab: Tab
      selected: string
      lastPrompt: Anchor | null
      inputSeq: number
      // The node whose removal waits on the person's reason.
      removing: string
      // The tree this session has open, '' for the main one; null until chosen.
      tree: string | null
      // The language the person writes in, which the mod speaks.
      lang: 'ru' | 'en'
    }
  }
}
