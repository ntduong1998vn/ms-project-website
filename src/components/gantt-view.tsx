import { useState } from 'react'
import {
  Gantt,
  Willow,
  type IColumnConfig,
  type ILink,
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

function PredecessorCell({ row }: { row: GanttTask }) {
  const incoming = sampleLinks.filter((l) => l.target === row.id)
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

function StartCell({ row }: { row: GanttTask }) {
  return <span>{formatDate(row.start)}</span>
}

function FinishCell({ row }: { row: GanttTask }) {
  return <span>{formatDate(row.end)}</span>
}

const scalePresets: Record<string, IScaleConfig[]> = {
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

type ZoomMode = keyof typeof scalePresets

export function GanttView() {
  const [tasks] = useState<ITask[]>(sampleTasks as unknown as ITask[])
  const [links] = useState<ILink[]>(sampleLinks as unknown as ILink[])
  const [zoom, setZoom] = useState<ZoomMode>('day')

  const columns: IColumnConfig[] = [
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
      header: 'Duration',
      width: 80,
      align: 'center',
      sort: true,
      editor: 'text',
    },
    {
      id: 'start',
      header: 'Start',
      width: 105,
      align: 'center',
      sort: true,
      editor: 'datepicker',
      cell: StartCell as unknown as IColumnConfig['cell'],
    },
    {
      id: 'end',
      header: 'Finish',
      width: 105,
      align: 'center',
      sort: true,
      editor: 'datepicker',
      cell: FinishCell as unknown as IColumnConfig['cell'],
    },
    {
      id: 'predecessors',
      header: 'Predecessors',
      width: 100,
      align: 'center',
      cell: PredecessorCell as unknown as IColumnConfig['cell'],
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
  ]

  const totalTasks = tasks.filter((t) => t.type !== 'summary').length
  const summaryTasks = tasks.filter((t) => t.type === 'summary').length
  const completedTasks = tasks.filter((t) => t.progress === 100).length

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background text-foreground select-none">
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

        {/* Zoom & View Controls */}
        <div className="flex items-center gap-1 rounded-md border border-border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => setZoom('day')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
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
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
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
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              zoom === 'month'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Month
          </button>
        </div>
      </header>

      {/* Main Gantt View Area (Left Table + Right Timeline) */}
      <main className="relative min-h-0 flex-1 w-full overflow-hidden">
        <Willow>
          <Gantt
            tasks={tasks}
            links={links}
            scales={scalePresets[zoom]}
            columns={columns}
            cellHeight={35}
            scaleHeight={30}
          />
        </Willow>
      </main>
    </div>
  )
}
