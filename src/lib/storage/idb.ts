// Minimal promise-based IndexedDB wrapper. Single `kv` store with
// out-of-line keys; structured clone keeps Date objects intact.
// NOTE: `new Promise` executor form — Promise.withResolvers is not in the
// current TS lib target.

const DB_NAME = 'ms-project-web'
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase | undefined> | null = null

function openDb(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(undefined)
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(undefined)
    })
  }
  return dbPromise
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  if (!db) return undefined
  return new Promise((resolve) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => resolve(undefined)
  })
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbClear(): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
