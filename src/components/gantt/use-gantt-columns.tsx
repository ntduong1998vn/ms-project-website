import { useMemo } from 'react'
import { type IColumnConfig, type ILink, type ITask, type IApi } from '@svar-ui/react-gantt'
import { TriangleAlert } from 'lucide-react'
import {
  AddColumnHeaderCell,
  AddTaskCell,
  DurationCell,
  EffortWarningCell,
  FinishDateCell,
  PredecessorCell,
  ResourceNamesCell,
  StartDateCell,
  WorkCell,
} from '@/components/gantt/gantt-cells'
import { ColumnFilterHeader, type ColumnFilterKind } from '@/components/gantt/column-filter-header'
import { getResourceEffortWarnings } from '@/lib/resource-effort'
import { sameTaskId } from '@/lib/task-helpers'
import {
  QUICK_FILTER_COLUMN_ID,
  collectDistinctOptions,
  taskDateFilter,
  taskFinishDate,
  taskNumberFilter,
  taskQuickFilter,
  taskTextFilter,
  workHours,
} from '@/lib/gantt-filters'
import type { ProjectCalendarConfig } from '@/lib/scheduler'
import type { GanttResource, TaskWithResources } from '@/types/gantt'

export type UseGanttColumnsOptions = {
  tasks: ITask[]
  links: ILink[]
  resources: GanttResource[]
  calendarConfig: ProjectCalendarConfig
  durationUnit: 'day' | 'hour'
  isWorkColumnVisible: boolean
  selectedTaskId: string | number | null
  ganttApi: IApi | null
  onSelectTask: (id: string | number) => void
  onDurationChange: (id: string | number, duration: number) => void
  onStartDateChange: (id: string | number, date: Date) => void
  onFinishDateChange: (id: string | number, date: Date) => void
  onOpenColumnChooser: () => void
}

