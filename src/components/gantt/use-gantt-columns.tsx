import { useMemo } from 'react'
import { type IColumnConfig, type ILink, type ITask } from '@svar-ui/react-gantt'
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
import { getResourceEffortWarnings } from '@/lib/resource-effort'
import { sameTaskId } from '@/lib/task-helpers'
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
    () => [
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
        cell: (({ row }: { row: TaskWithResources }) => (
          <EffortWarningCell row={row} warningsByTask={warningsByTask} />
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'id',
        header: 'ID',
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
        cell: (({ row }: { row: TaskWithResources }) => (
          <DurationCell
            row={row}
            onDurationChange={onDurationChange}
            onSelect={onSelectTask}
          />
        )) as unknown as IColumnConfig['cell'],
      },
      ...(isWorkColumnVisible
        ? [
            {
              id: 'work',
              header: 'Work',
              width: 90,
              align: 'center' as const,
              cell: (({ row }: { row: TaskWithResources }) => (
                <WorkCell
                  row={row}
                  workingHoursPerDay={calendarConfig.workingHoursPerDay}
                  durationUnit={durationUnit}
                />
              )) as unknown as IColumnConfig['cell'],
            },
          ]
        : []),
      {
        id: 'start',
        header: 'Start',
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
        header: 'Finish',
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
        header: 'Predecessors',
        width: 100,
        align: 'center',
        editor: 'text',
        cell: (({ row }: { row: TaskWithResources }) => (
          <PredecessorCell row={row} links={links} />
        )) as unknown as IColumnConfig['cell'],
      },
      {
        id: 'resourceNames',
        header: 'Resource Names',
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
    ],
    [
      calendarConfig,
      durationUnit,
      onDurationChange,
      onFinishDateChange,
      onOpenColumnChooser,
      onStartDateChange,
      isWorkColumnVisible,
      links,
      resources,
      warningsByTask,
      selectedTaskId,
      onSelectTask,
    ]
  )
}
