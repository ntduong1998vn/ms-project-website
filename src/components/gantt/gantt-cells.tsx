import { useState } from 'react'
import type { ILink } from '@svar-ui/react-gantt'
import { Plus, TriangleAlert } from 'lucide-react'
import type { GanttResource, TaskWithResources } from '@/types/gantt'
import { exclusiveEndToInclusiveFinish } from '@/lib/scheduler'
import type { ResourceEffortWarning } from '@/lib/resource-effort'

function formatDate(date: Date | string | undefined | null): string {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })
}

export function PredecessorCell({ row, links }: { row: TaskWithResources; links: ILink[] }) {
  const incoming = links.filter((l) => String(l.target) === String(row.id))
  if (incoming.length === 0) {
    return <span style={{ color: '#9ca3af' }}>-</span>
  }
  const text = incoming.map((l) => `${l.source}`).join(', ')
  return (
    <span style={{ fontWeight: 500, fontFamily: 'monospace', fontSize: '0.82rem' }}>
      {text}
    </span>
  )
}

export function ResourceNamesCell({ row, resources }: { row: TaskWithResources; resources: GanttResource[] }) {
  if (!row.resources || !Array.isArray(row.resources) || row.resources.length === 0) {
    return <span style={{ color: '#9ca3af' }}>-</span>
  }
  const names = row.resources
    .map((id: number) => resources.find((r) => r.id === id)?.label)
    .filter(Boolean)
    .join(', ')
  return (
    <span style={{ fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {names || '-'}
    </span>
  )
}

export function WorkCell({
  row,
  workingHoursPerDay,
  durationUnit,
}: {
  row: TaskWithResources
  workingHoursPerDay: number
  durationUnit: 'day' | 'hour'
}) {
  const duration = Number(row.duration)
  const workHours =
    Number.isFinite(duration) && duration >= 0
      ? durationUnit === 'day'
        ? duration * workingHoursPerDay
        : duration
      : 0
  return (
    <span className="px-1 text-xs tabular-nums text-foreground/80">
      {Number.isInteger(workHours) ? workHours : workHours.toFixed(2)}h
    </span>
  )
}

function formatEffortHours(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(2)}h`
}

export function EffortWarningCell({
  row,
  warningsByTask,
}: {
  row: TaskWithResources
  warningsByTask: Map<string, ResourceEffortWarning[]>
}) {
  const warnings = warningsByTask.get(String(row.id)) ?? []
  if (warnings.length === 0) {
    return <span aria-label="No effort overlap" style={{ color: '#9ca3af' }}>-</span>
  }

  const details = warnings
    .map((warning) => {
      const taskDetails = warning.tasks
        .map((task) => `${task.text} (#${task.id}, ${formatEffortHours(task.hours)})`)
        .join(', ')
      return `${warning.resourceLabel} on ${warning.date}: ${formatEffortHours(warning.totalHours)} assigned (${taskDetails}); limit ${formatEffortHours(warning.capacityHours)}/day`
    })
    .join(' | ')

  return (
    <span
      role="img"
      aria-label={`Effort overlap warning: ${details}`}
      title={details}
      className="inline-flex items-center justify-center text-destructive"
    >
      <TriangleAlert className="h-4 w-4" aria-hidden="true" />
    </span>
  )
}

export function AddColumnHeaderCell({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Add a Gantt column"
      title="Add a Gantt column"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen()
      }}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
}

export function AddTaskCell({ row }: { row: TaskWithResources }) {
  if (row.type === 'milestone') return null

  return (
    <div style={{ textAlign: 'center' }}>
      <i className="wx-9DAESAHW wx-action-icon wxi-plus" data-action="add-task" />
    </div>
  )
}

