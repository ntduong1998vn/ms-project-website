import type { CsvImportData } from '@/types/gantt-csv'

const HEADER_ALIASES: Record<string, true> = {
  id: true,
  taskid: true,
  tasknumber: true,
  number: true,
  text: true,
  name: true,
  taskname: true,
  task: true,
  title: true,
  description: true,
  start: true,
  startdate: true,
  begin: true,
  begindate: true,
  end: true,
  enddate: true,
  finish: true,
  finishdate: true,
  duedate: true,
  duration: true,
  days: true,
  hours: true,
  type: true,
  tasktype: true,
  progress: true,
  percentcomplete: true,
  percentdone: true,
  complete: true,
  parent: true,
  parentid: true,
  parenttask: true,
  parenttaskid: true,
  resources: true,
  resource: true,
  resourcenames: true,
  resourcename: true,
  resourceids: true,
  resourceid: true,
  predecessors: true,
  predecessor: true,
  predecessorids: true,
  predecessorid: true,
  depends: true,
  dependencies: true,
  predecessortypes: true,
  predecessortype: true,
  dependencytypes: true,
  dependencytype: true,
  linktypes: true,
  linktype: true,
}

function parseTsv(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const input = content.replace(/^\uFEFF/, '')
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += character
      }
      continue
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true
    } else if (character === '\t') {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      row.push(field)
      field = ''
      if (character === '\r' && input[index + 1] === '\n') index += 1
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += character
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.some((cell) => cell.trim() !== '')) rows.push(row)
  }

  return rows
}

export function parseClipboardTable(text: string): CsvImportData | null {
  if (text.trim() === '') return null

  const rawRows = parseTsv(text)
  if (rawRows.length === 0) return null

  const columnCount = Math.max(...rawRows.map((row) => row.length))
  const paddedRows = rawRows.map((row) => {
    const padded = [...row]
    while (padded.length < columnCount) padded.push('')
    return padded
  })

  const firstRow = paddedRows[0]
  const nonEmptyCells = firstRow.filter((cell) => cell.trim() !== '')
  const matchingCells = nonEmptyCells.filter(
    (cell) => HEADER_ALIASES[cell.toLowerCase().replace(/[^a-z0-9]/g, '')]
  )

  const hasHeader =
    matchingCells.length > 0 &&
    matchingCells.length >= Math.ceil(nonEmptyCells.length / 2)

  let headers: string[]
  let rows: string[][]

  if (hasHeader) {
    headers = firstRow
    rows = paddedRows.slice(1)
  } else {
    headers = Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`)
    rows = paddedRows
  }

  return { fileName: 'clipboard', headers, rows }
}
