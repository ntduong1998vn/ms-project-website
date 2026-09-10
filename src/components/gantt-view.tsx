import { useCallback, useMemo, useRef, useState } from 'react'
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
import {
  sampleLinks,
  sampleResources,
  sampleTasks,
} from '@/data/sample-gantt-data'
import type { GanttTask } from '@/types/gantt'
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  FolderKanban,
  Layers,
  Users,
} from 'lucide-react'

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

function calculateDuration(start: Date, end: Date, unit: 'day' | 'hour'): number {
  const diffMs = end.getTime() - start.getTime()
  if (diffMs <= 0) return 0
  if (unit === 'hour') {
    return Math.round(diffMs / (1000 * 60 * 60))
  }
  return Math.round(diffMs / (1000 * 60 * 60 * 24))
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

const scalePresets: Record<string, IScaleConfig[]> = {
  hour: [
    { unit: 'day', step: 1, format: '%d %M %Y' },
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

export function GanttView() {
  const [tasks, setTasks] = useState<ITask[]>(sampleTasks as unknown as ITask[])
  const [links, setLinks] = useState<ILink[]>(sampleLinks as unknown as ILink[])
  const [zoom, setZoom] = useState<ZoomMode>('day')
  const [durationUnit, setDurationUnit] = useState<'day' | 'hour'>('day')
  const [api, setApi] = useState<IApi | null>(null)
  const apiRef = useRef<IApi | null>(null)

  const handleInit = useCallback((apiInstance: IApi) => {
    apiRef.current = apiInstance
    setApi(apiInstance)
  }, [])

  const handleUpdateTask = useCallback(
    ({ id, task, inProgress }: { id: string | number; task: Partial<ITask> & { predecessors?: string | number }; inProgress?: boolean }) => {
      if (inProgress) return

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

        setLinks((prev) => {
          const remainingLinks = prev.filter((l) => String(l.target) !== String(id))
          let nextId = prev.length > 0 ? Math.max(...prev.map((l) => Number(l.id) || 0)) + 1 : 1

          const newLinks: ILink[] = sourceIds.map((srcId) => {
            const existing = prev.find(
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

          return [...remainingLinks, ...newLinks]
        })
      }

      setTasks((prev) =>
        prev.map((t) => (t.id === id ? ({ ...t, ...task } as ITask) : t))
      )
    },
    []
  )

  const handleAddTask = useCallback(
    ({ task }: { task: ITask }) => {
      setTasks((prev) => [...prev, task])
    },
    []
  )

  const handleDeleteTask = useCallback(
    ({ id }: { id: string | number }) => {
      setTasks((prev) => prev.filter((t) => t.id !== id))
    },
    []
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
        if (prev.some((l) => l.id === fullLink.id || (String(l.source) === String(fullLink.source) && String(l.target) === String(fullLink.target)))) {
          return prev
        }
        return [...prev, fullLink]
      })
    },
    []
  )

  const handleUpdateLink = useCallback(
    ({ id, link }: { id: string | number; link: Partial<ILink> }) => {
      setLinks((prev) =>
        prev.map((l) => (l.id === id ? ({ ...l, ...link } as ILink) : l))
      )
    },
    []
  )

  const handleDeleteLink = useCallback(
    ({ id }: { id: string | number }) => {
      setLinks((prev) => prev.filter((l) => l.id !== id))
    },
    []
  )


  const handleDurationUnitChange = useCallback(
    (newUnit: 'day' | 'hour') => {
      if (newUnit === durationUnit) return
      setDurationUnit(newUnit)

      // Convert task durations smoothly based on start and end dates
      setTasks((prev) =>
        prev.map((t) => {
          if (t.type === 'milestone') {
            return { ...t, duration: 0 }
          }
          if (!t.start || !t.end) return t
          const startDate = new Date(t.start)
          const endDate = new Date(t.end)
          const newDuration = calculateDuration(startDate, endDate, newUnit)
          return {
            ...t,
            duration: newDuration,
          }
        })
      )
    },
    [durationUnit]
  )

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
            style={{
              fontWeight: 600,
              fontSize: '0.82rem',
              color: '#6b7280',
              display: 'inline-block',
              width: '100%',
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
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
        editor: 'text',
      },
      {
        id: 'start',
        header: 'Start',
        width: 110,
        align: 'center',
        sort: true,
        editor: 'datepicker',
        template: (d: Date | string) => formatDate(d),
      },
      {
        id: 'end',
        header: 'Finish',
        width: 110,
        align: 'center',
        sort: true,
        editor: 'datepicker',
        template: (d: Date | string) => formatDate(d),
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
    [durationUnit, links]
  )

  const totalTasks = tasks.filter((t) => t.type !== 'summary').length
  const summaryTasks = tasks.filter((t) => t.type === 'summary').length
  const completedTasks = tasks.filter((t) => t.progress === 100).length

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground">
      {/* MS Project Top Ribbon Header */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card px-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-primary-foreground">
            <FolderKanban className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">MS Project Web</h1>
            <p className="text-[11px] text-muted-foreground">Website Redesign & Launch Plan</p>
          </div>
        </div>

        {/* Status Chips */}
        <div className="hidden items-center gap-4 text-xs text-muted-foreground md:flex">
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
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
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

        {/* Duration Unit & Zoom Controls */}
        <div className="flex items-center gap-2">
          {/* Duration Unit Toggle */}
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Duration:</span>
            </span>
            <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => handleDurationUnitChange('day')}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  durationUnit === 'day'
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Days
              </button>
              <button
                type="button"
                onClick={() => handleDurationUnitChange('hour')}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  durationUnit === 'hour'
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Hours
              </button>
            </div>
          </div>

          <div className="hidden h-4 w-px bg-border sm:block" />

          {/* Zoom Controls */}
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setZoom('hour')}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                zoom === 'hour'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Hour
            </button>
            <button
              type="button"
              onClick={() => setZoom('day')}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                zoom === 'day'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => setZoom('week')}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                zoom === 'week'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Week
            </button>
            <button
              type="button"
              onClick={() => setZoom('month')}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                zoom === 'month'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Month
            </button>
          </div>
        </div>
      </header>

      {/* Main Gantt View Area (Left Table + Right Timeline) */}
      <main className="relative min-h-0 flex-1 w-full overflow-hidden">
        <Willow>
          <Gantt
            init={handleInit}
            tasks={tasks}
            links={links}
            resources={resources}
            scales={scalePresets[zoom]}
            columns={columns}
            durationUnit={durationUnit}
            cellHeight={35}
            scaleHeight={30}
            cellWidth={zoom === 'hour' ? 60 : 100}
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
    </div>
  )
}
