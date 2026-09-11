import { describe, expect, it } from 'vitest'

import { cn } from '@/lib/utils'

describe('cn utility', () => {
  it('merges conflicting Tailwind classes while preserving the winning class', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('joins nested conditional class values', () => {
    expect(cn('text-sm', ['font-medium', { 'leading-tight': true, hidden: false }], null, undefined)).toBe(
      'text-sm font-medium leading-tight'
    )
  })
})
