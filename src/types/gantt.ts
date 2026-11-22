import type { ITask } from '@svar-ui/react-gantt'

export type TaskWithResources = ITask & {
  id: NonNullable<ITask['id']>
  text: NonNullable<ITask['text']>
  resources?: number[]
  externalSource?: string   // provider id, e.g. 'redmine'
  externalKey?: string      // remote issue id/key, e.g. '1234'
  externalSync?: { updatedOn?: string; base: Record<string, unknown> }
}

export type GanttResource = {
  id: number
  label: string
  avatar?: string
  externalSource?: string
  externalKey?: string      // remote user id
}
