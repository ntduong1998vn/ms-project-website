import type { CsvTaskField, CsvTaskMapping } from '@/types/gantt-csv'

export const csvTaskFields = [
  { key: 'id', label: 'Task ID', required: false },
  { key: 'text', label: 'Task name / text', required: true },
  { key: 'start', label: 'Start date', required: false },
  { key: 'end', label: 'Finish / end date', required: false },
  { key: 'duration', label: 'Duration', required: false },
  { key: 'type', label: 'Task type', required: false },
  { key: 'progress', label: 'Progress', required: false },
  { key: 'parent', label: 'Parent task ID', required: false },
  { key: 'resources', label: 'Resource Names', required: false },
  { key: 'predecessors', label: 'Predecessor task IDs', required: false },
  { key: 'predecessorTypes', label: 'Dependency types', required: false },
] as const

export const csvFieldAliases: Record<CsvTaskField, string[]> = {
  id: ['id', 'taskid', 'tasknumber', 'number'],
  text: ['text', 'name', 'taskname', 'task', 'title', 'description'],
  start: ['start', 'startdate', 'begin', 'begindate'],
  end: ['end', 'enddate', 'finish', 'finishdate', 'duedate'],
  duration: ['duration', 'days', 'hours'],
  type: ['type', 'tasktype'],
  progress: ['progress', 'percentcomplete', 'percentdone', 'complete'],
  parent: ['parent', 'parentid', 'parenttask', 'parenttaskid'],
  resources: ['resources', 'resource', 'resourcenames', 'resourcename', 'resourceids', 'resourceid'],
  predecessors: ['predecessors', 'predecessor', 'predecessorids', 'predecessorid', 'depends', 'dependencies'],
  predecessorTypes: ['predecessortypes', 'predecessortype', 'dependencytypes', 'dependencytype', 'linktypes', 'linktype'],
}

export function initialCsvMapping(headers: string[]): CsvTaskMapping {
  const normalized = headers.map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const mapping = {} as CsvTaskMapping
  for (const field of csvTaskFields) {
    const candidates = csvFieldAliases[field.key]
    const index = normalized.findIndex((header) => candidates.includes(header))
    mapping[field.key] = index >= 0 ? index : null
  }
  return mapping
}
