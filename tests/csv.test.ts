import { describe, expect, it } from 'vitest'
import { csvEscape, parseCsv, serializeCsv } from '../src/lib/csv'

describe('parseCsv', () => {
  it('removes a leading BOM', () => {
    expect(parseCsv('\uFEFFname,priority\nRelease,high')).toEqual([
      ['name', 'priority'],
      ['Release', 'high'],
    ])
  })

  it('accepts LF, CRLF, and CR row separators', () => {
    expect(parseCsv('lf,row\ncrlf,row\r\ncr,row\rfinal,row')).toEqual([
      ['lf', 'row'],
      ['crlf', 'row'],
      ['cr', 'row'],
      ['final', 'row'],
    ])
  })

  it('parses quoted commas, escaped quotes, and multiline values', () => {
    expect(parseCsv('id,name,notes\n1,"Doe, Jane","said ""hello"""\n2,Task,"line one\r\nline two"')).toEqual([
      ['id', 'name', 'notes'],
      ['1', 'Doe, Jane', 'said "hello"'],
      ['2', 'Task', 'line one\r\nline two'],
    ])
  })

  it('keeps empty cells when a row has other content', () => {
    expect(parseCsv('id,,status,\n42,,,active')).toEqual([
      ['id', '', 'status', ''],
      ['42', '', '', 'active'],
    ])
  })

  it('ignores blank and whitespace-only rows', () => {
    expect(parseCsv('\n  \r\nname\n, \nvalue,')).toEqual([
      ['name'],
      ['value', ''],
    ])
  })

  it('permissively returns an unmatched quoted field at end of input', () => {
    expect(parseCsv('name,"unfinished')).toEqual([['name', 'unfinished']])
  })
  it('ignores blank rows and a final row of only empty cells', () => {
    expect(parseCsv('a\n\n,')).toEqual([['a']])
    expect(parseCsv(',\n')).toEqual([])
  })
})

describe('csvEscape', () => {
  it('converts nullish values to empty fields and stringifies other values', () => {
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
    expect(csvEscape(0)).toBe('0')
    expect(csvEscape(false)).toBe('false')
    expect(csvEscape('plain text')).toBe('plain text')
  })

  it('quotes fields containing commas, quotes, or line breaks', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('say "hello"')).toBe('"say ""hello"""')
    expect(csvEscape('line one\nline two')).toBe('"line one\nline two"')
    expect(csvEscape('line one\rline two')).toBe('"line one\rline two"')
  })
})

describe('serializeCsv', () => {
  it('emits escaped rows with CRLF separators and a trailing CRLF', () => {
    expect(
      serializeCsv(
        ['id', 'name', 'notes'],
        [
          [1, 'Doe, Jane', 'say "hello"'],
          [2, 'Task', ''],
        ],
      ),
    ).toBe('id,name,notes\r\n1,"Doe, Jane","say ""hello"""\r\n2,Task,\r\n')
  })

  it('round-trips representative records through serialization and parsing', () => {
    const headers = ['id', 'title', 'details', 'owner']
    const rows = [
      [1, 'Plan, phase 1', 'line one\nline two', 'Ada "The Builder"'],
      [2, 'Empty details', '', ''],
    ]

    expect(parseCsv(serializeCsv(headers, rows))).toEqual([
      headers,
      ['1', 'Plan, phase 1', 'line one\nline two', 'Ada "The Builder"'],
      ['2', 'Empty details', '', ''],
    ])
  })
})
