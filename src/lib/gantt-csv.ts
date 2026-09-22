import type { ILink, ITask } from '@svar-ui/react-gantt'
import type { CsvImportData, CsvTaskMapping } from '@/types/gantt-csv'
import type { GanttResource, TaskWithResources } from '@/types/gantt'
import { autoScheduleTasks, calculateEndDate, clampImportedDuration, formatToDateString, getNextWorkingDay, isSchedulableEnd, type ProjectCalendarConfig } from '@/lib/scheduler'
import { hasParentCycle, sameTaskId, toPositiveNumericTaskId } from '@/lib/task-helpers'
import { serializeCsv } from '@/lib/csv'

type DependencyType = ILink['type']

export function csvValue(row: string[], mapping: CsvTaskMapping, field: keyof CsvTaskMapping): string {
  const column = mapping[field]
  return column === null ? '' : (row[column] ?? '').trim()
}

export function parseCsvDateValue(value: string): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : undefined
}

export function parseCsvResourceTokens(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []
  if (/[;|]/.test(trimmed)) return trimmed.split(/[;|]+/).map((item) => item.trim()).filter(Boolean)
  const commaParts = trimmed.split(',').map((item) => item.trim()).filter(Boolean)
  return commaParts.length > 1 && commaParts.every((item) => /^\d+$/.test(item)) ? commaParts : [trimmed]
}

export function parseCsvDependencyType(value: string): DependencyType {
  const normalized = value.trim().toLowerCase()
  if (normalized === 's2s' || normalized === 'ss') return 's2s'
  if (normalized === 'e2e' || normalized === 'ff') return 'e2e'
  if (normalized === 's2e' || normalized === 'sf') return 's2e'
  return 'e2s'
}

function parseCsvTaskId(value: string, fallback: number, usedIds: Set<string>): string | number {
  const numeric = toPositiveNumericTaskId(value)
  if (numeric !== null && !usedIds.has(String(numeric))) { usedIds.add(String(numeric)); return numeric }
  const text = value.trim()
  if (text && !usedIds.has(text)) { usedIds.add(text); return text }
  let nextId = fallback
  while (usedIds.has(String(nextId))) nextId += 1
  usedIds.add(String(nextId))
  return nextId
}

export function serializeGanttCsv(tasks: ITask[], links: ILink[], resources: GanttResource[]): string {
  const headers = ['id', 'text', 'start', 'end', 'duration', 'type', 'progress', 'parent', 'resourceNames', 'predecessors', 'predecessorTypes']
  const rows = tasks.map((task) => {
    const incoming = links.filter((link) => String(link.target) === String(task.id))
    const taskResources = (task as TaskWithResources).resources ?? []
    return [task.id, task.text, task.start ? formatToDateString(new Date(task.start)) : '', task.end ? formatToDateString(new Date(task.end)) : '', task.duration ?? '', task.type ?? 'task', task.progress ?? '', task.parent ?? '', taskResources.map((id) => resources.find((resource) => resource.id === id)?.label ?? String(id)).join(';'), incoming.map((link) => link.source).join(';'), incoming.map((link) => link.type).join(';')]
  })
  return serializeCsv(headers, rows)
}

export type GanttCsvImportResult =
  | { kind: 'success'; tasks: ITask[]; links: ILink[]; resources: GanttResource[] }
  | { kind: 'no-importable-rows' }

