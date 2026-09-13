import { useMemo, useState, type ReactNode } from 'react'
import type { ITask } from '@svar-ui/react-gantt'
import { ChevronDown, ChevronRight, Minus, Plus, TriangleAlert } from 'lucide-react'
import type { GanttResource } from '@/types/gantt'
import type { ProjectCalendarConfig } from '@/lib/scheduler'
import {
  buildUsageModel,
  markResourceOverallocation,
  type ResourceGroupBy,
  type TaskGroupBy,
  type UsageGridRow,
  type UsageModel,
  type UsageMode,
  type UsageTimescale,
} from '@/lib/usage-model'
import type { ZoomMode } from '@/components/gantt/gantt-ribbon'

const hierarchyWidth = 330
const workWidth = 110
const minCellWidth = 88
const maxCellWidth = 220
const initialCellWidth = 118

type UsageShellProps = {
  title: string
  description: string
  children: ReactNode
}

function formatWork(hours: number): string {
  return `${hours.toLocaleString(undefined, { maximumFractionDigits: 2 })}h`
}

function zoomTimescale(zoom: ZoomMode): UsageTimescale {
  return zoom === 'week' || zoom === 'month' ? zoom : 'day'
}

function UsageShell({ title, description, children }: UsageShellProps) {
  return (
    <section aria-labelledby={`${title.toLowerCase().replaceAll(' ', '-')}-heading`} className="flex h-full min-h-0 flex-col bg-background p-5">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col">
        <div className="mb-4 shrink-0">
          <h1 id={`${title.toLowerCase().replaceAll(' ', '-')}-heading`} className="text-lg font-semibold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </section>
  )
}

function flattenRows(rows: UsageGridRow[], expanded: Set<string>, depth = 0): Array<{ row: UsageGridRow; depth: number }> {
  return rows.flatMap((row) => [
    { row, depth },
    ...(row.children.length > 0 && expanded.has(row.id) ? flattenRows(row.children, expanded, depth + 1) : []),
  ])
}

function collectParentIds(rows: UsageGridRow[], target: Set<string>): Set<string> {
  for (const row of rows) {
    if (row.kind === 'parent') target.add(row.id)
    if (row.children.length > 0) collectParentIds(row.children, target)
  }
  return target
}

function groupOptions(mode: UsageMode): Array<{ value: ResourceGroupBy | TaskGroupBy; label: string }> {
  return mode === 'resource'
    ? [{ value: 'resource', label: 'Resource' }]
    : [{ value: 'task', label: 'Task' }, { value: 'phase', label: 'Phase' }]
}

