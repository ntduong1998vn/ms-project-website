import type { ILink, ITask } from '@svar-ui/react-gantt'
import type { GanttResource } from '@/types/gantt'
import type { ViewMode, ZoomMode } from '@/components/gantt/gantt-ribbon'
import type { ProjectCalendarConfig } from '@/lib/scheduler'
import { idbGet, idbSet } from '@/lib/storage/idb'

export interface PersistedProject {
  v: 1
  tasks: ITask[]
  links: ILink[]
  resourceList: GanttResource[]
}

export interface PersistedSettings {
  v: 1
  calendarConfig: ProjectCalendarConfig
  isAutoSchedule: boolean
  durationUnit: 'day' | 'hour'
  zoom: ZoomMode
  viewMode: ViewMode
  isWorkColumnVisible: boolean
  visibleRemoteColumns: string[]
  showCriticalPath: boolean
  isGanttVisible: boolean
}

function isPersistedProject(value: unknown): value is PersistedProject {
  if (typeof value !== 'object' || value === null) return false
  const p = value as PersistedProject
  return p.v === 1 && Array.isArray(p.tasks) && Array.isArray(p.links) && Array.isArray(p.resourceList)
}

function isPersistedSettings(value: unknown): value is PersistedSettings {
  if (typeof value !== 'object' || value === null) return false
  const s = value as PersistedSettings
  return s.v === 1 && typeof s.calendarConfig === 'object' && s.calendarConfig !== null
}

export async function loadPersistedState(): Promise<{
  project?: PersistedProject
  settings?: PersistedSettings
}> {
  const [project, settings] = await Promise.all([
    idbGet<unknown>('project'),
    idbGet<unknown>('settings'),
  ])
  return {
    project: isPersistedProject(project) ? project : undefined,
    settings: isPersistedSettings(settings) ? settings : undefined,
  }
}

// Fire-and-forget writes: persistence failures (quota, private mode) must not
// break editing, so errors are only logged.
export function persistProject(p: Omit<PersistedProject, 'v'>): void {
  idbSet('project', { v: 1, ...p }).catch((err) => console.warn('persistProject failed', err))
}

export function persistSettings(s: Omit<PersistedSettings, 'v'>): void {
  idbSet('settings', { v: 1, ...s }).catch((err) => console.warn('persistSettings failed', err))
}
