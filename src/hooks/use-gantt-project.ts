import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type IApi, type ILink, type IResource, type IScaleConfig, type ITask } from '@svar-ui/react-gantt'
import { sampleLinks, sampleResources, sampleTasks } from '@/data/sample-gantt-data'
import type { GanttResource, TaskWithResources } from '@/types/gantt'
import type { CsvImportData, CsvTaskMapping } from '@/types/gantt-csv'
import type { RibbonTab, ViewMode, ZoomMode } from '@/components/gantt/gantt-ribbon'
import { applyGanttPaste } from '@/lib/gantt-paste'
import { importGanttCsv, serializeGanttCsv } from '@/lib/gantt-csv'
import { autoScheduleTasks, calculateEndDate, calculateTaskDuration, createSvarCalendarAdapter, defaultCalendarConfig, formatToDateString, getNextWorkingDay, inclusiveFinishToExclusiveEnd, type ProjectCalendarConfig } from '@/lib/scheduler'
import { parseCsv } from '@/lib/csv'
import { parseClipboardTable } from '@/lib/clipboard'
import { addTaskAtPlacement, buildDependencyChain, collectTaskSubtreeIds, getNextNumericTaskId, isTaskParentAllowed, moveTaskAtPlacement, removeLinksTouching, resequenceProject, sameTaskId, toPositiveNumericTaskId } from '@/lib/task-helpers'
import { computeCriticalPath } from '@/lib/critical-path'

type TaskPlacementMode = 'before' | 'after' | 'child' | 'up' | 'down'
type DependencyType = ILink['type']

function injectSvarCalendar(api: IApi, config: ProjectCalendarConfig, durationUnit: 'day' | 'hour') {
  api.getStores?.()?.data?.setState({ _calendar: createSvarCalendarAdapter(config, durationUnit) })
}

const scalePresets: Record<string, IScaleConfig[]> = {
  hour: [{ unit: 'day', step: 1, format: '%j %F %Y' }, { unit: 'hour', step: 2, format: '%H:00' }],
  day: [{ unit: 'month', step: 1, format: '%F %Y' }, { unit: 'day', step: 1, format: '%j' }],
  week: [{ unit: 'month', step: 1, format: '%F %Y' }, { unit: 'week', step: 1, format: 'Week %W' }],
  month: [{ unit: 'year', step: 1, format: '%Y' }, { unit: 'month', step: 1, format: '%M' }],
}

