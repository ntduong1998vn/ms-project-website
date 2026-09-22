import type { Page } from '@playwright/test'

/**
 * Seed the app's IndexedDB (`ms-project-web` / `kv`) with the project the
 * legacy specs were written against (former src/data/sample-gantt-data.ts).
 * Dates are constructed inside the browser so structured clone stores real
 * Date objects, matching what the app itself persists.
 */
export async function seedSampleProject(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const tasks = [
      { id: 1, text: '1. Planning & Design', start: new Date(2026, 8, 1), duration: 17, progress: 75, type: 'summary', open: true },
      { id: 2, text: 'Requirements Gathering', start: new Date(2026, 8, 1), duration: 4, progress: 100, type: 'task', parent: 1, resources: [1] },
      { id: 3, text: 'UI/UX Prototyping', start: new Date(2026, 8, 6), duration: 9, progress: 85, type: 'task', parent: 1, resources: [2] },
      { id: 4, text: 'Architecture & DB Design', start: new Date(2026, 8, 8), duration: 9, progress: 70, type: 'task', parent: 1, resources: [3] },
      { id: 5, text: 'Design Sign-off', start: new Date(2026, 8, 18), duration: 0, progress: 50, type: 'milestone', parent: 1, resources: [1, 2] },
      { id: 6, text: '2. Implementation & Delivery', start: new Date(2026, 8, 19), duration: 29, progress: 30, type: 'summary', open: true },
      { id: 7, text: 'Frontend Development', start: new Date(2026, 8, 19), duration: 16, progress: 45, type: 'task', parent: 6, resources: [2, 4] },
      { id: 8, text: 'Backend APIs & Services', start: new Date(2026, 8, 19), duration: 14, progress: 50, type: 'task', parent: 6, resources: [3] },
      { id: 9, text: 'Integration & QA Testing', start: new Date(2026, 9, 6), duration: 9, progress: 10, type: 'task', parent: 6, resources: [1, 4] },
      { id: 10, text: 'Production Deployment', start: new Date(2026, 9, 16), duration: 2, progress: 0, type: 'task', parent: 6, resources: [3, 4] },
    ].map((t) => ({
      ...t,
      // SVAR stores an exclusive end; derive it from start + duration days so
      // scheduler/critical-path code sees complete tasks.
      end: new Date(t.start.getTime() + t.duration * 86_400_000),
    }))
    const links = [
      { id: 1, source: 2, target: 3, type: 'e2s' },
      { id: 2, source: 3, target: 5, type: 'e2s' },
      { id: 3, source: 4, target: 5, type: 'e2s' },
      { id: 4, source: 5, target: 7, type: 'e2s' },
      { id: 5, source: 5, target: 8, type: 'e2s' },
      { id: 6, source: 7, target: 9, type: 'e2s' },
      { id: 7, source: 8, target: 9, type: 'e2s' },
      { id: 8, source: 9, target: 10, type: 'e2s' },
    ]
    const resourceList = [
      { id: 1, label: 'Alex Johnson' },
      { id: 2, label: 'Sarah Chen' },
      { id: 3, label: 'Michael Brown' },
      { id: 4, label: 'Emily Davis' },
    ]
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('ms-project-web', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('kv')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite')
      tx.objectStore('kv').put({ v: 1, tasks, links, resourceList }, 'project')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })
}
