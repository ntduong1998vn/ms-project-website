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
  TaskIdCell,
  WorkCell,
} from '@/components/gantt/gantt-cells'
import { ColumnFilterHeader } from '@/components/gantt/column-filter-header'
import { getResourceEffortWarnings } from '@/lib/resource-effort'
import { collectDistinctOptions, taskTextFilter, workHours } from '@/lib/gantt-filters'
import type { ProjectCalendarConfig } from '@/lib/scheduler'
import type { GanttResource, TaskWithResources } from '@/types/gantt'
import type { RemoteFieldDescriptor } from '@/lib/integrations/types'

export type UseGanttColumnsOptions = {
  tasks: ITask[]
  links: ILink[]
  resources: GanttResource[]
  calendarConfig: ProjectCalendarConfig
  durationUnit: 'day' | 'hour'
  isWorkColumnVisible: boolean
  visibleRemoteColumns: string[]
  remoteFields: RemoteFieldDescriptor[]
  ganttApi: IApi | null
  onSelectTask: (id: string | number) => void
  onDurationChange: (id: string | number, duration: number) => void
  onStartDateChange: (id: string | number, date: Date) => void
  onFinishDateChange: (id: string | number, date: Date) => void
  onResourcesChange: (id: string | number, resourceIds: number[]) => void
  onOpenColumnChooser: () => void
}

