export type CsvTaskField = 'id' | 'text' | 'start' | 'end' | 'duration' | 'type' | 'progress' | 'parent' | 'resources' | 'predecessors' | 'predecessorTypes'
export type CsvTaskMapping = Record<CsvTaskField, number | null>

export interface CsvImportData {
  fileName: string
  headers: string[]
  rows: string[][]
}
