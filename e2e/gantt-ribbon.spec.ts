import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedSampleProject } from './seed'

/**
 * SVAR gantt grid DOM notes (for future maintenance):
 * - Task rows are `div[role="row"][data-id]` where data-id is the task id.
 *   Header/footer rows have role="row" but no data-id, so they are excluded.
 * - Cells are `div[role="gridcell"][data-col-id]`; column ids are colon-
 *   prefixed (':text', ':predecessors', ':id', ... — see use-gantt-columns.tsx).
 * - Selected rows carry the `wx-selected` class.
 * - Tree depth is NOT exposed via aria-level; indentation is `padding-left`
 *   on `.wx-content` inside the ':text' cell (0px at root, +20px per level).
 * - Ctrl/Cmd+click on a row toggles multi-select (select-task {toggle:true}).
 * - Rows are virtualized: only the visible slice is in the DOM. Avoid
 *   asserting total row counts; assert specific rows by data-id/text.
 */
const GRID_ROW = 'div[role="row"][data-id]'
const SELECTED_CLASS = /wx-selected/

function gridRows(page: Page): Locator {
  return page.locator(GRID_ROW)
}

function rowByName(page: Page, name: string): Locator {
  return gridRows(page).filter({
    has: page.locator('[data-col-id=":text"]', { hasText: name }),
  })
}

function cell(row: Locator, colId: string): Locator {
  return row.locator(`[data-col-id=":${colId}"]`)
}

function ribbonButton(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true })
}

/** px indentation of the task-name cell content (0 at root level). */
async function indentPx(row: Locator): Promise<number> {
  const padding = await cell(row, 'text')
    .locator('.wx-content')
    .evaluate((el) => el.style.paddingLeft)
  return Number.parseInt(padding, 10) || 0
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await seedSampleProject(page)
  await page.reload()
  // Wait until the gantt grid has rendered its task rows.
  await expect(gridRows(page).first()).toBeVisible()
})

test('Add Task appends a selected row to the grid', async ({ page }) => {
  const addTask = ribbonButton(page, 'Add Task')
  await expect(addTask).toBeEnabled()
  await addTask.click()

  // Sample data has ids 1-10, so the new task is "New Task 11".
  const newRow = rowByName(page, 'New Task 11')
  await expect(newRow).toBeVisible()
  await expect(newRow).toHaveAttribute('data-id', '11')
  await expect(newRow).toHaveClass(SELECTED_CLASS)
})

test('Indent makes the selected task a child of the task above', async ({ page }) => {
  await ribbonButton(page, 'Add Task').click()
  const newRow = rowByName(page, 'New Task 11')
  await expect(newRow).toBeVisible()
  expect(await indentPx(newRow)).toBe(0)

  const indent = ribbonButton(page, 'Indent')
  await expect(indent).toBeEnabled()
  await indent.click()

  // The task is now a child of "Production Deployment", itself a child of the
  // "2. Implementation & Delivery" summary — two levels of indentation.
  await expect
    .poll(() => indentPx(newRow), { message: 'indented task gains padding' })
    .toBeGreaterThan(0)
  await expect(newRow).toHaveClass(SELECTED_CLASS)
  await expect(ribbonButton(page, 'Outdent')).toBeEnabled()
})

test('Outdent returns a child task to root level without crashing', async ({ page }) => {
  // "Requirements Gathering" is a direct child of the root summary
  // "1. Planning & Design" — one outdent brings it to root level.
  const row = rowByName(page, 'Requirements Gathering')
  await expect(row).toBeVisible()
  await cell(row, 'text').click()
  await expect(row).toHaveClass(SELECTED_CLASS)
  expect(await indentPx(row)).toBeGreaterThan(0)

  const outdent = ribbonButton(page, 'Outdent')
  await expect(outdent).toBeEnabled()
  await outdent.click()

  // No white screen: the grid and its header are still rendered, and the
  // task is back at root level with no parent.
  await expect(page.getByRole('columnheader', { name: 'Task Name' })).toBeVisible()
  await expect(row).toBeVisible()
  await expect
    .poll(() => indentPx(row), { message: 'outdented task returns to root' })
    .toBe(0)
  await expect(outdent).toBeDisabled()
})

test('Add Task → Indent → Outdent cycle keeps the page functional', async ({ page }) => {
  await ribbonButton(page, 'Add Task').click()
  const newRow = rowByName(page, 'New Task 11')
  await expect(newRow).toBeVisible()
  expect(await indentPx(newRow)).toBe(0)

  await ribbonButton(page, 'Indent').click()
  await expect
    .poll(() => indentPx(newRow), { message: 'indented task gains padding' })
    .toBeGreaterThan(0)

  // Outdent moves up one level per click; the new task was indented under a
  // level-2 task, so two outdents return it to root.
  const outdent = ribbonButton(page, 'Outdent')
  await outdent.click()
  await expect
    .poll(() => indentPx(newRow), { message: 'first outdent moves up one level' })
    .toBe(20)
  await outdent.click()
  await expect
    .poll(() => indentPx(newRow), { message: 'second outdent returns to root' })
    .toBe(0)

  // The app is still alive: grid renders and the ribbon still responds.
  await expect(page.getByRole('columnheader', { name: 'Task Name' })).toBeVisible()
  await expect(gridRows(page).first()).toBeVisible()
  await expect(ribbonButton(page, 'Add Task')).toBeEnabled()
})

test('multi-select + Link Tasks sets predecessors, Unlink Tasks clears them', async ({ page }) => {
  const reqRow = rowByName(page, 'Requirements Gathering')
  const archRow = rowByName(page, 'Architecture & DB Design')
  await expect(reqRow).toBeVisible()
  await expect(archRow).toBeVisible()

  // Plain click selects; Ctrl/Cmd+click toggles an additional selection.
  await cell(reqRow, 'text').click()
  await cell(archRow, 'text').click({ modifiers: ['ControlOrMeta'] })
  await expect(reqRow).toHaveClass(SELECTED_CLASS)
  await expect(archRow).toHaveClass(SELECTED_CLASS)

  const linkTasks = ribbonButton(page, 'Link Tasks')
  await expect(linkTasks).toBeEnabled()
  await linkTasks.click()

  // Selection order is 2 → 4, so task 4 gains predecessor "2".
  // Tasks 2 and 4 have no pre-existing link, so Link must actually create it.
  await expect(cell(archRow, 'predecessors')).toContainText('2')

  const unlinkTasks = ribbonButton(page, 'Unlink Tasks')
  await expect(unlinkTasks).toBeEnabled()
  await unlinkTasks.click()

  await expect(cell(archRow, 'predecessors')).not.toContainText('2')
  await expect(cell(archRow, 'predecessors')).toContainText('-')
})

test('Delete Task removes the selected row', async ({ page }) => {
  const target = rowByName(page, 'Production Deployment')
  await expect(target).toBeVisible()
  await cell(target, 'text').click()
  await expect(target).toHaveClass(SELECTED_CLASS)

  const deleteTask = ribbonButton(page, 'Delete Task')
  await expect(deleteTask).toBeEnabled()
  await deleteTask.click()

  // Deletion is gated behind a confirmation dialog.
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Task', exact: true }).click()

  await expect(rowByName(page, 'Production Deployment')).toHaveCount(0)
  await expect(gridRows(page).first()).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Task Name' })).toBeVisible()
})