export function useGanttColumns({
  tasks,
  links,
  resources,
  calendarConfig,
  durationUnit,
  isWorkColumnVisible,
  selectedTaskId,
  ganttApi,
  onSelectTask,
  onDurationChange,
  onStartDateChange,
  onFinishDateChange,
  onOpenColumnChooser,
}: UseGanttColumnsOptions): IColumnConfig[] {
  const warningsByTask = useMemo(
    () => getResourceEffortWarnings(tasks, resources, calendarConfig, durationUnit),
    [calendarConfig, durationUnit, resources, tasks]
  )

  return useMemo(
    () => {
      const textOptions = collectDistinctOptions(tasks, (t) => t.text)
      const resourceGetter = (task: ITask) =>
        ((task as TaskWithResources).resources ?? [])
          .map((id) => resources.find((r) => r.id === id)?.label)
          .filter((v): v is string => Boolean(v))
      const resourceUsage = collectDistinctOptions(tasks, resourceGetter)
      const resourceOptions = resources.map((r) => r.label).sort()
      const predecessorGetter = (task: ITask) =>
        links
          .filter((link) => String(link.target) === String(task.id))
          .map((link) => String(link.source))
      const predecessorOptions = collectDistinctOptions(tasks, predecessorGetter)

      const headerCell = (
        title: string,
        cfg: {
          sortable?: boolean
          filterable?: boolean
          kind?: ColumnFilterKind
          options?: string[]
          hasBlank?: boolean
          counts?: Record<string, number>
        }
      ) => ({
        text: title,
        cell: (props: {
          api: {
            getState: () => {
              filterValues?: Record<string, unknown>
              sortMarks?: Record<string, { order?: 'asc' | 'desc' }>
            }
            exec: (action: string, params?: unknown) => Promise<unknown>
          }
          column: { id?: string | number }
        }) =>
          ColumnFilterHeader({
            ...props,
            title,
            sortable: cfg.sortable ?? false,
            filterable: cfg.filterable ?? false,
            kind: cfg.kind,
            options: cfg.options ?? [],
            hasBlank: cfg.hasBlank ?? false,
            counts: cfg.counts,
            ganttApi,
          }),
      })

      const textFilter = { type: 'text' as const, config: { handler: taskTextFilter } }
      const numberFilter = { type: 'text' as const, config: { handler: taskNumberFilter } }
      const dateFilter = { type: 'text' as const, config: { handler: taskDateFilter } }

      const columns: IColumnConfig[] = [
        {
          // Hidden carrier for the filter bar's preset + search, so it combines with column filters.
          id: QUICK_FILTER_COLUMN_ID,
          hidden: true,
          width: 0,
          sort: false,
          getter: (task: ITask) => task,
          header: { text: '', filter: { type: 'text' as const, config: { handler: taskQuickFilter } } },
        },
        {
          id: 'effortWarning',
          header: {
            text: '',
            cell: () => (
              <span title="Resource effort overlap warnings" aria-label="Resource effort overlap warnings">
                <TriangleAlert className="mx-auto h-3.5 w-3.5 text-destructive" aria-hidden="true" />
              </span>
            ),
          },
          width: 42,
          align: 'center',
          sort: false,
          cell: (({ row }: { row: TaskWithResources }) => (
            <EffortWarningCell row={row} warningsByTask={warningsByTask} />
          )) as unknown as IColumnConfig['cell'],
        },
        {
          id: 'id',
          header: {
            ...headerCell('ID', { sortable: true, filterable: true, kind: 'number' }),
            filter: numberFilter,
          },
          width: 50,
          align: 'center',
          sort: true,
          cell: (({ row }: { row: TaskWithResources }) => (
            <span
              onClick={() => onSelectTask(row.id)}
              style={{
                fontWeight: 600,
                fontSize: '0.82rem',
                color: selectedTaskId != null && sameTaskId(selectedTaskId, row.id) ? '#107c41' : '#6b7280',
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
          header: {
            ...headerCell('Task Name', {
              sortable: true,
              filterable: true,
              options: textOptions.options,
              hasBlank: textOptions.hasBlank,
              counts: textOptions.counts,
            }),
            filter: textFilter,
          },
          width: 220,
          flexgrow: 2,
          sort: true,
          editor: 'text',
        },
        {
          id: 'duration',
          header: {
            ...headerCell(`Duration (${durationUnit === 'day' ? 'days' : 'hrs'})`, {
              sortable: true,
              filterable: true,
              kind: 'number',
            }),
            filter: numberFilter,
          },
          width: 100,
          align: 'center',
          sort: true,
          cell: (({ row }: { row: TaskWithResources }) => (
            <DurationCell
              row={row}
              onDurationChange={onDurationChange}
              onSelect={onSelectTask}
            />
          )) as unknown as IColumnConfig['cell'],
        },
        {
          id: 'start',
          header: { ...headerCell('Start', { sortable: true, filterable: true, kind: 'date' }), filter: dateFilter },
          width: 125,
          align: 'center',
          sort: true,
          cell: (({ row }: { row: TaskWithResources }) => (
            <StartDateCell
              row={row}
              onDateChange={onStartDateChange}
              onSelect={onSelectTask}
            />
          )) as unknown as IColumnConfig['cell'],
        },
        {
          id: 'end',
          header: { ...headerCell('Finish', { sortable: true, filterable: true, kind: 'date' }), filter: dateFilter },
          getter: taskFinishDate,
          width: 125,
          align: 'center',
          sort: true,
          cell: (({ row }: { row: TaskWithResources }) => (
            <FinishDateCell
              row={row}
              onDateChange={onFinishDateChange}
              onSelect={onSelectTask}
            />
          )) as unknown as IColumnConfig['cell'],
        },
        {
          id: 'predecessors',
          getter: predecessorGetter,
          sort: false,
          header: {
            ...headerCell('Predecessors', {
              filterable: true,
              options: predecessorOptions.options,
              hasBlank: predecessorOptions.hasBlank,
              counts: predecessorOptions.counts,
            }),
            filter: textFilter,
          },
          width: 100,
          align: 'center',
          editor: 'text',
          cell: (({ row }: { row: TaskWithResources }) => (
            <PredecessorCell row={row} links={links} />
          )) as unknown as IColumnConfig['cell'],
        },
        {
          id: 'resourceNames',
          getter: resourceGetter,
          sort: false,
          header: {
            ...headerCell('Resource Names', {
              filterable: true,
              options: resourceOptions,
              hasBlank: resourceUsage.hasBlank,
              counts: resourceUsage.counts,
            }),
            filter: textFilter,
          },
          width: 150,
          cell: (({ row }: { row: TaskWithResources }) => (
            <ResourceNamesCell row={row} resources={resources} />
          )) as unknown as IColumnConfig['cell'],
        },
        {
          id: 'add-task',
          header: {
            text: '',
            cell: () => <AddColumnHeaderCell onOpen={onOpenColumnChooser} />,
          },
          cell: AddTaskCell as unknown as IColumnConfig['cell'],
          width: 38,
          align: 'center',
        },
      ]

      if (isWorkColumnVisible) {
        columns.splice(5, 0, {
          id: 'work',
          header: {
            ...headerCell('Work', { sortable: true, filterable: true, kind: 'number' }),
            filter: numberFilter,
          },
          width: 90,
          align: 'center',
          sort: true,
          getter: (task: ITask) => workHours(task, durationUnit, calendarConfig.workingHoursPerDay),
          cell: (({ row }: { row: TaskWithResources }) => (
            <WorkCell
              row={row}
              workingHoursPerDay={calendarConfig.workingHoursPerDay}
              durationUnit={durationUnit}
            />
          )) as unknown as IColumnConfig['cell'],
        })
      }

      return columns
    },
    [
      calendarConfig,
      durationUnit,
      ganttApi,
      isWorkColumnVisible,
      links,
      onDurationChange,
      onFinishDateChange,
      onOpenColumnChooser,
      onSelectTask,
      onStartDateChange,
      resources,
      selectedTaskId,
      tasks,
      warningsByTask,
    ]
  )
}