export function importGanttCsv(data: CsvImportData, mapping: CsvTaskMapping, calendarConfig: ProjectCalendarConfig, durationUnit: 'day' | 'hour', isAutoSchedule: boolean, resourceList: GanttResource[]): GanttCsvImportResult {
  const rows = data.rows.filter((row) => row.some((cell) => cell.trim() !== ''))
  const usableRows = mapping.text === null ? rows : rows.filter((row) => csvValue(row, mapping, 'text') !== '')
  if (usableRows.length === 0) return { kind: 'no-importable-rows' }
  const usedIds = new Set<string>()
  const rawIdMap = new Map<string, string | number>()
  const entries = usableRows.map((row, index) => {
    const rawId = csvValue(row, mapping, 'id')
    const id = parseCsvTaskId(rawId, index + 1, usedIds)
    if (rawId && !rawIdMap.has(rawId)) rawIdMap.set(rawId, id)
    if (!rawId && !rawIdMap.has(String(index + 1))) rawIdMap.set(String(index + 1), id)
    if (!rawIdMap.has(String(id))) rawIdMap.set(String(id), id)
    return { row, id }
  })
  const importedTypes = new Map<string, ITask['type']>()
  for (const entry of entries) {
    const typeValue = csvValue(entry.row, mapping, 'type').toLowerCase()
    importedTypes.set(String(entry.id), typeValue === 'summary' || typeValue === 'milestone' ? typeValue : 'task')
  }
  const parents = new Map<string, string | number>()
  for (const entry of entries) {
    const rawParent = csvValue(entry.row, mapping, 'parent')
    const parent = rawParent ? rawIdMap.get(rawParent) : undefined
    if (parent !== undefined && importedTypes.get(String(parent)) !== 'milestone' && !sameTaskId(parent, entry.id) && !hasParentCycle(entry.id, parent, parents)) parents.set(String(entry.id), parent)
  }
  // Only rows that actually have children may be marked open: SVAR's tree walk
  // recurses into `data` whenever `open === true`, and a childless summary has
  // `data === null`, which throws and takes the whole view down.
  const parentIds = new Set(Array.from(parents.values(), (parent) => String(parent)))
  const nextResources = [...resourceList]
  const resourceIdsByName = new Map<string, number>()
  for (const resource of nextResources) {
    const key = resource.label.trim().toLowerCase()
    if (key && !resourceIdsByName.has(key)) resourceIdsByName.set(key, resource.id)
  }
  let nextResourceId = nextResources.reduce((max, resource) => Math.max(max, resource.id), 0) + 1
  const resolveImportedResources = (value: string): number[] => {
    const resolvedIds: number[] = []
    for (const token of parseCsvResourceTokens(value)) {
      const numericId = toPositiveNumericTaskId(token)
      const knownNumericId = numericId !== null && nextResources.some((resource) => resource.id === numericId) ? numericId : undefined
      const existingId = knownNumericId ?? resourceIdsByName.get(token.toLowerCase())
      const resourceId = existingId ?? (() => { const createdId = nextResourceId; nextResourceId += 1; nextResources.push({ id: createdId, label: token }); resourceIdsByName.set(token.toLowerCase(), createdId); return createdId })()
      if (!resolvedIds.includes(resourceId)) resolvedIds.push(resourceId)
    }
    return resolvedIds
  }
  const importedTasks: ITask[] = entries.map(({ row, id }, index) => {
    const typeValue = csvValue(row, mapping, 'type').toLowerCase()
    const type: ITask['type'] = typeValue === 'summary' || typeValue === 'milestone' ? typeValue : 'task'
    const start = parseCsvDateValue(csvValue(row, mapping, 'start')) ?? getNextWorkingDay(new Date(), calendarConfig)
    const parsedDuration = Number(csvValue(row, mapping, 'duration'))
    const duration = type === 'milestone' ? 0 : Number.isFinite(parsedDuration) && parsedDuration >= 0 ? clampImportedDuration(parsedDuration, calendarConfig, durationUnit) : 1
    const parsedEnd = parseCsvDateValue(csvValue(row, mapping, 'end'))
    const end = type === 'milestone' ? start : parsedEnd && parsedEnd.getTime() >= start.getTime() && isSchedulableEnd(start, parsedEnd) ? parsedEnd : calculateEndDate(start, duration, calendarConfig, durationUnit)
    const parsedProgress = Number(csvValue(row, mapping, 'progress'))
    const progress = Number.isFinite(parsedProgress) ? Math.min(100, Math.max(0, parsedProgress)) : 0
    const resources = resolveImportedResources(csvValue(row, mapping, 'resources'))
    return { id, text: csvValue(row, mapping, 'text') || `Task ${index + 1}`, start, end, duration, progress, type, open: parentIds.has(String(id)), ...(parents.has(String(id)) ? { parent: parents.get(String(id)) } : {}), ...(resources.length > 0 ? { resources } : {}) }
  })
  const importedLinks: ILink[] = []
  const relationshipKeys = new Set<string>()
  for (const { row, id: target } of entries) {
    const predecessorIds = csvValue(row, mapping, 'predecessors').split(/[,;|\s]+/).map((value) => value.trim()).filter(Boolean)
    const predecessorTypes = csvValue(row, mapping, 'predecessorTypes').split(/[,;|\s]+/).map((value) => value.trim()).filter(Boolean)
    predecessorIds.forEach((rawSource, index) => {
      const source = rawIdMap.get(rawSource)
      if (source === undefined || sameTaskId(source, target)) return
      const key = `${String(source)}->${String(target)}`
      if (relationshipKeys.has(key)) return
      relationshipKeys.add(key)
      importedLinks.push({ id: importedLinks.length + 1, source, target, type: parseCsvDependencyType(predecessorTypes[index] ?? 'e2s') })
    })
  }
  const tasks = isAutoSchedule ? autoScheduleTasks(importedTasks, importedLinks, calendarConfig, durationUnit) : importedTasks
  return { kind: 'success', tasks, links: importedLinks, resources: nextResources }
}
