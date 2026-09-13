import { describe, expect, it } from 'vitest'

import { parseClipboardTable } from '@/lib/clipboard'
import type { CsvImportData } from '@/types/gantt-csv'

describe('parseClipboardTable', () => {
  it('returns null for empty or whitespace-only input', () => {
    expect(parseClipboardTable('')).toBeNull()
    expect(parseClipboardTable('   ')).toBeNull()
    expect(parseClipboardTable('\n\t\r\n')).toBeNull()
  })

  it('parses basic TSV rows and detects headers', () => {
    const result = parseClipboardTable('Name\tStart\tDuration\nTask 1\t2024-01-01\t5')
    expect(result).toEqual<CsvImportData>({
      fileName: 'clipboard',
      headers: ['Name', 'Start', 'Duration'],
      rows: [['Task 1', '2024-01-01', '5']],
    })
  })

  it('synthesizes Column N headers when no header is detected', () => {
    const result = parseClipboardTable('foo\tbar\n1\t2')
    expect(result).toEqual<CsvImportData>({
      fileName: 'clipboard',
      headers: ['Column 1', 'Column 2'],
      rows: [
        ['foo', 'bar'],
        ['1', '2'],
      ],
    })
  })

  it('handles quoted cells containing a tab', () => {
    const result = parseClipboardTable('A\t"B\tC"\tD')
    expect(result).toEqual<CsvImportData>({
      fileName: 'clipboard',
      headers: ['Column 1', 'Column 2', 'Column 3'],
      rows: [['A', 'B\tC', 'D']],
    })
  })

  it('handles quoted cells containing a newline', () => {
    const result = parseClipboardTable('A\t"B\nC"\tD')
    expect(result).toEqual<CsvImportData>({
      fileName: 'clipboard',
      headers: ['Column 1', 'Column 2', 'Column 3'],
      rows: [['A', 'B\nC', 'D']],
    })
  })

  it('handles doubled quote escapes', () => {
    const result = parseClipboardTable('A\t"say ""hi"""\tD')
    expect(result).toEqual<CsvImportData>({
      fileName: 'clipboard',
      headers: ['Column 1', 'Column 2', 'Column 3'],
      rows: [['A', 'say "hi"', 'D']],
    })
  })

  it('handles CRLF line endings', () => {
    const result = parseClipboardTable('A\tB\r\nC\tD')
    expect(result).toEqual<CsvImportData>({
      fileName: 'clipboard',
      headers: ['Column 1', 'Column 2'],
      rows: [
        ['A', 'B'],
        ['C', 'D'],
      ],
    })
  })

  it('pads ragged rows to the column count', () => {
    const result = parseClipboardTable('A\tB\nC\nD\tE\tF')
    expect(result).toEqual<CsvImportData>({
      fileName: 'clipboard',
      headers: ['Column 1', 'Column 2', 'Column 3'],
      rows: [
        ['A', 'B', ''],
        ['C', '', ''],
        ['D', 'E', 'F'],
      ],
    })
  })

  it('treats a single quoted cell as a 1x1 data row', () => {
    const result = parseClipboardTable('"Buy milk"')
    expect(result).toEqual<CsvImportData>({
      fileName: 'clipboard',
      headers: ['Column 1'],
      rows: [['Buy milk']],
    })
  })
})
