import { describe, expect, it } from 'vitest'
import { csvFieldAliases, csvTaskFields, initialCsvMapping } from '../src/lib/csv-field-mapping'

describe('initialCsvMapping', () => {
  it('maps known headers by alias', () => {
    const headers = [
      'Task ID',
      'Name',
      'Begin Date',
      'Finish Date',
      'Days',
      'Task Type',
      'Percent Done',
      'Parent ID',
      'Resource Names',
      'Predecessors',
      'Dependency Type',
    ]
    const mapping = initialCsvMapping(headers)
    expect(mapping.id).toBe(0)
    expect(mapping.text).toBe(1)
    expect(mapping.start).toBe(2)
    expect(mapping.end).toBe(3)
    expect(mapping.duration).toBe(4)
    expect(mapping.type).toBe(5)
    expect(mapping.progress).toBe(6)
    expect(mapping.parent).toBe(7)
    expect(mapping.resources).toBe(8)
    expect(mapping.predecessors).toBe(9)
    expect(mapping.predecessorTypes).toBe(10)
  })

  it('returns null for headers that do not match any alias', () => {
    const mapping = initialCsvMapping(['unknown', 'another'])
    for (const field of csvTaskFields) {
      expect(mapping[field.key]).toBeNull()
    }
  })

  it('matches aliases ignoring case and non-alphanumeric characters', () => {
    const headers = ['task-ID', 'Task Name', 'START DATE', 'end_date']
    const mapping = initialCsvMapping(headers)
    expect(mapping.id).toBe(0)
    expect(mapping.text).toBe(1)
    expect(mapping.start).toBe(2)
    expect(mapping.end).toBe(3)
  })
})

describe('csvFieldAliases', () => {
  it('has aliases for every csv task field', () => {
    for (const field of csvTaskFields) {
      expect(csvFieldAliases[field.key]).toBeDefined()
      expect(csvFieldAliases[field.key].length).toBeGreaterThan(0)
    }
  })
})
