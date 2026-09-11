export type GanttTask = {
  id: number
  text: string
  start: Date
  end?: Date
  duration: number
  progress: number
  type: "task" | "summary" | "milestone"
  parent?: number
  open?: boolean
  resources?: number[]
}

export type GanttLink = {
  id: number
  source: number
  target: number
  type: "e2s" | "s2s" | "e2e" | "s2e"
}

export type GanttResource = {
  id: number
  label: string
  role?: string
  avatar?: string
}
