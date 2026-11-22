import { useEffect, useRef, useState } from 'react'
import { DropdownMenu } from 'radix-ui'
import type { IApi, IColumnConfig, ITask } from '@svar-ui/react-gantt'
import { Check, ChevronDown, Filter, FilterX, Search, X } from 'lucide-react'

import {
  QUICK_FILTER_COLUMN_ID,
  TASK_FILTER_PRESETS,
  createTaskMatcher,
  describeColumnFilter,
  isColumnFilterActive,
  isQuickFilterActive,
  presetLabel,
  type ColumnFilterValue,
  type QuickFilterValue,
  type TaskFilterPreset,
} from '@/lib/gantt-filters'
import { cn } from '@/lib/utils'

type Props = {
  ganttApi: IApi | null
  columns: IColumnConfig[]
  tasks: ITask[]
}

type FilterValues = Record<string, unknown>

function readFilterValues(api: IApi | null): FilterValues {
  return ((api?.getState() as { filterValues?: FilterValues } | undefined)?.filterValues ?? {}) as FilterValues
}

function columnTitle(column: IColumnConfig | undefined, fallback: string): string {
  const header = (Array.isArray(column?.header) ? column?.header[0] : column?.header) as { text?: string } | undefined
  return header?.text || fallback
}

export function GanttFilterBar({ ganttApi, columns, tasks }: Props) {
  const [filterValues, setFilterValues] = useState<FilterValues>(() => readFilterValues(ganttApi))
  const quick = filterValues[QUICK_FILTER_COLUMN_ID] as QuickFilterValue | undefined
  const [search, setSearch] = useState(quick?.search ?? '')
  const preset: TaskFilterPreset = quick?.preset ?? 'all'

  const appliedRef = useRef(filterValues)

  useEffect(() => {
    if (!ganttApi) return
    const tag = Symbol('gantt-filter-bar')
    ganttApi.on(
      'filter-tasks',
      () => {
        const next = readFilterValues(ganttApi)
        appliedRef.current = next
        setFilterValues(next)
      },
      { tag }
    )
    // Replacing the task data (edits, imports) makes SVAR drop its filters
    // without a filter-tasks event, so re-apply what the user had set.
    const filterStore = ganttApi.getReactiveState().filterValues as unknown as
      | { subscribe: (fn: (values?: FilterValues) => void) => () => void }
      | undefined
    const unsubscribe = filterStore?.subscribe((values) => {
      const kept = appliedRef.current
      if (Object.keys(values ?? {}).length || !Object.values(kept).some((v) => v != null)) return
      queueMicrotask(() => {
        for (const [key, value] of Object.entries(kept)) {
          if (value != null) void ganttApi.exec('filter-tasks', { key, value, open: true })
        }
      })
    })
    return () => {
      ganttApi.detach(tag)
      unsubscribe?.()
    }
  }, [ganttApi])

  function applyQuick(next: QuickFilterValue) {
    void ganttApi?.exec('filter-tasks', {
      key: QUICK_FILTER_COLUMN_ID,
      value: isQuickFilterActive(next) ? next : undefined,
      open: true,
    })
  }

  function updateSearch(value: string) {
    setSearch(value)
    applyQuick({ preset, search: value })
  }

  function updatePreset(value: TaskFilterPreset) {
    applyQuick({ preset: value, search })
  }

  function clearColumn(key: string) {
    void ganttApi?.exec('filter-tasks', { key, value: undefined, open: true })
  }

  function clearAll() {
    appliedRef.current = {}
    setSearch('')
    void ganttApi?.exec('filter-tasks', {})
  }

  const columnChips = Object.entries(filterValues)
    .filter(([key, value]) => key !== QUICK_FILTER_COLUMN_ID && isColumnFilterActive(value as ColumnFilterValue))
    .map(([key, value]) => ({
      key,
      label: describeColumnFilter(
        columnTitle(columns.find((c) => String(c.id) === key), key),
        value as ColumnFilterValue
      ),
    }))

  const isFiltered = isQuickFilterActive(quick) || columnChips.length > 0
  const matcher = createTaskMatcher(filterValues, columns as Parameters<typeof createTaskMatcher>[1])
  // Prop tasks lack computed fields such as `end`; match against the Gantt's own copies.
  const matchCount = isFiltered
    ? tasks.filter((task) => matcher((task.id != null && ganttApi?.getTask(task.id)) || task)).length
    : tasks.length

  return (
    <div
      role="toolbar"
      aria-label="Task filters"
      className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-2 py-1"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          aria-label="Search tasks"
          value={search}
          onChange={(e) => updateSearch(e.target.value)}
          placeholder="Search tasks by name or ID..."
          className="h-7 w-60 rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-primary"
        />
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="Built-in filter"
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors cursor-pointer',
              preset !== 'all'
                ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                : 'border-border bg-background text-foreground hover:bg-muted'
            )}
          >
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              Filter: <strong className="font-semibold">{presetLabel(preset)}</strong>
            </span>
            <ChevronDown className="h-3 w-3 opacity-70" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 min-w-[220px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
          >
            {TASK_FILTER_PRESETS.map((item, index) => (
              <div key={item.id}>
                {index === 1 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
                <DropdownMenu.Item
                  onSelect={() => updatePreset(item.id)}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs outline-none transition-colors hover:bg-muted focus:bg-muted"
                >
                  <span className="flex h-3.5 w-3.5 items-center justify-center">
                    {preset === item.id && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
                  </span>
                  <span className="flex-1">
                    <span className="block font-medium">{item.label}</span>
                    <span className="block text-[10px] text-muted-foreground">{item.description}</span>
                  </span>
                </DropdownMenu.Item>
              </div>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {columnChips.length > 0 && <div className="h-5 w-px bg-border" />}
      {columnChips.map((chip) => (
        <span
          key={chip.key}
          className="flex h-6 items-center gap-1 rounded-full border border-primary/30 bg-primary/5 pl-2.5 pr-1 text-[11px] font-medium text-foreground"
        >
          <span className="max-w-[220px] truncate" title={chip.label}>
            {chip.label}
          </span>
          <button
            type="button"
            aria-label={`Remove filter ${chip.label}`}
            onClick={() => clearColumn(chip.key)}
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}

      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-live="polite">
          {isFiltered ? (
            <>
              <strong className="text-foreground">{matchCount}</strong> of {tasks.length} tasks match
            </>
          ) : (
            <>{tasks.length} tasks</>
          )}
        </span>
        {isFiltered && (
          <button
            type="button"
            onClick={clearAll}
            className="flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted cursor-pointer"
          >
            <FilterX className="h-3.5 w-3.5" aria-hidden="true" />
            Clear all filters
          </button>
        )}
      </div>
    </div>
  )
}