function UsageGrid({
  model,
  mode,
  expanded,
  onToggle,
  cellWidth,
}: {
  model: UsageModel
  mode: UsageMode
  expanded: Set<string>
  onToggle: (id: string) => void
  cellWidth: number
}) {
  const visibleRows = flattenRows(model.rows, expanded)
  const gridTemplateColumns = `${hierarchyWidth}px ${workWidth}px repeat(${Math.max(model.periods.length, 1)}, ${cellWidth}px)`
  const gridMinWidth = hierarchyWidth + workWidth + Math.max(model.periods.length, 1) * cellWidth
  const totalPeriodWork = model.periods.map((period) => model.rows.reduce((sum, row) => sum + (row.periodWork[period.key] ?? 0), 0))
  const columnLabel = mode === 'resource' ? 'Resource / Task' : 'Task / Resource'

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card shadow-xs" aria-label={`${mode === 'resource' ? 'Resource' : 'Task'} usage grid`}>
      <div className="min-h-full" style={{ minWidth: gridMinWidth }}>
        <div className="sticky top-0 z-20 grid border-b border-border bg-muted/95 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur" style={{ gridTemplateColumns }}>
          <div className="sticky left-0 z-30 border-r border-border bg-muted/95 px-4 py-3">{columnLabel}</div>
          <div className="sticky z-30 border-r border-border bg-muted/95 px-3 py-3 text-right" style={{ left: hierarchyWidth }}>Work</div>
          {model.periods.length > 0 ? model.periods.map((period) => <div key={period.key} className="border-r border-border px-2 py-3 text-center">{period.label}</div>) : <div className="border-r border-border px-2 py-3 text-center">No scheduled periods</div>}
        </div>

        {visibleRows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">No usage rows match the current filter.</div>
        ) : visibleRows.map(({ row, depth }) => {
          const isParent = row.kind === 'parent'
          const isExpanded = expanded.has(row.id)
          return (
            <div key={row.id} className="group grid min-h-11 border-b border-border/80 last:border-b-0" style={{ gridTemplateColumns }}>
              <div className={`sticky left-0 z-10 flex min-w-0 items-center border-r border-border px-4 py-2 transition-colors ${isParent ? 'bg-amber-100 dark:bg-amber-950/50 group-hover:bg-amber-200 dark:group-hover:bg-amber-900/60 font-medium' : 'bg-card group-hover:bg-muted text-sm'}`}>
                <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 20 }}>
                  {isParent ? <button type="button" onClick={() => onToggle(row.id)} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.label}`} aria-expanded={isExpanded} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button> : <span className="h-5 w-5 shrink-0" />}
                  <span className="truncate text-foreground">{row.label}</span>
                  {row.secondaryLabel && <span className="truncate text-xs text-muted-foreground">({row.secondaryLabel})</span>}
                  {mode === 'resource' && row.overallocatedPeriods.length > 0 && <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Over-allocated" />}
                </div>
              </div>
              <div className={`sticky z-10 border-r border-border px-3 py-2 text-right tabular-nums transition-colors ${isParent ? 'bg-amber-100 dark:bg-amber-950/50 group-hover:bg-amber-200 dark:group-hover:bg-amber-900/60 font-semibold' : 'bg-card group-hover:bg-muted text-sm'}`} style={{ left: hierarchyWidth }}>{formatWork(row.totalWork)}</div>
              {model.periods.length > 0 ? model.periods.map((period) => {
                const work = row.periodWork[period.key] ?? 0
                const overallocated = mode === 'resource' && row.overallocatedPeriods.includes(period.key)
                const peak = row.peakDayByPeriod[period.key]
                const tooltip = overallocated && peak
                  ? `Contains an overallocated day (${peak.date}): ${formatWork(peak.dailyWork)} work vs ${formatWork(peak.dailyCapacity)} capacity${peak.resourceLabel ? ` on ${peak.resourceLabel}` : ''}`
                  : undefined
                return <div key={`${row.id}-${period.key}`} className={`border-r border-border px-2 py-2 text-center text-sm tabular-nums transition-colors ${overallocated ? 'bg-destructive/10 text-destructive font-semibold group-hover:bg-destructive/20' : isParent ? 'bg-amber-100 dark:bg-amber-950/50 text-foreground group-hover:bg-amber-200 dark:group-hover:bg-amber-900/60' : 'bg-card text-foreground group-hover:bg-muted'}`} title={tooltip}>{formatWork(work)}{overallocated && <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white" aria-label="Over-allocation">!</span>}</div>
              }) : <div className={`border-r border-border px-2 py-2 text-center text-sm text-muted-foreground transition-colors ${isParent ? 'bg-amber-100 dark:bg-amber-950/50 group-hover:bg-amber-200 dark:group-hover:bg-amber-900/60' : 'bg-card group-hover:bg-muted'}`}>—</div>}
            </div>
          )
        })}

        <div className="sticky bottom-0 z-20 grid border-t-2 border-primary/30 bg-muted/95 font-semibold text-foreground backdrop-blur" style={{ gridTemplateColumns }}>
          <div className="sticky left-0 z-30 border-r border-border bg-muted/95 px-4 py-3">Total Work</div>
          <div className="sticky z-30 border-r border-border bg-muted/95 px-3 py-3 text-right tabular-nums" style={{ left: hierarchyWidth }}>{formatWork(model.totalWork)}</div>
          {model.periods.length > 0 ? totalPeriodWork.map((work, index) => <div key={model.periods[index].key} className="border-r border-border px-2 py-3 text-center text-sm tabular-nums">{formatWork(work)}</div>) : <div className="border-r border-border px-2 py-3 text-center text-sm text-muted-foreground">—</div>}
        </div>
      </div>
    </div>
  )
}

function UsageView({
  mode,
  title,
  description,
  tasks,
  resources,
  calendar,
  durationUnit,
  zoom,
  onTimescaleChange,
}: {
  mode: UsageMode
  title: string
  description: string
  tasks: ITask[]
  resources: GanttResource[]
  calendar: ProjectCalendarConfig
  durationUnit: 'day' | 'hour'
  zoom: ZoomMode
  onTimescaleChange: (timescale: UsageTimescale) => void
}) {
  const timescale = zoomTimescale(zoom)
  const [filter, setFilter] = useState('')
  const [cellWidth, setCellWidth] = useState(initialCellWidth)
  const [groupByByMode, setGroupByByMode] = useState<{ resource: ResourceGroupBy; task: TaskGroupBy }>({ resource: 'resource', task: 'task' })
  const groupBy = groupByByMode[mode]

  const model = useMemo(() => markResourceOverallocation(buildUsageModel({ mode, tasks, resources, calendar, durationUnit, timescale, filter, groupBy }), calendar), [calendar, durationUnit, filter, groupBy, mode, resources, tasks, timescale])
  const [expanded, setExpanded] = useState<Set<string>>(() => collectParentIds(model.rows, new Set()))
  const options = groupOptions(mode)

  const toggleRow = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <UsageShell title={title} description={description}>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-xs">
          <div className="flex items-center gap-1.5"><span className="text-xs font-medium text-muted-foreground">Timescale</span><div className="flex rounded-md border border-border bg-muted/40 p-0.5">{(['day', 'week', 'month'] as UsageTimescale[]).map((value) => <button key={value} type="button" onClick={() => onTimescaleChange(value)} aria-pressed={timescale === value} className={`rounded px-2.5 py-1 text-xs capitalize ${timescale === value ? 'bg-background font-semibold text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}>{value}</button>)}</div></div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">Filter<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={mode === 'resource' ? 'Resources or tasks' : 'Tasks or resources'} aria-label="Filter usage rows" className="h-7 w-44 rounded-md border border-border bg-background px-2 text-xs font-normal text-foreground outline-none focus:border-primary" /></label>
          {options.length > 1 && <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">Group By<select value={groupBy} onChange={(event) => setGroupByByMode((current) => mode === 'resource' ? { ...current, resource: event.target.value as ResourceGroupBy } : { ...current, task: event.target.value as TaskGroupBy })} aria-label="Group usage rows" className="h-7 rounded-md border border-border bg-background px-2 text-xs font-normal text-foreground outline-none focus:border-primary">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          <div className="ml-auto flex items-center gap-1"><span className="mr-1 text-xs text-muted-foreground">Zoom</span><button type="button" onClick={() => setCellWidth((width) => Math.max(minCellWidth, width - 16))} disabled={cellWidth <= minCellWidth} aria-label="Zoom out timeline" className="rounded border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button><button type="button" onClick={() => setCellWidth((width) => Math.min(maxCellWidth, width + 16))} disabled={cellWidth >= maxCellWidth} aria-label="Zoom in timeline" className="rounded border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button></div>
        </div>
        <UsageGrid model={model} mode={mode} expanded={expanded} onToggle={toggleRow} cellWidth={cellWidth} />
      </div>
    </UsageShell>
  )
}

export function ResourceUsageView({ tasks, resources, calendar, durationUnit, zoom, onTimescaleChange }: { tasks: ITask[]; resources: GanttResource[]; calendar: ProjectCalendarConfig; durationUnit: 'day' | 'hour'; zoom: ZoomMode; onTimescaleChange: (timescale: UsageTimescale) => void }) {
  return <UsageView mode="resource" title="Resource Usage" description="Review planned work by resource and task, with calendar capacity indicators across the schedule." tasks={tasks} resources={resources} calendar={calendar} durationUnit={durationUnit} zoom={zoom} onTimescaleChange={onTimescaleChange} />
}

export function TaskUsageView({ tasks, resources, calendar, durationUnit, zoom, onTimescaleChange }: { tasks: ITask[]; resources: GanttResource[]; calendar: ProjectCalendarConfig; durationUnit: 'day' | 'hour'; zoom: ZoomMode; onTimescaleChange: (timescale: UsageTimescale) => void }) {
  return <UsageView mode="task" title="Task Usage" description="Review planned work by task and its resource assignments across the schedule." tasks={tasks} resources={resources} calendar={calendar} durationUnit={durationUnit} zoom={zoom} onTimescaleChange={onTimescaleChange} />
}
