import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Editor,
  Gantt,
  getEditorItems,
  Willow,
  type IApi,
  type IColumnConfig,
  type ILink,
  type IResource,
  type IScaleConfig,
  type ITask,
} from '@svar-ui/react-gantt'
import '@svar-ui/react-gantt/all.css'
import { DropdownMenu } from 'radix-ui'
import {
  sampleLinks,
  sampleResources,
  sampleTasks,
} from '@/data/sample-gantt-data'
import type { GanttTask } from '@/types/gantt'
import {
  Calendar,
  CalendarDays,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Download,
  FilePlus,
  FolderKanban,
  Indent,
  Layers,
  Outdent,
  PlusCircle,
  Diamond,
  Trash2,
  Upload,
  Users,
  Zap,
  ZapOff,
  ChevronDown,
} from 'lucide-react'
import { CalendarSettingsDialog } from '@/components/calendar-settings-dialog'
import {
  autoScheduleTasks,
  calculateEndDate,
  calculateTaskDuration,
  createSvarCalendarAdapter,
  defaultCalendarConfig,
  exclusiveEndToInclusiveFinish,
  formatToDateString,
  getNextWorkingDay,
  inclusiveFinishToExclusiveEnd,
  type ProjectCalendarConfig,
} from '@/lib/scheduler'

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

