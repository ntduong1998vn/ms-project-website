import { expect, test, type Page } from '@playwright/test'
import { seedSampleProject } from './seed'

function ribbonButton(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await seedSampleProject(page)
  await page.reload()
  // Wait until the gantt grid has rendered its task rows.
  await expect(page.locator('div[role="row"][data-id]').first()).toBeVisible()
})

test('Critical Path toggle highlights and un-highlights critical task bars', async ({ page }) => {
  // The toggle lives on the View tab.
  await ribbonButton(page, 'View').click()

  const criticalBars = page.locator('.wx-bar.wx-critical')

  await expect(criticalBars).toHaveCount(0)

  await ribbonButton(page, 'Critical Path').click()
  await expect(criticalBars).not.toHaveCount(0)

  await ribbonButton(page, 'Critical Path').click()
  await expect(criticalBars).toHaveCount(0)
})
