import { test, expect } from '@playwright/test';
import { createGame } from '../src/game/simulation';
import { SAVE_KEY } from '../src/game/catalog';
import type { GameState } from '../src/game/simulation';

const state = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__PATCHWORK__.state() as GameState);
async function begin(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Make yourself at home' }).click();
}
async function clickPatch(page: import('@playwright/test').Page, index: number) {
  const point = await page.evaluate(index => (window as any).__PATCHWORK__.screenForPlot(index), index);
  await page.mouse.click(point.x, point.y);
}

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) {
    console.log('Farm diagnostic:', await page.evaluate(() => {
      const game = (window as any).__PATCHWORK__;
      return game ? { debug: game.debug(), player: game.state().player, minutes: game.state().minutes, visibility: document.visibilityState, toast: document.querySelector('#toast')?.textContent } : 'Game not initialized';
    }).catch(() => 'Browser context unavailable'));
  }
});

test('harvests through real scene targeting, ships, sleeps once, and persists', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await begin(page);
  await clickPatch(page, 0);
  await expect.poll(async () => (await state(page)).produce.dewturnip).toBe(1);
  await clickPatch(page, 1);
  await expect.poll(async () => (await state(page)).produce.dewturnip).toBe(2);
  await page.getByRole('button', { name: 'Shipping box', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'All · 40', exact: true }).click();
  await expect.poll(async () => (await state(page)).shipping.dewturnip).toBe(2);
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.keyboard.press('n');
  await page.getByRole('button', { name: 'Rest until morning' }).click();
  await expect(page.getByRole('heading', { name: 'A fresh page.' })).toBeVisible();
  expect((await state(page)).day).toBe(1);
  expect((await state(page)).coins).toBe(200);
  await page.reload();
  await expect.poll(async () => (await state(page)).coins).toBe(200);
  expect((await state(page)).day).toBe(1);
  expect((await state(page)).shipping.dewturnip).toBe(0);
  expect(errors).toEqual([]);
});

test('sows and waters through the scene, then grows by exactly one night', async ({ page }) => {
  await begin(page);
  await page.keyboard.press('3');
  await clickPatch(page, 4);
  await expect.poll(async () => (await state(page)).plots[4].crop?.remaining).toBe(3);
  expect((await state(page)).seeds.dewturnip).toBe(11);
  await page.keyboard.press('4');
  await clickPatch(page, 4);
  await expect.poll(async () => (await state(page)).plots[4].wet).toBe(true);
  await page.keyboard.press('n');
  await page.getByRole('button', { name: 'Rest until morning' }).click();
  await expect(page.getByRole('heading', { name: 'A fresh page.' })).toBeVisible();
  expect((await state(page)).plots[4].crop?.remaining).toBe(2);
});

test('market purchases deduct the displayed price and settings export a usable save', async ({ page }) => {
  await begin(page);
  await page.getByRole('button', { name: 'Seed stall', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
  await page.locator('#buy-dewturnip-5').click();
  expect((await state(page)).coins).toBe(120);
  expect((await state(page)).seeds.dewturnip).toBe(17);
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export save', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('patchwork-commons-day-1.json');
});

test('a contribution consumes goods and permanently develops the Welcome Nook', async ({ page }) => {
  const farm = createGame(); farm.welcomed = true; farm.produce.dewturnip = 6;
  await page.addInitScript(({ key, save }) => { localStorage.setItem(key, save); }, { key: SAVE_KEY, save: JSON.stringify(farm) });
  await page.goto('/');
  await page.getByRole('button', { name: 'Welcome Nook', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Share 6 Dewturnips' }).click();
  expect((await state(page)).commons).toBe('garden');
  expect((await state(page)).produce.dewturnip).toBe(0);
  expect((await state(page)).coins).toBe(160);
  await page.evaluate(() => (window as any).__PATCHWORK__.capture());
  await page.screenshot({ path: 'test-results/developed-farm.png' });
});

test('mobile layout and keyboard-accessible field list remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await begin(page);
  await page.getByRole('button', { name: 'Open farm notebook' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const patch = page.locator('.patch-button').first();
  await patch.focus(); await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).produce.dewturnip, { timeout: 15_000 }).toBe(1);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(horizontalOverflow).toBe(false);
  await page.evaluate(() => (window as any).__PATCHWORK__.capture());
  await page.screenshot({ path: 'test-results/mobile-farm.png' });
});

test('clicking a tall bean plant targets its own patch rather than the ground behind it', async ({ page }) => {
  const farm = createGame(); farm.welcomed = true;
  farm.plots[12] = { tilled: true, wet: false, crop: { kind: 'ribbonbean', remaining: 0, harvests: 0 } };
  await page.addInitScript(({ key, save }) => localStorage.setItem(key, save), { key: SAVE_KEY, save: JSON.stringify(farm) });
  await page.goto('/');
  const top = await page.evaluate(() => (window as any).__PATCHWORK__.screenForPlot(12, .9));
  await page.mouse.click(top.x, top.y);
  await expect.poll(async () => (await state(page)).produce.ribbonbean).toBe(1);
  expect((await state(page)).plots[12].crop?.remaining).toBe(3);
});
