import { createContext, useContext } from 'react'

export type EditableCellField = 'start' | 'end'

export type EditingCell = {
  taskId: string | number
  field: EditableCellField
}

/**
 * Per-cell state that changes far more often than the column layout.
 *
 * It travels through context instead of `useGanttColumns` closures because SVAR
 * renders `column.cell` as a component: putting these in the columns memo gives
 * every cell a new component type on each change, which remounts the whole
 * visible grid — and would tear down an open editor the moment it opens.
 */
export type GanttCellContextValue = {
  selectedTaskId: string | number | null
  editingCell: EditingCell | null
  onSelectTask: (id: string | number) => void
  onEditCell: (cell: EditingCell | null) => void
}

export const GanttCellContext = createContext<GanttCellContextValue | null>(null)

export function useGanttCell(): GanttCellContextValue {
  const value = useContext(GanttCellContext)
  if (!value) {
    throw new Error('Gantt cell components must render inside <GanttCellContext>')
  }
  return value
}