function toDateInputValue(date: Date | string | undefined | null): string {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInput(val: string): Date | null {
  if (!val) return null
  const [y, m, d] = val.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

export function DurationCell({
  row,
  onDurationChange,
  onSelect,
}: {
  row: TaskWithResources
  onDurationChange: (id: string | number, duration: number) => void
  onSelect?: (id: string | number) => void
}) {
  const isSummary = row.type === 'summary'
  const isMilestone = row.type === 'milestone'

  if (isSummary || isMilestone) {
    return (
      <span className="text-xs font-semibold text-foreground/80 tabular-nums px-1">
        {row.duration ?? 0}
      </span>
    )
  }

  return (
    <EditableDurationInput
      rowId={row.id}
      taskText={row.text}
      duration={row.duration ?? 0}
      onDurationChange={onDurationChange}
      onSelect={onSelect}
    />
  )
}

export function EditableDurationInput({
  rowId,
  taskText,
  duration,
  onDurationChange,
  onSelect,
}: {
  rowId: string | number
  taskText: string
  duration: number
  onDurationChange: (id: string | number, duration: number) => void
  onSelect?: (id: string | number) => void
}) {
  const [val, setVal] = useState<string>(String(duration))
  const [prevDuration, setPrevDuration] = useState<number>(duration)

  if (duration !== prevDuration) {
    setPrevDuration(duration)
    setVal(String(duration))
  }

  const handleCommit = () => {
    const parsed = parseFloat(val)
    if (!isNaN(parsed) && parsed >= 0) {
      if (parsed !== duration) {
        onDurationChange(rowId, parsed)
      }
    } else {
      setVal(String(duration))
    }
  }

  return (
    <div
      className="group relative flex items-center justify-center w-full h-full px-0.5"
      onClick={() => onSelect?.(rowId)}
    >
      <input
        type="number"
        min={0}
        step="any"
        value={val}
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.(rowId)
        }}
        onChange={(e) => setVal(e.target.value)}
        onBlur={handleCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setVal(String(duration))
            e.currentTarget.blur()
          }
        }}
        aria-label={`Duration for task ${taskText}`}
        className="w-full text-center text-xs font-medium text-foreground bg-transparent border border-transparent hover:border-border hover:bg-muted/40 focus:border-primary focus:bg-background rounded px-1 py-0.5 cursor-pointer outline-none transition-colors tabular-nums"
      />
    </div>
  )
}

export function StartDateCell({
  row,
  onDateChange,
  onSelect,
}: {
  row: TaskWithResources
  onDateChange: (id: string | number, date: Date) => void
  onSelect?: (id: string | number) => void
}) {
  const isSummary = row.type === 'summary'
  const dateStr = formatDate(row.start)
  const inputVal = toDateInputValue(row.start)

  if (isSummary) {
    return <span className="text-xs font-semibold text-foreground/80 tabular-nums px-1">{dateStr}</span>
  }

  return (
    <div className="group relative flex items-center justify-center w-full h-full px-0.5" onClick={() => onSelect?.(row.id)}>
      <input
        type="date"
        value={inputVal}
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.(row.id)
          try {
            e.currentTarget.showPicker?.()
          } catch {
            // fallback
          }
        }}
        onChange={(e) => {
          const parsed = parseDateInput(e.target.value)
          if (parsed) onDateChange(row.id, parsed)
        }}
        aria-label={`Start date for task ${row.text}`}
        className="w-full text-center text-xs font-medium text-foreground bg-transparent border border-transparent hover:border-border hover:bg-muted/40 focus:border-primary focus:bg-background rounded px-1 py-0.5 cursor-pointer outline-none transition-colors tabular-nums"
      />
    </div>
  )
}

export function FinishDateCell({
  row,
  onDateChange,
  onSelect,
}: {
  row: TaskWithResources
  onDateChange: (id: string | number, date: Date) => void
  onSelect?: (id: string | number) => void
}) {
  const isSummary = row.type === 'summary'
  const isMilestone = row.type === 'milestone'
  // task.end is exclusive — subtract 1 day to get the inclusive finish for display/edit (for milestone, finish == start)
  const inclusiveFinish = isMilestone
    ? (row.start ? new Date(row.start) : null)
    : row.end
      ? exclusiveEndToInclusiveFinish(new Date(row.end))
      : null
  const dateStr = formatDate(inclusiveFinish)
  const inputVal = toDateInputValue(inclusiveFinish)
  if (isSummary) {
    return <span className="text-xs font-semibold text-foreground/80 tabular-nums px-1">{dateStr}</span>
  }

  return (
    <div className="group relative flex items-center justify-center w-full h-full px-0.5" onClick={() => onSelect?.(row.id)}>
      <input
        type="date"
        value={inputVal}
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.(row.id)
          try {
            e.currentTarget.showPicker?.()
          } catch {
            // fallback
          }
        }}
        onChange={(e) => {
          const parsed = parseDateInput(e.target.value)
          if (parsed) {
            // parsed is the inclusive finish the user chose; pass it as-is.
            // handleFinishDateChange converts it to exclusive via inclusiveFinishToExclusiveEnd.
            onDateChange(row.id, parsed)
          }
        }}
        aria-label={`Finish date for task ${row.text}`}
        className="w-full text-center text-xs font-medium text-foreground bg-transparent border border-transparent hover:border-border hover:bg-muted/40 focus:border-primary focus:bg-background rounded px-1 py-0.5 cursor-pointer outline-none transition-colors tabular-nums"
      />
    </div>
  )
}
