import { expect, test } from '@playwright/test'

test('Second Bailout shell is responsive and honest', async ({ page }) => {
  const errors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Become the Second Bailout/i })).toBeVisible()
  await expect(page.getByText(/misunderstood the assignment and switched to XRP/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /open bailout window/i })).toBeVisible()
  await expect(page.getByText(/No XRP seed phrase\. No Cardano-style vault/i)).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  expect(errors).toEqual([])
})

test('receive facility preserves a large QR surface', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('tab', { name: /receive facility/i }).click()
  const qrBox = await page.locator('.qr-shell').boundingBox()
  expect(qrBox).not.toBeNull()
  expect(qrBox!.width).toBeGreaterThanOrEqual(300)
  expect(qrBox!.height).toBeGreaterThanOrEqual(300)
  await expect(page.getByText(/destination tag they assign you/i)).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('wide-short viewport keeps the liquidity note and controls in frame', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wide-short', 'wide-short regression only')
  await page.goto('/')
  await expect(page.locator('.bailout-note')).toBeVisible()
  await expect(page.getByRole('button', { name: /convene committee/i })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