export function useGanttColumns({
  tasks,
  links,
  resources,
  calendarConfig,
  durationUnit,
  isWorkColumnVisible,
  visibleRemoteColumns,
  remoteFields,
  ganttApi,
  onSelectTask,
  onDurationChange,
  onStartDateChange,
  onFinishDateChange,
  onResourcesChange,
  onOpenColumnChooser,
}: UseGanttColumnsOptions): IColumnConfig[] {
  const warningsByTask = useMemo(
    () => getResourceEffortWarnings(tasks, resources, calendarConfig, durationUnit),
    [calendarConfig, durationUnit, resources, tasks]
  )

  return useMemo(
    () => {
      const textOptions = collectDistinctOptions(tasks, (t) => t.text)
      const resourceOptions = resources.map((r) => r.label).sort()
      const hasResourceBlank = tasks.some(
        (t) => !((t as TaskWithResources).resources?.length ?? 0)
      )
      const predecessorGetter = (task: ITask) =>
        links
          .filter((link) => String(link.target) === String(task.id))
          .map((link) => String(link.source))
      const predecessorOptions = collectDistinctOptions(tasks, predecessorGetter)

      const headerCell = (
        title: string,
        cfg: { sortable?: boolean; filterable?: boolean; options?: string[]; hasBlank?: boolean }
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
            options: cfg.options ?? [],
            hasBlank: cfg.hasBlank ?? false,
            ganttApi,
          }),
      })

      const columns: IColumnConfig[] = [
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
          header: headerCell('ID', { sortable: true }),
          width: 50,
          align: 'center',
          sort: true,
          cell: TaskIdCell as unknown as IColumnConfig['cell'],
        },
        {
          id: 'text',
          header: {
            ...headerCell('Task Name', {
              sortable: true,
              filterable: true,
              options: textOptions.options,
              hasBlank: textOptions.hasBlank,
            }),
            filter: { type: 'text' as const, config: { handler: taskTextFilter } },
          },
          width: 220,
          flexgrow: 2,
          sort: true,
          editor: 'text',
        },
        {
          id: 'duration',
          header: headerCell(`Duration (${durationUnit === 'day' ? 'days' : 'hrs'})`, { sortable: true }),
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
          header: headerCell('Start', { sortable: true }),
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
          header: headerCell('Finish', { sortable: true }),
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
            }),
            filter: { type: 'text' as const, config: { handler: taskTextFilter } },
          },
          width: 100,
          align: 'center',
          editor: 'text',
          cell: (({ row }: { row: TaskWithResources }) => (
            <PredecessorCell row={row} links={links} />
          )) as unknown as IColumnConfig['cell'],
        },
        {
          id: 'resources',
          getter: (task: ITask) =>
            ((task as TaskWithResources).resources ?? [])
              .map((id) => resources.find((r) => r.id === id)?.label)
              .filter((v): v is string => Boolean(v)),
          sort: false,
          header: {
            ...headerCell('Resource Names', {
              filterable: true,
              options: resourceOptions,
              hasBlank: hasResourceBlank,
            }),
            filter: { type: 'text' as const, config: { handler: taskTextFilter } },
          },
          width: 150,
          cell: (({ row }: { row: TaskWithResources }) => (
            <ResourceNamesCell
              row={row}
              resources={resources}
              onResourcesChange={onResourcesChange}
            />
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
        columns.splice(4, 0, {
          id: 'work',
          header: headerCell('Work', { sortable: true }),
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

      const remoteColumns: IColumnConfig[] = visibleRemoteColumns
        .map((key) => remoteFields.find((field) => field.key === key))
        .filter((field): field is RemoteFieldDescriptor => field !== undefined)
        .map((field) => {
          const options = field.options
          return {
            // 'description' is unified on task.details: the gantt's update-cell
            // intercept writes task[column.id] directly (column setters are
            // dropped by normalizeColumns), so the column id must be 'details'.
            id: field.key === 'description' ? 'details' : field.key,
            header: headerCell(field.label, { sortable: true }),
            width: 110,
            align: 'center' as const,
            sort: true,
            // Enumerated fields get a dropdown editor. Options must live in
            // editor.config.options, NOT column.options: grid-store builds an
            // optionsMap from column.options and maps the getter result through
            // it, which would double-map since labels are resolved by the cell.
            editor: options?.length
              ? { type: 'richselect' as const, config: { options } }
              : ('text' as const),
            // Raw stored value — the richselect editor seeds itself from the
            // getter and writes back an option id; labels are display-only via
            // the cell below.
            getter: (task: ITask) => remoteFieldRawValue(task, field),
            cell: (({ row }: { row: ITask }) => (
              <RemoteFieldCell row={row} field={field} />
            )) as unknown as IColumnConfig['cell'],
          }
        })
      if (remoteColumns.length > 0) {
        const addTaskIndex = columns.findIndex((column) => column.id === 'add-task')
        columns.splice(addTaskIndex === -1 ? columns.length : addTaskIndex, 0, ...remoteColumns)
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
      onOpenColumnChooser,
      onResourcesChange,
      onSelectTask,
      onFinishDateChange,
      onStartDateChange,
      resources,
      tasks,
      warningsByTask,
      remoteFields,
      visibleRemoteColumns,
    ]
  )
}

// Remote-column values are stored raw on the task: option ids for enumerated
// fields, '; '-joined strings for multi-value custom fields, and
// Array<{ key, delay }> for 'successors'.
function remoteFieldRawValue(task: ITask, field: RemoteFieldDescriptor): unknown {
  // 'description' is unified on task.details (the canonical mapped field).
  return field.key === 'description'
    ? task.details
    : (task as Record<string, unknown>)[field.key]
}

function formatRemoteFieldValue(raw: unknown, field: RemoteFieldDescriptor): string {
  if (raw == null || raw === '') return ''
  const resolve = (value: unknown): string => {
    const match = field.options?.find((o) => String(o.id) === String(value))
    return match?.label ?? String(value)
  }
  if (Array.isArray(raw)) {
    // 'successors' stores relation rows — render "key (+delay)", never
    // "[object Object]".
    return raw
      .map((entry) => {
        if (entry !== null && typeof entry === 'object' && 'key' in entry) {
          const relation = entry as { key: unknown; delay?: unknown }
          const delay = typeof relation.delay === 'number' ? relation.delay : 0
          return `${relation.key} (+${delay})`
        }
        return resolve(entry)
      })
      .join(', ')
  }
  if (field.multiple && typeof raw === 'string') {
    return raw.split('; ').map(resolve).join('; ')
  }
  return resolve(raw)
}

function RemoteFieldCell({ row, field }: { row: ITask; field: RemoteFieldDescriptor }) {
  return <>{formatRemoteFieldValue(remoteFieldRawValue(row, field), field)}</>
}
