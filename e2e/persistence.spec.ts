import { expect, test, type Page } from '@playwright/test'

/**
 * IndexedDB persistence e2e. The app stores two records in DB `ms-project-web`,
 * store `kv`: `project` ({v:1, tasks, links, resourceList}) and `settings`
 * ({v:1, calendarConfig, zoom, viewMode, ...}). Dates survive as Date objects
 * via structured clone.
 */
const GRID_ROW = 'div[role="row"][data-id]'

function idbPut(page: Page, key: string, value: unknown) {
  return page.evaluate(
    async ([k, v]) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('ms-project-web', 1)
        req.onupgradeneeded = () => req.result.createObjectStore('kv')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite')
        tx.objectStore('kv').put(v, k)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    [key, value] as const
  )
}

function idbGet(page: Page, key: string) {
  return page.evaluate(async (k) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ms-project-web', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('kv')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const value = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get(k)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return value
  }, key)
}

const seededProject = {
  v: 1,
  tasks: [
    {
      id: 1,
      text: 'Persisted Alpha',
      start: new Date(2026, 8, 21).toISOString(),
      end: new Date(2026, 8, 25).toISOString(),
      duration: 4,
      type: 'task',
      progress: 0,
    },
    {
      id: 2,
      text: 'Persisted Beta',
      start: new Date(2026, 8, 28).toISOString(),
      end: new Date(2026, 10, 2).toISOString(),
      duration: 4,
      type: 'task',
      progress: 0,
    },
  ],
  links: [],
  resourceList: [],
}

const seededSettings = {
  v: 1,
  calendarConfig: { workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], holidays: [] },
  isAutoSchedule: true,
  durationUnit: 'day',
  zoom: 'week',
  viewMode: 'gantt',
  isWorkColumnVisible: false,
  visibleRemoteColumns: [],
  showCriticalPath: false,
  isGanttVisible: true,
}

test('fresh browser starts with an empty grid', async ({ page }) => {
  await page.goto('/')
  // Give hydration a beat, then confirm no task rows rendered.
  await page.waitForSelector('.wx-gantt, [role="grid"]', { timeout: 10_000 })
  await expect(page.locator(GRID_ROW)).toHaveCount(0)
})

test('seeded project restores into the grid after reload', async ({ page }) => {
  await page.goto('/')
  await idbPut(page, 'project', seededProject)
  await page.reload()

  await expect(
    page.locator(GRID_ROW).filter({ has: page.locator('[data-col-id=":text"]', { hasText: 'Persisted Alpha' }) })
  ).toBeVisible()
  await expect(
    page.locator(GRID_ROW).filter({ has: page.locator('[data-col-id=":text"]', { hasText: 'Persisted Beta' }) })
  ).toBeVisible()
})

test('adding a task via the ribbon auto-saves to IndexedDB', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.wx-gantt, [role="grid"]', { timeout: 10_000 })

  await page.getByRole('button', { name: 'Add Task', exact: true }).click()
  await expect(page.locator(GRID_ROW).first()).toBeVisible()

  // 400ms debounce + write; poll the store rather than sleeping a fixed time.
  await expect
    .poll(async () => {
      const record = (await idbGet(page, 'project')) as { tasks?: { text?: string }[] } | undefined
      return record?.tasks?.map((t) => t.text) ?? []
    })
    .toContain('New Task 1')
})

test('seeded settings restore the zoom control after reload', async ({ page }) => {
  await page.goto('/')
  await idbPut(page, 'settings', seededSettings)
  await page.reload()

  await page.getByRole('button', { name: 'View', exact: true }).click()

  const week = page.getByRole('button', { name: 'week', exact: true })
  await expect(week).toBeVisible()
  await expect(week).toHaveClass(/font-semibold/)
  await expect(page.getByRole('button', { name: 'day', exact: true })).not.toHaveClass(/font-semibold/)
})
