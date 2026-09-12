import type { ITask } from '@svar-ui/react-gantt'

export type TaskWithResources = ITask & {
  id: NonNullable<ITask['id']>
  text: NonNullable<ITask['text']>
  resources?: number[]
}

export type GanttResource = {
  id: number
  label: string
  role?: string
  avatar?: string
}