function PredecessorCell({ row, links }: { row: GanttTask; links: ILink[] }) {
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

function ResourceNamesCell({ row }: { row: GanttTask }) {
  if (!row.resources || !Array.isArray(row.resources) || row.resources.length === 0) {
    return <span style={{ color: '#9ca3af' }}>-</span>
  }
  const names = row.resources
    .map((id: number) => sampleResources.find((r) => r.id === id)?.label)
    .filter(Boolean)
    .join(', ')
  return (
    <span style={{ fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {names}
    </span>
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

function injectSvarCalendar(
  api: IApi,
  config: ProjectCalendarConfig,
  durationUnit: 'day' | 'hour'
) {
  api.getStores?.()?.data?.setState({
    _calendar: createSvarCalendarAdapter(config, durationUnit),
  })
}
function DurationCell({
  row,
  onDurationChange,
  onSelect,
}: {
  row: GanttTask
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

function EditableDurationInput({
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
function StartDateCell({
  row,
  onDateChange,
  onSelect,
}: {
  row: GanttTask
  onDateChange: (id: string | number, date: Date) => void
  onSelect?: (id: string | number) => void
}) {
  const isSummary = row.type === 'summary'
  const dateStr = formatDate(row.start)
  const inputVal = toDateInputValue(row.start)

  if (isSummary) {
    return (
      <span className="text-xs font-semibold text-foreground/80 tabular-nums px-1">
        {dateStr}
      </span>
    )
  }

  return (
    <div
      className="group relative flex items-center justify-center w-full h-full px-0.5"
      onClick={() => onSelect?.(row.id)}
    >
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
            onDateChange(row.id, parsed)
          }
        }}
        aria-label={`Start date for task ${row.text}`}
        className="w-full text-center text-xs font-medium text-foreground bg-transparent border border-transparent hover:border-border hover:bg-muted/40 focus:border-primary focus:bg-background rounded px-1 py-0.5 cursor-pointer outline-none transition-colors tabular-nums"
      />
    </div>
  )
}

function FinishDateCell({
  row,
  onDateChange,
  onSelect,
}: {
  row: GanttTask
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
    return (
      <span className="text-xs font-semibold text-foreground/80 tabular-nums px-1">
        {dateStr}
      </span>
    )
  }

  return (
    <div
      className="group relative flex items-center justify-center w-full h-full px-0.5"
      onClick={() => onSelect?.(row.id)}
    >
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

const scalePresets: Record<string, IScaleConfig[]> = {
  hour: [
    { unit: 'day', step: 1, format: '%j %F %Y' },
    { unit: 'hour', step: 2, format: '%H:00' },
  ],
  day: [
    { unit: 'month', step: 1, format: '%F %Y' },
    { unit: 'day', step: 1, format: '%j' },
  ],
  week: [
    { unit: 'month', step: 1, format: '%F %Y' },
    { unit: 'week', step: 1, format: 'Week %W' },
  ],
  month: [
    { unit: 'year', step: 1, format: '%Y' },
    { unit: 'month', step: 1, format: '%M' },
  ],
}

const resources: IResource[] = sampleResources.map((r) => ({
  id: r.id,
  name: r.label,
  avatar: r.avatar,
}))

type ZoomMode = keyof typeof scalePresets
type RibbonTab = 'task' | 'project' | 'view'

export function GanttView() {
  const [calendarConfig, setCalendarConfig] = useState<ProjectCalendarConfig>(defaultCalendarConfig)
  const [isAutoSchedule, setIsAutoSchedule] = useState<boolean>(true)
  const [isCalendarDialogOpen, setIsCalendarDialogOpen] = useState<boolean>(false)
  const [activeTab, setActiveTab] = useState<RibbonTab>('task')
  const [selectedTaskId, setSelectedTaskId] = useState<string | number | null>(null)

  const [durationUnit, setDurationUnit] = useState<'day' | 'hour'>('day')
  const [zoom, setZoom] = useState<ZoomMode>('day')

  // Initial tasks are pre-computed with autoScheduleTasks
  const [tasks, setTasks] = useState<ITask[]>(() =>
    autoScheduleTasks(
      sampleTasks as unknown as ITask[],
      sampleLinks as unknown as ILink[],
      defaultCalendarConfig,
      'day'
    )
  )
  const [links, setLinks] = useState<ILink[]>(sampleLinks as unknown as ILink[])

  const [api, setApi] = useState<IApi | null>(null)
  const apiRef = useRef<IApi | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const calendarConfigRef = useRef(calendarConfig)
  const durationUnitRef = useRef(durationUnit)

  useLayoutEffect(() => {
    calendarConfigRef.current = calendarConfig
    durationUnitRef.current = durationUnit
  }, [calendarConfig, durationUnit])

  useLayoutEffect(() => {
    if (!api) return
    injectSvarCalendar(api, calendarConfig, durationUnit)
  }, [api, calendarConfig, durationUnit])

  const handleInit = useCallback((apiInstance: IApi) => {
    apiRef.current = apiInstance
    // Inject before publishing the API so the first controlled task refresh
    // observes the project calendar instead of SVAR's calendar-less default.
    injectSvarCalendar(apiInstance, calendarConfigRef.current, durationUnitRef.current)
    setApi(apiInstance)

    // Listen to task selection events from the chart
    apiInstance.on('select-task', (ev: { id?: string | number } | undefined) => {
      if (ev?.id !== undefined) {
        setSelectedTaskId(ev.id)
      }
    })
  }, [])

  // Auto-schedule aware task update
  const handleUpdateTask = useCallback(
    ({
      id,
      task,
      inProgress,
    }: {
      id: string | number
      task: Partial<ITask> & { predecessors?: string | number }
      inProgress?: boolean
    }) => {
      if (inProgress) return
      setSelectedTaskId(id)

      let currentLinks = links
      if (task.predecessors !== undefined) {
        const raw = String(task.predecessors || '').trim()
        const sourceIds = raw
          ? raw
              .split(/[,\s]+/)
              .map((s) => s.trim())
              .filter(Boolean)
              .map(Number)
              .filter((n) => !isNaN(n) && n > 0 && String(n) !== String(id))
          : []

        const remainingLinks = links.filter((l) => String(l.target) !== String(id))
        let nextId = links.length > 0 ? Math.max(...links.map((l) => Number(l.id) || 0)) + 1 : 1

        const newLinks: ILink[] = sourceIds.map((srcId) => {
          const existing = links.find(
            (l) => String(l.target) === String(id) && String(l.source) === String(srcId)
          )
          if (existing) return existing
          return {
            id: nextId++,
            source: srcId,
            target: id,
            type: 'e2s',
          }
        })

        currentLinks = [...remainingLinks, ...newLinks]
        setLinks(currentLinks)
      }

      setTasks((prev) => {
        const existing = prev.find((t) => String(t.id) === String(id))
        if (!existing) {
          return prev.map((t) => (String(t.id) === String(id) ? ({ ...t, ...task } as ITask) : t))
        }

        const existingStart = existing.start ? new Date(existing.start) : new Date()
        const existingEnd = existing.end ? new Date(existing.end) : existingStart

        const isStartChanged =
          task.start !== undefined &&
          new Date(task.start).getTime() !== existingStart.getTime()
        const isEndChanged =
          task.end !== undefined &&
          new Date(task.end).getTime() !== existingEnd.getTime()

        let updatedTask = { ...existing, ...task } as ITask

        const isDurationChanged =
          task.duration !== undefined &&
          Number(task.duration) !== existing.duration

        if (isDurationChanged && !isStartChanged) {
          // Duration changed directly (e.g. via Duration column or Editor)
          const dur =
            existing.type === 'milestone' ? 0 : Math.max(0, Number(task.duration) || 0)
          const s = getNextWorkingDay(existingStart, calendarConfig)
          const newEnd =
            dur === 0
              ? s
              : calculateEndDate(s, dur, calendarConfig, durationUnit)
          updatedTask = { ...updatedTask, start: s, duration: dur, end: newEnd }
        } else if (isEndChanged && !isStartChanged) {
          // task.end arrives as an exclusive boundary (set by handleFinishDateChange or SVAR drag).
          // Snap: find the inclusive last working day, then recompute exclusive end from start.
          const s = getNextWorkingDay(existingStart, calendarConfig)
          const exclusiveEnd = new Date(task.end!)
          if (existing.type === 'milestone') {
            // For a milestone, snap the exclusive end's preceding day to a working day,
            // then set both start and end to that working day (zero-width).
            const inclusivePick = new Date(
              exclusiveEnd.getFullYear(),
              exclusiveEnd.getMonth(),
              exclusiveEnd.getDate() - 1
            )
            const valid = getNextWorkingDay(inclusivePick, calendarConfig)
            updatedTask = { ...updatedTask, start: valid, end: valid, duration: 0 }
          } else {
            // Snap the inclusive finish forward to a working day, then make it exclusive again
            const inclusiveFinish = new Date(
              exclusiveEnd.getFullYear(),
              exclusiveEnd.getMonth(),
              exclusiveEnd.getDate() - 1
            )
            const snappedFinish = getNextWorkingDay(inclusiveFinish, calendarConfig)
            const snappedExclusiveEnd = new Date(
              snappedFinish.getFullYear(),
              snappedFinish.getMonth(),
              snappedFinish.getDate() + 1
            )
            const newDuration = Math.max(
              1,
              calculateTaskDuration(s, snappedExclusiveEnd, calendarConfig, durationUnit)
            )
            const finalEnd = calculateEndDate(s, newDuration, calendarConfig, durationUnit)
            updatedTask = { ...updatedTask, start: s, end: finalEnd, duration: newDuration }
          }
        } else if (isStartChanged && !isEndChanged) {
          // Start changed: recompute exclusive end to maintain existing duration
          const newStart = getNextWorkingDay(new Date(task.start!), calendarConfig)
          const dur = existing.type === 'milestone' ? 0 : (existing.duration ?? 1)
          const newEnd =
            existing.type === 'milestone'
              ? newStart
              : calculateEndDate(newStart, dur, calendarConfig, durationUnit)
          updatedTask = { ...updatedTask, start: newStart, end: newEnd, duration: dur }
        } else if (isStartChanged && isEndChanged) {
          // Both changed: SVAR sends this when a task bar is dragged or resized.
          const s = new Date(task.start!)
          const e = new Date(task.end!)
          if (existing.type === 'milestone') {
            const valid = getNextWorkingDay(s, calendarConfig)
            updatedTask = { ...updatedTask, start: valid, end: valid, duration: 0 }
          } else {
            const validStart = getNextWorkingDay(s, calendarConfig)
            const dur =
              task.duration !== undefined
                ? Number(task.duration)
                : Math.max(1, calculateTaskDuration(validStart, e, calendarConfig, durationUnit))
            const validEnd = calculateEndDate(validStart, dur, calendarConfig, durationUnit)
            updatedTask = { ...updatedTask, start: validStart, end: validEnd, duration: dur }
          }
        }
        const updated = prev.map((t) => (String(t.id) === String(id) ? updatedTask : t))
        if (isAutoSchedule) {
          return autoScheduleTasks(updated, currentLinks, calendarConfig, durationUnit)
        }
        return updated
      })
    },
    [calendarConfig, durationUnit, isAutoSchedule, links]
  )

  const handleAddTask = useCallback(
    ({ task }: { task: ITask }) => {
      setTasks((prev) => {
        const updated = [...prev, task]
        if (isAutoSchedule) {
          return autoScheduleTasks(updated, links, calendarConfig, durationUnit)
        }
        return updated
      })
      if (task.id !== undefined) {
        setSelectedTaskId(task.id)
      }
    },
    [calendarConfig, durationUnit, isAutoSchedule, links]
  )

  const handleDeleteTask = useCallback(
    ({ id }: { id: string | number }) => {
      setTasks((prev) => {
        const updated = prev.filter((t) => t.id !== id)
        if (isAutoSchedule) {
          return autoScheduleTasks(updated, links, calendarConfig, durationUnit)
        }
        return updated
      })
      if (selectedTaskId === id) {
        setSelectedTaskId(null)
      }
    },
    [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId]
  )

  const handleAddLink = useCallback(
    ({ link, id }: { link: Partial<ILink>; id?: string | number }) => {
      setLinks((prev) => {
        const linkId = link.id ?? id ?? Date.now()
        const fullLink: ILink = {
          id: linkId,
          source: link.source as string | number,
          target: link.target as string | number,
          type: link.type || 'e2s',
          ...(link.lag !== undefined ? { lag: link.lag } : {}),
        }
        if (
          prev.some(
            (l) =>
              l.id === fullLink.id ||
              (String(l.source) === String(fullLink.source) &&
                String(l.target) === String(fullLink.target))
          )
        ) {
          return prev
        }
        const newLinks = [...prev, fullLink]
        if (isAutoSchedule) {
          setTasks((prevTasks) =>
            autoScheduleTasks(prevTasks, newLinks, calendarConfig, durationUnit)
          )
        }
        return newLinks
      })
    },
    [calendarConfig, durationUnit, isAutoSchedule]
  )

  const handleUpdateLink = useCallback(
    ({ id, link }: { id: string | number; link: Partial<ILink> }) => {
      setLinks((prev) => {
        const updatedLinks = prev.map((l) => (l.id === id ? ({ ...l, ...link } as ILink) : l))
        if (isAutoSchedule) {
          setTasks((prevTasks) =>
            autoScheduleTasks(prevTasks, updatedLinks, calendarConfig, durationUnit)
          )
        }
        return updatedLinks
      })
    },
    [calendarConfig, durationUnit, isAutoSchedule]
  )

  const handleDeleteLink = useCallback(
    ({ id }: { id: string | number }) => {
      setLinks((prev) => {
        const newLinks = prev.filter((l) => l.id !== id)
        if (isAutoSchedule) {
          setTasks((prevTasks) =>
            autoScheduleTasks(prevTasks, newLinks, calendarConfig, durationUnit)
          )
        }
        return newLinks
      })
    },
    [calendarConfig, durationUnit, isAutoSchedule]
  )

  // Calendar configuration saved from modal
  const handleSaveCalendar = useCallback(
    (newConfig: ProjectCalendarConfig) => {
      setCalendarConfig(newConfig)
      if (isAutoSchedule) {
        setTasks((prev) => autoScheduleTasks(prev, links, newConfig, durationUnit))
      }
    },
    [durationUnit, isAutoSchedule, links]
  )

  // Toggle Auto-Schedule ON/OFF
  const handleToggleAutoSchedule = useCallback(() => {
    setIsAutoSchedule((prev) => {
      const next = !prev
      if (next) {
        setTasks((currentTasks) =>
          autoScheduleTasks(currentTasks, links, calendarConfig, durationUnit)
        )
      }
      return next
    })
  }, [calendarConfig, durationUnit, links])

  // Change duration unit and recalculate
  const handleDurationUnitChange = useCallback(
    (newUnit: 'day' | 'hour') => {
      if (newUnit === durationUnit) return
      setDurationUnit(newUnit)

      setTasks((prev) => {
        const updated = prev.map((t) => {
          if (t.type === 'milestone') {
            return { ...t, duration: 0 }
          }
          if (!t.start || !t.end) return t
          const newDuration = calculateTaskDuration(
            new Date(t.start),
            new Date(t.end),
            calendarConfig,
            newUnit
          )
          return {
            ...t,
            duration: newDuration,
          }
        })
        if (isAutoSchedule) {
          return autoScheduleTasks(updated, links, calendarConfig, newUnit)
        }
        return updated
      })
    },
    [calendarConfig, durationUnit, isAutoSchedule, links]
  )

  // Timeline Highlight function for non-working days and holidays
  const handleHighlightTime = useCallback(
    (date: Date, _unit: 'day' | 'hour'): string => {
      if (!date || !(date instanceof Date) || isNaN(date.getTime())) return ''
      const dateStr = formatToDateString(date)
      const isHoliday = calendarConfig.holidays.some((h) => h.date === dateStr)
      if (isHoliday) {
        return 'gantt-holiday-cell'
      }

      const dayOfWeek = date.getDay()
      if (!calendarConfig.workingDays.includes(dayOfWeek)) {
        return 'gantt-weekend-cell'
      }

      return ''
    },
    [calendarConfig]
  )

  // Toolbar Actions: Add Task
  const handleAddTaskAction = useCallback(() => {
    const nextId = tasks.length > 0 ? Math.max(...tasks.map((t) => Number(t.id) || 0)) + 1 : 1
    const today = getNextWorkingDay(new Date(), calendarConfig)
    const duration = durationUnit === 'hour' ? (calendarConfig.workingHoursPerDay || 8) : 1
    const endDate = calculateEndDate(today, duration, calendarConfig, durationUnit)

    const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : null
    const parentId = selectedTask?.type === 'summary' ? selectedTask.id : selectedTask?.parent

    const newTask: ITask = {
      id: nextId,
      text: `New Task ${nextId}`,
      start: today,
      end: endDate,
      duration,
      progress: 0,
      type: 'task',
      ...(parentId !== undefined ? { parent: parentId } : {}),
    }

    const newTasksList = [...tasks, newTask]
    const scheduled = isAutoSchedule
      ? autoScheduleTasks(newTasksList, links, calendarConfig, durationUnit)
      : newTasksList

    setTasks(scheduled)
    setSelectedTaskId(nextId)
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // Toolbar Actions: Add Milestone
  const handleAddMilestoneAction = useCallback(() => {
    const nextId = tasks.length > 0 ? Math.max(...tasks.map((t) => Number(t.id) || 0)) + 1 : 1
    const today = getNextWorkingDay(new Date(), calendarConfig)

    const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : null
    const parentId = selectedTask?.type === 'summary' ? selectedTask.id : selectedTask?.parent

    const newMilestone: ITask = {
      id: nextId,
      text: `Milestone ${nextId}`,
      start: today,
      end: today,
      duration: 0,
      progress: 0,
      type: 'milestone',
      ...(parentId !== undefined ? { parent: parentId } : {}),
    }

    const newTasksList = [...tasks, newMilestone]
    const scheduled = isAutoSchedule
      ? autoScheduleTasks(newTasksList, links, calendarConfig, durationUnit)
      : newTasksList

    setTasks(scheduled)
    setSelectedTaskId(nextId)
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // Toolbar Actions: Indent Task
  const handleIndent = useCallback(() => {
    if (selectedTaskId == null) return
    const idx = tasks.findIndex((t) => t.id === selectedTaskId)
    if (idx <= 0) return // First task cannot be indented

    const prevTask = tasks[idx - 1]
    const updatedTasks = tasks.map((t, i) => {
      if (t.id === selectedTaskId) {
        return { ...t, parent: prevTask.id }
      }
      if (i === idx - 1) {
        return { ...t, type: 'summary', open: true }
      }
      return t
    })

    if (apiRef.current) {
      try {
        apiRef.current.exec('indent-task', { id: selectedTaskId, mode: true })
      } catch {
        // Handled by state
      }
    }

    const scheduled = isAutoSchedule
      ? autoScheduleTasks(updatedTasks, links, calendarConfig, durationUnit)
      : updatedTasks
    setTasks(scheduled)
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // Toolbar Actions: Outdent Task
  const handleOutdent = useCallback(() => {
    if (selectedTaskId == null) return
    const currTask = tasks.find((t) => t.id === selectedTaskId)
    if (!currTask || currTask.parent == null) return // Already root level

    const parentTask = tasks.find((t) => t.id === currTask.parent)
    const newParent = parentTask ? parentTask.parent : undefined

    const updatedTasks = tasks.map((t) => {
      if (t.id === selectedTaskId) {
        const copy = { ...t }
        if (newParent !== undefined) {
          copy.parent = newParent
        } else {
          delete copy.parent
        }
        return copy
      }
      return t
    })

    const remainingChildren = updatedTasks.filter((t) => t.parent === currTask.parent)
    const finalTasks = updatedTasks.map((t) => {
      if (t.id === currTask.parent && remainingChildren.length === 0) {
        return { ...t, type: 'task' }
      }
      return t
    })

    if (apiRef.current) {
      try {
        apiRef.current.exec('indent-task', { id: selectedTaskId, mode: false })
      } catch {
        // Handled by state
      }
    }

    const scheduled = isAutoSchedule
      ? autoScheduleTasks(finalTasks, links, calendarConfig, durationUnit)
      : finalTasks
    setTasks(scheduled)
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // Toolbar Actions: Delete Task
  const handleDeleteSelectedTask = useCallback(() => {
    if (selectedTaskId == null) return
    const idToDelete = selectedTaskId

    const idsToDelete = new Set<string | number>([idToDelete])
    let addedMore = true
    while (addedMore) {
      addedMore = false
      for (const t of tasks) {
        if (t.id !== undefined && t.parent !== undefined && idsToDelete.has(t.parent) && !idsToDelete.has(t.id)) {
          idsToDelete.add(t.id)
          addedMore = true
        }
      }
    }

    const remainingTasks = tasks.filter((t) => t.id === undefined || !idsToDelete.has(t.id))
    const remainingLinks = links.filter(
      (l) => !idsToDelete.has(l.source) && !idsToDelete.has(l.target)
    )

    if (apiRef.current) {
      try {
        apiRef.current.exec('delete-task', { id: idToDelete })
      } catch {
        // Handled by state
      }
    }

    const scheduled = isAutoSchedule
      ? autoScheduleTasks(remainingTasks, remainingLinks, calendarConfig, durationUnit)
      : remainingTasks

    setTasks(scheduled)
    setLinks(remainingLinks)
    setSelectedTaskId(null)
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // File Menu: Export JSON
  const handleExportJson = useCallback(() => {
    const exportData = {
      version: '1.0',
      projectName: 'Website Redesign & Launch Plan',
      exportedAt: new Date().toISOString(),
      calendarConfig,
      durationUnit,
      tasks: tasks.map((t) => ({
        ...t,
        start: t.start ? formatToDateString(new Date(t.start)) : undefined,
        end: t.end ? formatToDateString(new Date(t.end)) : undefined,
      })),
      links,
      resources: sampleResources,
    }

    const jsonString = JSON.stringify(exportData, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ms-project-schedule-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [calendarConfig, durationUnit, links, tasks])

  // File Menu: Import JSON
  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const rawContent = event.target?.result
          if (typeof rawContent !== 'string') return

          const parsed = JSON.parse(rawContent) as {
            tasks?: Array<Partial<ITask> & { start?: string | Date; end?: string | Date }>
            links?: ILink[]
            calendarConfig?: ProjectCalendarConfig
            durationUnit?: 'day' | 'hour'
          }

          if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
            alert('Invalid JSON: Missing "tasks" array in file.')
            return
          }

          const newCalendarConfig = parsed.calendarConfig || calendarConfig
          const newUnit = parsed.durationUnit || durationUnit

          const importedTasks: ITask[] = parsed.tasks.map((t, idx) => ({
            ...t,
            id: t.id ?? idx + 1,
            text: t.text || `Task ${idx + 1}`,
            start: t.start ? new Date(t.start) : new Date(),
            end: t.end ? new Date(t.end) : new Date(),
            duration: t.type === 'milestone' ? 0 : (t.duration ?? 1),
            progress: t.progress ?? 0,
            type: t.type || 'task',
          }))

          const importedLinks: ILink[] = Array.isArray(parsed.links) ? parsed.links : []

          if (parsed.calendarConfig) {
            setCalendarConfig(newCalendarConfig)
          }
          if (parsed.durationUnit) {
            setDurationUnit(newUnit)
          }

          const scheduled = isAutoSchedule
            ? autoScheduleTasks(importedTasks, importedLinks, newCalendarConfig, newUnit)
            : importedTasks

          setTasks(scheduled)
          setLinks(importedLinks)
          setSelectedTaskId(null)
        } catch {
          alert('Failed to parse JSON file. Please ensure it is a valid MS Project export.')
        } finally {
          e.target.value = ''
        }
      }
      reader.readAsText(file)
    },
    [calendarConfig, durationUnit, isAutoSchedule]
  )

  // File Menu: New Project
  const handleNewProject = useCallback(() => {
    if (!window.confirm('Create a new project? This will reset the task schedule to a clean template.')) {
      return
    }

    const today = getNextWorkingDay(new Date(), calendarConfig)
    const initialTasks: ITask[] = [
      {
        id: 1,
        text: 'Phase 1: Project Initiation',
        start: today,
        end: calculateEndDate(today, 5, calendarConfig, durationUnit),
        duration: 5,
        type: 'summary',
        open: true,
        progress: 0,
      },
      {
        id: 2,
        text: 'Scope & Requirements',
        start: today,
        end: calculateEndDate(today, 2, calendarConfig, durationUnit),
        duration: 2,
        type: 'task',
        progress: 0,
        parent: 1,
      },
      {
        id: 3,
        text: 'Architecture Planning',
        start: calculateEndDate(today, 2, calendarConfig, durationUnit),
        end: calculateEndDate(today, 5, calendarConfig, durationUnit),
        duration: 3,
        type: 'task',
        progress: 0,
        parent: 1,
      },
      {
        id: 4,
        text: 'Kickoff Milestone',
        start: calculateEndDate(today, 5, calendarConfig, durationUnit),
        end: calculateEndDate(today, 5, calendarConfig, durationUnit),
        duration: 0,
        type: 'milestone',
        progress: 0,
        parent: 1,
      },
    ]
    const initialLinks: ILink[] = [
      { id: 1, source: 2, target: 3, type: 'e2s' },
      { id: 2, source: 3, target: 4, type: 'e2s' },
    ]

    const scheduled = isAutoSchedule
      ? autoScheduleTasks(initialTasks, initialLinks, calendarConfig, durationUnit)
      : initialTasks

    setTasks(scheduled)
    setLinks(initialLinks)
    setSelectedTaskId(null)
  }, [calendarConfig, durationUnit, isAutoSchedule])

  const editorItems = useMemo(() => {
    return getEditorItems().map((item) => {
      if (item.comp === 'date') {
        return {
          ...item,
          config: {
            ...item.config,
            time: durationUnit === 'hour',
          },
        }
      }
      return item
    })
  }, [durationUnit])
  const handleDurationChange = useCallback(
    (id: string | number, duration: number) => {
      handleUpdateTask({
        id,
        task: { duration },
      })
    },
    [handleUpdateTask]
  )

  const handleStartDateChange = useCallback(
    (id: string | number, date: Date) => {
      handleUpdateTask({
        id,
        task: { start: date },
      })
    },
    [handleUpdateTask]
  )

  const handleFinishDateChange = useCallback(
    (id: string | number, date: Date) => {
      // date is the inclusive finish chosen by the user in FinishDateCell.
      // Convert to the exclusive end boundary expected by scheduler and SVAR.
      handleUpdateTask({
        id,
        task: { end: inclusiveFinishToExclusiveEnd(date) },
      })
    },
    [handleUpdateTask]
  )
  const columns: IColumnConfig[] = useMemo(
    () => [
      {
        id: 'id',
        header: 'ID',
        width: 50,
        align: 'center',
        sort: true,
        cell: (({ row }: { row: GanttTask }) => (
          <span
            onClick={() => setSelectedTaskId(row.id)}
            style={{
              fontWeight: 600,
              fontSize: '0.82rem',
              color: selectedTaskId === row.id ? '#107c41' : '#6b7280',
              display: 'inline-block',
              width: '100%',
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
              cursor: 'pointer',
            }}
          >
            {row.id}
          </span>
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'text',
        header: 'Task Name',
        width: 220,
        flexgrow: 2,
        sort: true,
        editor: 'text',
      },
      {
        id: 'duration',
        header: `Duration (${durationUnit === 'day' ? 'days' : 'hrs'})`,
        width: 100,
        align: 'center',
        sort: true,
        cell: (({ row }: { row: GanttTask }) => (
          <DurationCell
            row={row}
            onDurationChange={handleDurationChange}
            onSelect={setSelectedTaskId}
          />
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'start',
        header: 'Start',
        width: 125,
        align: 'center',
        sort: true,
        cell: (({ row }: { row: GanttTask }) => (
          <StartDateCell
            row={row}
            onDateChange={handleStartDateChange}
            onSelect={setSelectedTaskId}
          />
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'end',
        header: 'Finish',
        width: 125,
        align: 'center',
        sort: true,
        cell: (({ row }: { row: GanttTask }) => (
          <FinishDateCell
            row={row}
            onDateChange={handleFinishDateChange}
            onSelect={setSelectedTaskId}
          />
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'predecessors',
        header: 'Predecessors',
        width: 100,
        align: 'center',
        editor: 'text',
        cell: (({ row }: { row: GanttTask }) => (
          <PredecessorCell row={row} links={links} />
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'resourceNames',
        header: 'Resource Names',
        width: 150,
        cell: ResourceNamesCell as unknown as IColumnConfig['cell'],
      },
      {
        id: 'add-task',
        header: '',
        width: 38,
        align: 'center',
      },
    ],
    [durationUnit, handleDurationChange, handleFinishDateChange, handleStartDateChange, links, selectedTaskId]
  )

  const totalTasks = tasks.filter((t) => t.type !== 'summary').length
  const summaryTasks = tasks.filter((t) => t.type === 'summary').length
  const completedTasks = tasks.filter((t) => t.progress === 100).length

  const selectedTaskIndex =
    selectedTaskId != null ? tasks.findIndex((t) => t.id === selectedTaskId) : -1
  const selectedTask = selectedTaskIndex >= 0 ? tasks[selectedTaskIndex] : null
  const canIndent = selectedTaskIndex > 0
  const canOutdent = selectedTask != null && selectedTask.parent != null

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Hidden file input for JSON import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImportFile}
        className="hidden"
      />

      {/* MS Project Top Header & Ribbon Navigation */}
      <header className="flex flex-col shrink-0 border-b border-border bg-card shadow-xs select-none">
        {/* Row 1: App Title, Ribbon Tabs, and Quick Status Metrics */}
        <div className="flex h-9 items-center justify-between border-b border-border/80 px-2.5">
          <div className="flex items-center gap-2">
            {/* MS Project Brand Badge */}
            <div className="flex items-center gap-1.5 pr-2 border-r border-border">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-[#107c41] text-white shadow-xs">
                <FolderKanban className="h-3.5 w-3.5" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs font-bold tracking-tight text-foreground">MS Project</span>
                <span className="hidden text-[11px] text-muted-foreground sm:inline">Web</span>
              </div>
            </div>

            {/* Ribbon Tabs with File Dropdown */}
            <nav className="flex items-center gap-1">
              {/* File Dropdown Menu */}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded bg-[#107c41] px-2.5 py-1 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#0f6d39] cursor-pointer"
                  >
                    <span>File</span>
                    <ChevronDown className="h-3 w-3 opacity-80" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="z-50 min-w-[230px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl animate-in fade-in-80 zoom-in-95">
                    <DropdownMenu.Item
                      onSelect={handleNewProject}
                      className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors"
                    >
                      <FilePlus className="h-4 w-4 text-primary" />
                      <div>
                        <div className="font-medium">New Project</div>
                        <div className="text-[10px] text-muted-foreground">Reset to fresh schedule template</div>
                      </div>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={handleExportJson}
                      className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors"
                    >
                      <Download className="h-4 w-4 text-blue-500" />
                      <div>
                        <div className="font-medium">Export Schedule (JSON)</div>
                        <div className="text-[10px] text-muted-foreground">Save project tasks and calendar to file</div>
                      </div>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={() => fileInputRef.current?.click()}
                      className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors"
                    >
                      <Upload className="h-4 w-4 text-emerald-500" />
                      <div>
                        <div className="font-medium">Import Schedule (JSON)</div>
                        <div className="text-[10px] text-muted-foreground">Load previously saved schedule</div>
                      </div>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-border" />
                    <DropdownMenu.Item
                      onSelect={() => setIsCalendarDialogOpen(true)}
                      className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-xs outline-none hover:bg-muted focus:bg-muted transition-colors"
                    >
                      <Calendar className="h-4 w-4 text-amber-500" />
                      <div>
                        <div className="font-medium">Project Working Time & Calendar</div>
                        <div className="text-[10px] text-muted-foreground">Configure working hours, days & holidays</div>
                      </div>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>

              {/* Task Tab */}
              <button
                type="button"
                onClick={() => setActiveTab('task')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  activeTab === 'task'
                    ? 'bg-muted text-foreground font-semibold border-b-2 border-primary'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                Task
              </button>

              {/* Project Tab */}
              <button
                type="button"
                onClick={() => setActiveTab('project')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  activeTab === 'project'
                    ? 'bg-muted text-foreground font-semibold border-b-2 border-primary'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                Project
              </button>

              {/* View Tab */}
              <button
                type="button"
                onClick={() => setActiveTab('view')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  activeTab === 'view'
                    ? 'bg-muted text-foreground font-semibold border-b-2 border-primary'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                View
              </button>
            </nav>
          </div>

          {/* Quick Metrics Bar */}
          <div className="flex items-center gap-3 text-xs">
            <div className="hidden items-center gap-3.5 text-muted-foreground lg:flex">
              <div className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" />
                <span>
                  <strong className="text-foreground">{summaryTasks}</strong> Phases
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-blue-500" />
                <span>
                  <strong className="text-foreground">{totalTasks}</strong> Tasks
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span>
                  <strong className="text-foreground">{completedTasks}</strong> Done
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-amber-500" />
                <span>
                  <strong className="text-foreground">{sampleResources.length}</strong> Resources
                </span>
              </div>
            </div>

            {/* Auto-Schedule Indicator */}
            <div
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                isAutoSchedule
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-muted-foreground/30 bg-muted text-muted-foreground'
              }`}
            >
              {isAutoSchedule ? <Zap className="h-3 w-3 text-emerald-500" /> : <ZapOff className="h-3 w-3" />}
              <span>Auto-Schedule: {isAutoSchedule ? 'ON' : 'OFF'}</span>
            </div>
          </div>
        </div>

        {/* Row 2: Active Ribbon Command Toolbar */}
        <div className="flex h-11 items-center justify-between px-3 bg-card/60">
          {/* TAB 1: TASK RIBBON */}
          {activeTab === 'task' && (
            <div className="flex items-center gap-2 overflow-x-auto py-1">
              {/* Add Tasks Group */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleAddTaskAction}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs"
                  title="Add a new task to the schedule"
                >
                  <PlusCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Add Task</span>
                </button>
                <button
                  type="button"
                  onClick={handleAddMilestoneAction}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs"
                  title="Add a milestone (0 duration)"
                >
                  <Diamond className="h-3.5 w-3.5 text-amber-500" />
                  <span>Add Milestone</span>
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelectedTask}
                  disabled={selectedTaskId == null}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 hover:border-destructive/30 transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none"
                  title={selectedTaskId ? 'Delete selected task' : 'Select a task first to delete'}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Task</span>
                </button>
              </div>

              <div className="h-5 w-px bg-border" />

              {/* Hierarchy Group: Indent & Outdent */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleIndent}
                  disabled={!canIndent}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none"
                  title={canIndent ? 'Indent task under the task above' : 'Cannot indent task'}
                >
                  <Indent className="h-3.5 w-3.5 text-blue-500" />
                  <span>Indent</span>
                </button>
                <button
                  type="button"
                  onClick={handleOutdent}
                  disabled={!canOutdent}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none"
                  title={canOutdent ? 'Outdent task to parent level' : 'Task is already at root level'}
                >
                  <Outdent className="h-3.5 w-3.5 text-blue-500" />
                  <span>Outdent</span>
                </button>
              </div>

              <div className="h-5 w-px bg-border" />

              {/* Scheduling Group: Auto-Schedule Toggle */}
              <button
                type="button"
                onClick={handleToggleAutoSchedule}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer shadow-2xs ${
                  isAutoSchedule
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                title="Toggle automatic predecessor dependency rescheduling"
              >
                {isAutoSchedule ? (
                  <Zap className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <ZapOff className="h-3.5 w-3.5" />
                )}
                <span>Auto-Schedule: {isAutoSchedule ? 'ON' : 'OFF'}</span>
              </button>

              {/* Selected Task Context Pill */}
              {selectedTask && (
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground ml-2">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground/80">Selected:</span>
                  <span className="font-semibold text-foreground max-w-[180px] truncate">
                    #{selectedTask.id} {selectedTask.text}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.2 text-[10px] font-mono">
                    {selectedTask.type}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: PROJECT RIBBON */}
          {activeTab === 'project' && (
            <div className="flex items-center gap-3 overflow-x-auto py-1">
              <button
                type="button"
                onClick={() => setIsCalendarDialogOpen(true)}
                className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer shadow-2xs"
              >
                <Calendar className="h-4 w-4" />
                <span>Project Working Time & Calendar Settings</span>
              </button>

              <div className="h-5 w-px bg-border" />

              {/* Project Calendar Summary Chips */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 bg-background border border-border rounded px-2.5 py-1">
                  <Clock className="h-3.5 w-3.5 text-blue-500" />
                  <span>
                    Working Hours: <strong className="text-foreground">{calendarConfig.workingHoursPerDay}h</strong> / day
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-background border border-border rounded px-2.5 py-1">
                  <CalendarDays className="h-3.5 w-3.5 text-emerald-500" />
                  <span>
                    Working Days: <strong className="text-foreground">{calendarConfig.workingDays.length}</strong> days / week
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-background border border-border rounded px-2.5 py-1">
                  <CalendarCheck className="h-3.5 w-3.5 text-rose-500" />
                  <span>
                    Holidays: <strong className="text-foreground">{calendarConfig.holidays.length}</strong> non-working exceptions
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: VIEW RIBBON */}
          {activeTab === 'view' && (
            <div className="flex items-center gap-3 overflow-x-auto py-1">
              {/* Zoom Controls */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Zoom Scale:</span>
                <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
                  {(['hour', 'day', 'week', 'month'] as ZoomMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setZoom(mode)}
                      className={`rounded px-2.5 py-0.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                        zoom === mode
                          ? 'bg-background text-foreground shadow-xs font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-5 w-px bg-border" />

              {/* Duration Unit Toggle */}
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Duration Unit:</span>
                </span>
                <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
                  <button
                    type="button"
                    onClick={() => handleDurationUnitChange('day')}
                    className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                      durationUnit === 'day'
                        ? 'bg-background text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Days
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDurationUnitChange('hour')}
                    className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                      durationUnit === 'hour'
                        ? 'bg-background text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Hours
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Gantt View Area (Left Table + Right Timeline) */}
      <main className="relative min-h-0 flex-1 w-full overflow-hidden">
        <Willow>
          <Gantt
            init={handleInit}
            tasks={api ? tasks : []}
            links={links}
            resources={resources}
            scales={scalePresets[zoom]}
            columns={columns}
            gridWidth={540}
            durationUnit={durationUnit}
            cellHeight={35}
            scaleHeight={30}
            cellWidth={zoom === 'hour' ? 60 : 100}
            highlightTime={handleHighlightTime}
            onSelectTask={({ id }) => {
              if (id !== undefined) {
                setSelectedTaskId(id)
              }
            }}
            onUpdateTask={handleUpdateTask}
            onAddTask={handleAddTask}
            onDeleteTask={handleDeleteTask}
            onAddLink={handleAddLink}
            onUpdateLink={handleUpdateLink}
            onDeleteLink={handleDeleteLink}
          />
          {api && <Editor api={api} items={editorItems} />}
        </Willow>
      </main>

      {/* Project Calendar & Working Hours Modal */}
      <CalendarSettingsDialog
        open={isCalendarDialogOpen}
        onOpenChange={setIsCalendarDialogOpen}
        calendarConfig={calendarConfig}
        onSave={handleSaveCalendar}
      />
    </div>
  )
}
