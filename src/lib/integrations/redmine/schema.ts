import type { RemoteFieldDescriptor } from '@/lib/integrations/types'
import type { RedmineCustomField } from './types'

export function customFieldDescriptor(field: RedmineCustomField): RemoteFieldDescriptor {
  const format = field.field_format
  return {
    key: `cf_${field.id}`, label: `${field.name} (custom)`, description: field.description, kind: 'custom',
    valueType: format === 'int' || format === 'float' ? 'number' : format === 'date' ? 'date' : format === 'user' ? 'user' : 'string',
    multiple: field.multiple === true || field.multiple === '1',
    options: field.possible_values?.map((v) => ({ id: v.value, label: v.label ?? v.value })) ??
      (format === 'bool' ? [{ id: '1', label: 'Yes' }, { id: '0', label: 'No' }] : undefined),
  }
}

export function importCustomFieldSchema(json: string): RemoteFieldDescriptor[] {
  const parsed: unknown = JSON.parse(json)
  if (!parsed || typeof parsed !== 'object' || !('custom_fields' in parsed) || !Array.isArray(parsed.custom_fields)) {
    throw new Error('Expected a /custom_fields.json body with a custom_fields array.')
  }
  return parsed.custom_fields.map((field: unknown) => {
    if (!field || typeof field !== 'object' || !('id' in field) || !Number.isInteger(field.id) || Number(field.id) <= 0 || !('name' in field) || typeof field.name !== 'string') {
      throw new Error('Each custom field needs a positive integer ID and a name.')
    }
    const f = field as RedmineCustomField
    if (f.possible_values !== undefined && (!Array.isArray(f.possible_values) || f.possible_values.some((v) => !v || typeof v.value !== 'string' || (v.label !== undefined && typeof v.label !== 'string')))) {
      throw new Error('possible_values must contain string value/label pairs.')
    }
    return f
  }).filter((f) => !f.customized_type || f.customized_type === 'issue').map(customFieldDescriptor)
}