export function useGanttProject() {
  const [calendarConfig, setCalendarConfig] = useState<ProjectCalendarConfig>(defaultCalendarConfig)
  const [isAutoSchedule, setIsAutoSchedule] = useState<boolean>(true)
  const [isCalendarDialogOpen, setIsCalendarDialogOpen] = useState<boolean>(false)
  const [csvImportData, setCsvImportData] = useState<CsvImportData | null>(null)
  const [clipboardImportData, setClipboardImportData] = useState<CsvImportData | null>(null)
  const [isColumnChooserOpen, setIsColumnChooserOpen] = useState<boolean>(false)
  const [isWorkColumnVisible, setIsWorkColumnVisible] = useState<boolean>(false)
  const [activeTab, setActiveTab] = useState<RibbonTab>('task')
  const [selectedTaskId, setSelectedTaskId] = useState<string | number | null>(null)
  const [selectedTaskIds, setSelectedTaskIds] = useState<(string | number)[]>([])
  const [isGanttVisible, setIsGanttVisible] = useState<boolean>(true)
  const [showCriticalPath, setShowCriticalPath] = useState<boolean>(false)
  const [viewMode, setViewMode] = useState<ViewMode>('gantt')

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
  const [resourceList, setResourceList] = useState<GanttResource[]>(sampleResources)

  const [api, setApi] = useState<IApi | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const calendarConfigRef = useRef(calendarConfig)
  const durationUnitRef = useRef(durationUnit)
  const tasksRef = useRef(tasks)
  const linksRef = useRef(links)
  const apiRef = useRef<IApi | null>(null)
  const selectedTaskIdRef = useRef(selectedTaskId)
  const selectedTaskIdsRef = useRef(selectedTaskIds)
  // SVAR dispatches `delete-task` once per selected task synchronously, but
  // resequencing renumbers ids so later dispatches in the same burst carry
  // stale ids. The first dispatch deletes the whole selection; this set marks
  // the already-deleted ids so the redundant dispatches are ignored. Cleared
  // in the layout effect below once the burst has committed.
  const deletedTaskIdsRef = useRef<Set<string>>(new Set())

  useLayoutEffect(() => {
    calendarConfigRef.current = calendarConfig
    durationUnitRef.current = durationUnit
    tasksRef.current = tasks
    linksRef.current = links
    apiRef.current = api
    selectedTaskIdRef.current = selectedTaskId
    selectedTaskIdsRef.current = selectedTaskIds
    deletedTaskIdsRef.current.clear()
  }, [api, calendarConfig, durationUnit, tasks, links, selectedTaskId, selectedTaskIds])

  useLayoutEffect(() => {
    if (!api) return
    injectSvarCalendar(api, calendarConfig, durationUnit)
  }, [api, calendarConfig, durationUnit])
  useLayoutEffect(() => {
    if (!api) return
    api.getStores?.()?.data?.setState({ criticalPath: showCriticalPath ? { type: 'strict' } : null })
  }, [api, showCriticalPath])

  const handleTaskSelection = useCallback((ev: { id?: string | number; toggle?: boolean; range?: boolean } | undefined) => {
    if (ev?.id === undefined) return
    const id = ev.id
    if (ev.toggle) {
      const current = selectedTaskIdsRef.current
      const next = current.some((selectedId) => sameTaskId(selectedId, id))
        ? current.filter((selectedId) => !sameTaskId(selectedId, id))
        : [...current, id]
      setSelectedTaskIds(next)
      setSelectedTaskId(next.length > 0 ? next[next.length - 1] : null)
      return
    }
    const anchorId = selectedTaskIdRef.current
    if (ev.range && anchorId !== null) {
      // The grid may sort/filter rows, so range math must run on the store's
      // displayed order (`_tasks`), not the app's insertion-order array.
      const currentTasks = apiRef.current?.getState()._tasks ?? tasksRef.current
      const anchorIndex = currentTasks.findIndex((task) => sameTaskId(task.id, anchorId))
      const targetIndex = currentTasks.findIndex((task) => sameTaskId(task.id, id))
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const from = Math.min(anchorIndex, targetIndex)
        const to = Math.max(anchorIndex, targetIndex)
        const rangeIds = currentTasks
          .slice(from, to + 1)
          .map((task) => task.id)
          .filter((taskId): taskId is string | number => taskId !== undefined)
        setSelectedTaskIds(rangeIds)
        setSelectedTaskId(id)
        return
      }
    }
    setSelectedTaskIds([id])
    setSelectedTaskId(id)
  }, [])
  const handleToggleGanttVisibility = useCallback(() => {
    setIsGanttVisible((visible) => !visible)
  }, [])
  const handleToggleCriticalPath = useCallback(() => {
    setShowCriticalPath((v) => !v)
  }, [])
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
  }, [])

  const handleInit = useCallback((apiInstance: IApi) => {
    // Inject before publishing the API so the first controlled task refresh
    // observes the project calendar instead of SVAR's calendar-less default.
    injectSvarCalendar(apiInstance, calendarConfigRef.current, durationUnitRef.current)
    apiRef.current = apiInstance
    setApi(apiInstance)

    // Route double-click/editor activation to the custom Task Info panel.
    // select-task itself is handled via the onSelectTask prop; registering it
    // here too would invoke handleTaskSelection twice per exec.
    apiInstance.intercept('show-editor', (ev: { id?: string | number } | undefined) => {
      handleTaskSelection(ev)
      return false
    })

    // Veto SVAR's clipboard hotkeys: its ctrl+v runs paste-task without
    // preventDefault, so the document paste listener would also fire and
    // double-apply. With paste vetoed, the internal copy/cut buffer is dead
    // state, so veto those too. No preventDefault on the keydown — that would
    // suppress the browser paste event our listener relies on.
    apiInstance.intercept('hotkey', (ev: { key?: string }) => {
      if (ev?.key === 'ctrl+v' || ev?.key === 'ctrl+c' || ev?.key === 'ctrl+x') return false
      return true
    })

  }, [handleTaskSelection])

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
      setSelectedTaskIds((current) =>
        current.some((selectedId) => sameTaskId(selectedId, id)) ? current : [id]
      )

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
          return prev.map((t) => {
            if (String(t.id) !== String(id)) return t
            const updated = { ...t, ...task } as ITask
            if (task.parent !== undefined && !isTaskParentAllowed(prev, task.parent)) {
              if (t.parent !== undefined && isTaskParentAllowed(prev, t.parent)) {
                updated.parent = t.parent
              } else {
                delete updated.parent
              }
            }
            return updated
          })
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
        if (task.parent !== undefined && !isTaskParentAllowed(prev, task.parent)) {
          if (existing.parent !== undefined && isTaskParentAllowed(prev, existing.parent)) {
            updatedTask.parent = existing.parent
          } else {
            delete updatedTask.parent
          }
        }

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
  const ganttResources = useMemo<IResource[]>(
    () =>
      resourceList.map((resource) => ({
        id: resource.id,
        name: resource.label,
        avatar: resource.avatar,
      })),
    [resourceList]
  )

  const handleResourceChange = useCallback((id: number, patch: Partial<GanttResource>) => {
    setResourceList((current) =>
      current.map((resource) => (resource.id === id ? { ...resource, ...patch } : resource))
    )
  }, [])

  const handleAddResource = useCallback(() => {
    setResourceList((current) => {
      const nextId = current.length > 0 ? Math.max(...current.map((resource) => resource.id)) + 1 : 1
      return [...current, { id: nextId, label: `New Resource ${nextId}` }]
    })
  }, [])

  const handleDeleteResource = useCallback((id: number) => {
    const resource = resourceList.find((item) => item.id === id)
    if (!resource || !window.confirm(`Remove ${resource.label}? Existing task assignments will be cleared.`)) return
    setResourceList((current) => current.filter((item) => item.id !== id))
    setTasks((current) =>
      current.map((task) => {
        const assigned = (task as TaskWithResources).resources
        if (!assigned) return task
        return { ...task, resources: assigned.filter((resourceId) => resourceId !== id) } as ITask
      })
    )
  }, [resourceList])

  const handleToggleTaskResource = useCallback(
    (taskId: string | number, resourceId: number, assigned: boolean) => {
      setTasks((current) =>
        current.map((task) => {
          if (String(task.id) !== String(taskId)) return task
          const currentResources = (task as TaskWithResources).resources ?? []
          const nextResources = assigned
            ? Array.from(new Set([...currentResources, resourceId]))
            : currentResources.filter((id) => id !== resourceId)
          return { ...task, resources: nextResources } as ITask
        })
      )
    },
    []
  )

  const handleTaskInfoChange = useCallback(
    (id: string | number, patch: Partial<ITask>) => {
      handleUpdateTask({ id, task: patch })
    },
    [handleUpdateTask]
  )

  const handleResourcesChange = useCallback(
    (id: string | number, resourceIds: number[]) => {
      handleUpdateTask({ id, task: { resources: resourceIds } })
    },
    [handleUpdateTask]
  )


  const handleAddTask = useCallback(
    ({
      task,
      target,
      mode,
    }: {
      task: ITask
      target?: string | number
      mode?: TaskPlacementMode
    }) => {
      const nextId = getNextNumericTaskId(tasks)
      const incomingId = toPositiveNumericTaskId(task.id)
      const taskId =
        incomingId !== null && !tasks.some((item) => toPositiveNumericTaskId(item.id) === incomingId)
          ? incomingId
          : nextId
      const type = task.type || 'task'
      const start = task.start ? new Date(task.start) : getNextWorkingDay(new Date(), calendarConfig)
      const duration =
        type === 'milestone'
          ? 0
          : task.duration ?? (durationUnit === 'hour' ? calendarConfig.workingHoursPerDay || 8 : 1)
      const end =
        type === 'milestone'
          ? start
          : task.end
            ? new Date(task.end)
            : calculateEndDate(start, duration, calendarConfig, durationUnit)
      const newTask: ITask = {
        ...task,
        id: taskId,
        text: task.text || `New Task ${taskId}`,
        start,
        end,
        duration,
        progress: task.progress ?? 0,
        type,
      }

      const newTasksList = addTaskAtPlacement(tasks, newTask, target, mode)
      if (newTasksList === tasks) return
      const scheduled = isAutoSchedule
        ? autoScheduleTasks(newTasksList, links, calendarConfig, durationUnit)
        : newTasksList
      setTasks(scheduled)
      setSelectedTaskId(taskId)
      setSelectedTaskIds([taskId])
    },
    [calendarConfig, durationUnit, isAutoSchedule, links, tasks]
  )

  const handleMoveTask = useCallback(
    ({
      id,
      target,
      mode,
      inProgress,
    }: {
      id: string | number
      target?: string | number
      mode: TaskPlacementMode
      inProgress?: boolean
    }) => {
      if (inProgress) return
      const movedTasks = moveTaskAtPlacement(tasks, id, target, mode)
      if (movedTasks === tasks) return
      const scheduled = isAutoSchedule
        ? autoScheduleTasks(movedTasks, links, calendarConfig, durationUnit)
        : movedTasks
      setTasks(scheduled)
      setSelectedTaskId(id)
      setSelectedTaskIds([id])
    },
    [calendarConfig, durationUnit, isAutoSchedule, links, tasks]
  )

  const handleDeleteTask = useCallback(
    ({ id }: { id: string | number }) => {
      // SVAR fires `delete-task` once per selected task in a synchronous burst.
      // The first dispatch deletes the union of every selected subtree; later
      // dispatches carry ids that resequencing already renumbered away, so
      // they are ignored via deletedTaskIdsRef.
      if (deletedTaskIdsRef.current.has(String(id))) return

      const selection = selectedTaskIdsRef.current
      const isBatchDelete =
        selection.length > 1 && selection.some((selectedId) => sameTaskId(selectedId, id))
      const rootIds = isBatchDelete ? selection : [id]

      // Compute the deletion set from the pre-delete snapshot so every
      // selected subtree is collected before ids are resequenced.
      const idsToDelete = new Set<string>()
      for (const rootId of rootIds) {
        for (const subtreeId of collectTaskSubtreeIds(tasksRef.current, rootId)) {
          idsToDelete.add(subtreeId)
        }
      }
      for (const deletedId of idsToDelete) {
        deletedTaskIdsRef.current.add(deletedId)
      }

      // Functional updates: each dispatch in the burst must see the latest
      // state, not the render-closure `tasks`/`links`.
      let nextLinks: ILink[] | null = null
      setTasks((prevTasks) => {
        const remainingTasks = prevTasks.filter(
          (task) => task.id === undefined || !idsToDelete.has(String(task.id))
        )
        const remainingLinks = linksRef.current.filter(
          (link) =>
            !idsToDelete.has(String(link.source)) &&
            !idsToDelete.has(String(link.target))
        )
        const resequenced = resequenceProject(remainingTasks, remainingLinks, null)
        nextLinks = resequenced.links
        return isAutoSchedule
          ? autoScheduleTasks(resequenced.tasks, resequenced.links, calendarConfig, durationUnit)
          : resequenced.tasks
      })
      setLinks((prevLinks) => nextLinks ?? prevLinks)
      setSelectedTaskId(null)
      setSelectedTaskIds([])
    },
    [calendarConfig, durationUnit, isAutoSchedule]
  )

  const handleAddLink = useCallback(
    ({ link, id }: { link: Partial<ILink>; id?: string | number }) => {
      const linkId = link.id ?? id ?? Date.now()
      const fullLink: ILink = {
        id: linkId,
        source: link.source as string | number,
        target: link.target as string | number,
        type: link.type || 'e2s',
        ...(link.lag !== undefined ? { lag: link.lag } : {}),
      }
      if (
        links.some(
          (l) =>
            l.id === fullLink.id ||
            (String(l.source) === String(fullLink.source) &&
              String(l.target) === String(fullLink.target))
        )
      ) {
        return
      }
      const newLinks = [...links, fullLink]
      setLinks(newLinks)
      if (isAutoSchedule) {
        setTasks((prevTasks) =>
          autoScheduleTasks(prevTasks, newLinks, calendarConfig, durationUnit)
        )
      }
    },
    [calendarConfig, durationUnit, isAutoSchedule, links]
  )

  const handleUpdateLink = useCallback(
    ({ id, link }: { id: string | number; link: Partial<ILink> }) => {
      const updatedLinks = links.map((l) => (l.id === id ? ({ ...l, ...link } as ILink) : l))
      setLinks(updatedLinks)
      if (isAutoSchedule) {
        setTasks((prevTasks) =>
          autoScheduleTasks(prevTasks, updatedLinks, calendarConfig, durationUnit)
        )
      }
    },
    [calendarConfig, durationUnit, isAutoSchedule, links]
  )

  const handleDeleteLink = useCallback(
    ({ id }: { id: string | number }) => {
      const newLinks = links.filter((l) => l.id !== id)
      setLinks(newLinks)
      if (isAutoSchedule) {
        setTasks((prevTasks) =>
          autoScheduleTasks(prevTasks, newLinks, calendarConfig, durationUnit)
        )
      }
    },
    [calendarConfig, durationUnit, isAutoSchedule, links]
  )

  const handleAddTaskInfoPredecessor = useCallback(
    (link: { source: string | number; target: string | number; type: DependencyType }) => {
      const duplicate = links.some(
        (existingLink) =>
          String(existingLink.source) === String(link.source) &&
          String(existingLink.target) === String(link.target)
      )
      if (duplicate || String(link.source) === String(link.target)) return
      handleAddLink({ link })
    },
    [handleAddLink, links]
  )

  const handleUpdateTaskInfoPredecessor = useCallback(
    (id: string | number, link: Partial<ILink>) => {
      const currentLink = links.find((existingLink) => existingLink.id === id)
      if (
        currentLink &&
        link.source !== undefined &&
        (String(link.source) === String(currentLink.target) ||
          links.some(
            (existingLink) =>
              existingLink.id !== id &&
              String(existingLink.source) === String(link.source) &&
              String(existingLink.target) === String(currentLink.target)
          ))
      ) {
        return
      }
      handleUpdateLink({ id, link })
    },
    [handleUpdateLink, links]
  )

  const handleDeleteTaskInfoPredecessor = useCallback(
    (id: string | number) => {
      handleDeleteLink({ id })
    },
    [handleDeleteLink]
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
    const nextId = getNextNumericTaskId(tasks)
    const today = getNextWorkingDay(new Date(), calendarConfig)
    const duration = durationUnit === 'hour' ? (calendarConfig.workingHoursPerDay || 8) : 1
    const endDate = calculateEndDate(today, duration, calendarConfig, durationUnit)

    const newTask: ITask = {
      id: nextId,
      text: `New Task ${nextId}`,
      start: today,
      end: endDate,
      duration,
      progress: 0,
      type: 'task',
    }

    const newTasksList = [...tasks, newTask]
    const scheduled = isAutoSchedule
      ? autoScheduleTasks(newTasksList, links, calendarConfig, durationUnit)
      : newTasksList

    setTasks(scheduled)
    setSelectedTaskId(nextId)
    setSelectedTaskIds([nextId])
  }, [calendarConfig, durationUnit, isAutoSchedule, links, tasks])

  // Toolbar Actions: Add Milestone
  const handleAddMilestoneAction = useCallback(() => {
    const nextId = getNextNumericTaskId(tasks)
    const today = getNextWorkingDay(new Date(), calendarConfig)

    const selectedTask = selectedTaskId != null
      ? tasks.find((task) => sameTaskId(task.id, selectedTaskId))
      : null
    const selectedTaskHasChildren =
      selectedTask?.id !== undefined &&
      tasks.some((task) => sameTaskId(task.parent, selectedTask.id))
    const parentId =
      selectedTask && (selectedTask.type === 'summary' || selectedTaskHasChildren)
        ? selectedTask.id
        : selectedTask?.parent
    const allowedParentId = isTaskParentAllowed(tasks, parentId) ? parentId : undefined

    const newMilestone: ITask = {
      id: nextId,
      text: `Milestone ${nextId}`,
      start: today,
      end: today,
      duration: 0,
      progress: 0,
      type: 'milestone',
      ...(allowedParentId !== undefined ? { parent: allowedParentId } : {}),
    }

    const newTasksList = [...tasks, newMilestone]
    const scheduled = isAutoSchedule
      ? autoScheduleTasks(newTasksList, links, calendarConfig, durationUnit)
      : newTasksList

    setTasks(scheduled)
    setSelectedTaskId(nextId)
    setSelectedTaskIds([nextId])
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // Toolbar Actions: Indent Task
  const handleIndent = useCallback(() => {
    if (selectedTaskId == null) return
    const idx = tasks.findIndex((task) => sameTaskId(task.id, selectedTaskId))
    if (idx <= 0) return // First task cannot be indented

    const prevTask = tasks[idx - 1]
    if (prevTask.type === 'milestone') return
    const updatedTasks = tasks.map((t, i) => {
      if (sameTaskId(t.id, selectedTaskId)) {
        return { ...t, parent: prevTask.id }
      }
      if (i === idx - 1) {
        return { ...t, open: true }
      }
      return t
    })
    const scheduled = isAutoSchedule
      ? autoScheduleTasks(updatedTasks, links, calendarConfig, durationUnit)
      : updatedTasks
    setTasks(scheduled)
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // Toolbar Actions: Outdent Task
  const handleOutdent = useCallback(() => {
    if (selectedTaskId == null) return
    const currTask = tasks.find((task) => sameTaskId(task.id, selectedTaskId))
    if (!currTask || currTask.parent == null) return // Already root level

    // Move the complete subtree after its current parent's subtree. Updating only
    // the parent field can split that subtree and leave the Gantt store invalid.
    const movedTasks = moveTaskAtPlacement(tasks, selectedTaskId, currTask.parent, 'after')
    if (movedTasks === tasks) return

    // React state owns hierarchy changes; avoid the store action, which can dereference a stale task ID.
    const scheduled = isAutoSchedule
      ? autoScheduleTasks(movedTasks, links, calendarConfig, durationUnit)
      : movedTasks
    setTasks(scheduled)
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // Toolbar Actions: Delete Task
  const handleDeleteSelectedTask = useCallback(() => {
    if (selectedTaskId == null) return
    const idToDelete = selectedTaskId
    const idsToDelete = collectTaskSubtreeIds(tasks, idToDelete)
    const remainingTasks = tasks.filter(
      (task) => task.id === undefined || !idsToDelete.has(String(task.id))
    )
    const remainingLinks = links.filter(
      (link) =>
        !idsToDelete.has(String(link.source)) &&
        !idsToDelete.has(String(link.target))
    )
    const resequenced = resequenceProject(remainingTasks, remainingLinks, null)
    const scheduled = isAutoSchedule
      ? autoScheduleTasks(resequenced.tasks, resequenced.links, calendarConfig, durationUnit)
      : resequenced.tasks

    setTasks(scheduled)
    setLinks(resequenced.links)
    setSelectedTaskId(null)
    setSelectedTaskIds([])
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskId, tasks])

  // Toolbar Actions: Link Selected Tasks (finish-to-start chain in selection order)
  const handleLinkSelectedTasks = useCallback(() => {
    if (selectedTaskIds.length < 2) return
    const nextLinkId =
      links.length > 0 ? Math.max(...links.map((link) => Number(link.id) || 0)) + 1 : 1
    const chain = buildDependencyChain(selectedTaskIds, links, nextLinkId)
    if (chain.length === 0) return
    const newLinks = [...links, ...chain]
    setLinks(newLinks)
    if (isAutoSchedule) {
      setTasks((prevTasks) =>
        autoScheduleTasks(prevTasks, newLinks, calendarConfig, durationUnit)
      )
    }
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskIds])

  // Toolbar Actions: Unlink Selected Tasks (remove all dependencies touching them)
  const handleUnlinkSelectedTasks = useCallback(() => {
    if (selectedTaskIds.length === 0) return
    const newLinks = removeLinksTouching(links, selectedTaskIds)
    if (newLinks.length === links.length) return
    setLinks(newLinks)
    if (isAutoSchedule) {
      setTasks((prevTasks) =>
        autoScheduleTasks(prevTasks, newLinks, calendarConfig, durationUnit)
      )
    }
  }, [calendarConfig, durationUnit, isAutoSchedule, links, selectedTaskIds])

  // File Menu: Export CSV
  const handleExportCsv = useCallback(() => {
    const blob = new Blob([serializeGanttCsv(tasks, links, resourceList)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ms-project-schedule-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }, [links, resourceList, tasks])

  const handleImportFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (loadEvent) => {
      try {
        const rawContent = loadEvent.target?.result
        if (typeof rawContent !== 'string') return
        const parsed = parseCsv(rawContent)
        const headers = parsed[0] ?? []
        const rows = parsed.slice(1)
        if (headers.length === 0 || headers.every((header) => header.trim() === '')) {
          alert('Invalid CSV: A header row is required.')
          return
        }
        setCsvImportData({ fileName: file.name, headers, rows })
      } catch {
        alert('Failed to read CSV file. Please ensure it contains a valid header row.')
      } finally {
        event.target.value = ''
      }
    }
    reader.readAsText(file)
  }, [])

  const handleImportCsv = useCallback(
    (mapping: CsvTaskMapping) => {
      if (!csvImportData) return
      const result = importGanttCsv(csvImportData, mapping, calendarConfig, durationUnit, isAutoSchedule, resourceList)
      if (result.kind === 'no-importable-rows') {
        alert('No importable task rows were found. Map a task name column or provide non-empty rows.')
        return
      }
      if (result.resources.length !== resourceList.length) setResourceList(result.resources)
      setTasks(result.tasks)
      setLinks(result.links)
      setSelectedTaskId(null)
      setSelectedTaskIds([])
      setCsvImportData(null)
    },
    [calendarConfig, csvImportData, durationUnit, isAutoSchedule, resourceList]
  )
  const handleClipboardConfirm = useCallback(
    (mapping: CsvTaskMapping) => {
      if (!clipboardImportData) return
      const result = applyGanttPaste(
        clipboardImportData,
        mapping,
        { tasks, links, resources: resourceList },
        calendarConfig,
        durationUnit,
        isAutoSchedule
      )
      if (result.kind === 'no-importable-rows') {
        alert('No importable task rows were found. Map a task name column or provide non-empty rows.')
        return
      }
      if (result.resources.length !== resourceList.length) setResourceList(result.resources)
      setTasks(result.tasks)
      setLinks(result.links)
      setSelectedTaskId(null)
      setSelectedTaskIds([])
      setClipboardImportData(null)
    },
    [calendarConfig, clipboardImportData, durationUnit, isAutoSchedule, links, resourceList, tasks]
  )

  const canPasteFromClipboard =
    viewMode === 'gantt' &&
    activeTab !== 'resources' &&
    !csvImportData &&
    !clipboardImportData &&
    !isCalendarDialogOpen &&
    !isColumnChooserOpen

  const handlePasteFromMenu = useCallback(() => {
    if (!canPasteFromClipboard) return
    if (!navigator.clipboard) {
      alert('Clipboard access denied. Press Ctrl+V on the grid instead.')
      return
    }
    navigator.clipboard
      .readText()
      .then((text) => {
        const parsed = parseClipboardTable(text)
        if (parsed) setClipboardImportData(parsed)
        else alert('Clipboard is empty or does not contain tabular data.')
      })
      .catch(() => alert('Clipboard access denied. Press Ctrl+V on the grid instead.'))
  }, [canPasteFromClipboard])

  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      if (!canPasteFromClipboard) return
      const target = event.target as HTMLElement | null
      if (
        target?.closest?.(
          'input, textarea, select, [contenteditable], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]'
        )
      ) {
        return
      }
      const text = event.clipboardData?.getData('text/plain')
      const parsed = text ? parseClipboardTable(text) : null
      if (parsed) {
        event.preventDefault()
        setClipboardImportData(parsed)
      }
    }
    document.addEventListener('paste', handler)
    return () => document.removeEventListener('paste', handler)
  }, [canPasteFromClipboard])


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
    setSelectedTaskIds([])
    setResourceList(sampleResources)
  }, [calendarConfig, durationUnit, isAutoSchedule])

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

  const handleOpenColumnChooser = useCallback(() => {
    setIsColumnChooserOpen(true)
  }, [])

  const handleAddWorkColumn = useCallback(() => {
    setIsWorkColumnVisible(true)
    setIsColumnChooserOpen(false)
  }, [])
  const totalTasks = tasks.filter((t) => t.type !== 'summary').length
  const summaryTasks = tasks.filter((t) => t.type === 'summary').length
  const completedTasks = tasks.filter((t) => t.progress === 100).length
  const critical = useMemo(
    () => (showCriticalPath ? computeCriticalPath(tasks, links, calendarConfig, durationUnit) : null),
    [showCriticalPath, tasks, links, calendarConfig, durationUnit]
  )
  const displayTasks = useMemo(
    () => (critical ? tasks.map((t) => (t.id !== undefined && critical.taskIds.has(String(t.id)) ? { ...t, critical: true } : t)) : tasks),
    [critical, tasks]
  )
  const displayLinks = useMemo(
    () => (critical ? links.map((l) => (l.id !== undefined && critical.linkIds.has(String(l.id)) ? { ...l, critical: true } : l)) : links),
    [critical, links]
  )

  const selectedTaskIndex =
    selectedTaskId != null ? tasks.findIndex((task) => sameTaskId(task.id, selectedTaskId)) : -1
  const selectedTask = selectedTaskIndex >= 0 ? tasks[selectedTaskIndex] : null
  const canIndent = selectedTaskIndex > 0 && tasks[selectedTaskIndex - 1]?.type !== 'milestone'
  const canOutdent = selectedTask != null && selectedTask.parent != null
  const canLink = selectedTaskIds.length >= 2
  const canUnlink = links.some((link) =>
    selectedTaskIds.some((id) => sameTaskId(link.source, id) || sameTaskId(link.target, id))
  )

  return {
    state: { calendarConfig, setCalendarConfig, isAutoSchedule, setIsAutoSchedule, isCalendarDialogOpen, setIsCalendarDialogOpen, csvImportData, setCsvImportData, clipboardImportData, setClipboardImportData, isColumnChooserOpen, setIsColumnChooserOpen, isWorkColumnVisible, setIsWorkColumnVisible, isGanttVisible, showCriticalPath, viewMode, activeTab, setActiveTab, selectedTaskId, setSelectedTaskId, selectedTaskIds, setSelectedTaskIds, durationUnit, setDurationUnit, zoom, setZoom, tasks, setTasks, links, setLinks, resourceList, setResourceList },
    derived: { totalTasks, summaryTasks, completedTasks, selectedTaskIndex, selectedTask, canIndent, canOutdent, canLink, canUnlink, displayTasks, displayLinks },
    actions: { handleTaskSelection, handleInit, handleUpdateTask, handleResourceChange, handleAddResource, handleDeleteResource, handleToggleTaskResource, handleTaskInfoChange, handleResourcesChange, handleAddTask, handleMoveTask, handleDeleteTask, handleAddLink, handleUpdateLink, handleDeleteLink, handleAddTaskInfoPredecessor, handleUpdateTaskInfoPredecessor, handleDeleteTaskInfoPredecessor, handleSaveCalendar, handleToggleAutoSchedule, handleToggleGanttVisibility, handleToggleCriticalPath, handleViewModeChange, handleDurationUnitChange, handleHighlightTime, handleAddTaskAction, handleAddMilestoneAction, handleIndent, handleOutdent, handleDeleteSelectedTask, handleLinkSelectedTasks, handleUnlinkSelectedTasks, handleExportCsv, handleImportFile, handleImportCsv, handleClipboardConfirm, handlePasteFromMenu, handleNewProject, handleDurationChange, handleStartDateChange, handleFinishDateChange, handleOpenColumnChooser, handleAddWorkColumn },
    gantt: { api, ganttResources, scalePresets },
    fileInputRef,
  }
}
