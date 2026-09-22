import { beforeEach, describe, expect, it } from 'vitest'
import { idbClear, idbDelete, idbGet, idbSet } from '@/lib/storage/idb'

beforeEach(async () => {
  await idbClear()
})

describe('idb kv wrapper', () => {
  it('returns undefined for a missing key', async () => {
    await expect(idbGet('nope')).resolves.toBeUndefined()
  })

  it('sets and gets a value', async () => {
    await idbSet('k', { a: 1 })
    await expect(idbGet('k')).resolves.toEqual({ a: 1 })
  })

  it('overwrites an existing key', async () => {
    await idbSet('k', 1)
    await idbSet('k', 2)
    await expect(idbGet('k')).resolves.toBe(2)
  })

  it('deletes a key', async () => {
    await idbSet('k', 1)
    await idbDelete('k')
    await expect(idbGet('k')).resolves.toBeUndefined()
  })

  it('clears all keys', async () => {
    await idbSet('a', 1)
    await idbSet('b', 2)
    await idbClear()
    await expect(idbGet('a')).resolves.toBeUndefined()
    await expect(idbGet('b')).resolves.toBeUndefined()
  })
})
