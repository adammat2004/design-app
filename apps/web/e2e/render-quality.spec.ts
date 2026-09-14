import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { test, expect, type Page } from '@playwright/test';
import type { RenderFrameMetrics } from '../src/lib/render/diagnostics';

const output = resolve('.render-quality');
async function metrics(page: Page): Promise<RenderFrameMetrics> {
  return JSON.parse((await page.getByTestId('lab-pixi').getAttribute('data-render-metrics'))!);
}
async function ready(page: Page) {
  await expect(page.getByTestId('render-lab')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('render-lab')).toHaveAttribute('data-error', '');
  await expect(page.getByTestId('lab-pixi')).toHaveAttribute('data-render-metrics', /revision/);
  await expect.poll(async () => (await metrics(page)).revision === await page.getByTestId('lab-canvas').getAttribute('data-revision')).toBe(true);
}
async function pixels(buffer: Buffer) {
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height).data;
}

async function captureParity(page: Page, name: string, ratio: number) {
  const gpu = await page.getByTestId('lab-pixi').screenshot({ path: resolve(output, `${name}-dpr${ratio}-pixi.png`) });
  const cpu = await page.getByTestId('lab-canvas').screenshot({ path: resolve(output, `${name}-dpr${ratio}-canvas.png`) });
  const a = await pixels(gpu), b = await pixels(cpu);
  expect(a.length).toBe(b.length);
  let difference = 0;
  for (let i = 0; i < a.length; i += 4) difference += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
  const mae = difference / (a.length / 4 * 3);
  expect.soft(mae, `${name} DPR${ratio} mean RGB error`).toBeLessThan(7);
  return { name, ratio, mae, ...await metrics(page) };
}

for (const ratio of [1, 2]) test.describe(`rendered-plan DPR ${ratio}`, () => {
  test.use({ viewport: { width: 1400, height: 980 }, deviceScaleFactor: ratio });
  test('fixed fixtures preserve browser/export parity through zoom, maturity and night', async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(output, { recursive: true });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/render-lab?renderDiagnostics');
    await ready(page);
    const report = [];
    for (const fixture of ['target', 'naturalistic', 'formal', 'courtyard', 'narrow', 'levels', 'dense', 'courses']) {
      await page.getByLabel('Fixture', { exact: true }).selectOption(fixture);
      for (const scale of [16, 32, 64]) {
        await page.getByLabel('Scale', { exact: true }).fill(String(scale));
        await ready(page);
        report.push({ fixture, scale, ...await captureParity(page, `${fixture}-${scale}`, ratio) });
      }
    }
    await page.getByLabel('Fixture', { exact: true }).selectOption('reference');
    for (const maturity of ['year-1', 'year-3', 'mature']) {
      await page.getByLabel('Maturity', { exact: true }).selectOption(maturity);
      await page.getByLabel('Time', { exact: true }).fill('0'); await ready(page);
      await page.screenshot({ path: resolve(output, `night-${maturity}-dpr${ratio}.png`) });
      report.push({ fixture: 'reference', scale: 64, ...await captureParity(page, `night-${maturity}`, ratio) });
    }
    writeFileSync(resolve(output, `parity-dpr${ratio}.json`), JSON.stringify(report, null, 2));
    expect(errors).toEqual([]);
  });

  test('planting comparisons preserve scene identity and reuse cached rasters', async ({ page }) => {
    mkdirSync(output, { recursive: true });
    await page.goto('/render-lab?renderDiagnostics'); await ready(page);
    const report = [];
    for (const fixture of ['target', 'naturalistic']) {
      await page.getByLabel('Fixture', { exact: true }).selectOption(fixture); await ready(page);
      const original = await metrics(page);
      for (const mode of ['individual', 'masses', 'hybrid']) {
        await page.getByLabel('Planting preview', { exact: true }).selectOption(mode); await ready(page);
        const frame = await metrics(page);
        expect(frame.revision).toBe(original.revision);
        expect(frame.surfacesRasterized).toBe(0);
        expect(frame.shadowsRasterized).toBe(0);
        expect(frame.nodesRasterized).toBe(0);
        report.push(await captureParity(page, `planting-${fixture}-${mode}`, ratio));
      }
    }
    writeFileSync(resolve(output, `planting-parity-dpr${ratio}.json`), JSON.stringify(report, null, 2));
  });

  test('cached pan and repeated presentation cycles retain no extra GPU textures', async ({ page }) => {
    test.setTimeout(180000);
    mkdirSync(output, { recursive: true });
    await page.goto('/render-lab?renderDiagnostics'); await ready(page);
    await page.getByLabel('Fixture', { exact: true }).selectOption('dense'); await ready(page);
    const warm = await metrics(page);
    const panFrames = [];
    for (let i = 0; i < 20; i++) {
      await page.getByRole('button', { name: 'Pan right', exact: true }).click();
      const frame = await metrics(page);
      expect(frame.surfacesRasterized).toBe(0);
      expect(frame.shadowsRasterized).toBe(0);
      expect(frame.nodesRasterized).toBe(0);
      panFrames.push(frame.frameMs);
    }
    const cycle = async () => {
      await page.getByLabel('Scale', { exact: true }).fill('64');
      await page.getByLabel('Maturity', { exact: true }).selectOption('year-1');
      await page.getByLabel('Scale', { exact: true }).fill('32');
      await page.getByLabel('Maturity', { exact: true }).selectOption('mature');
    };
    // Warm the complete working set before measuring retention, not just the first view.
    for (let i = 0; i < 3; i++) await cycle();
    const session = await page.context().newCDPSession(page);
    const heap = async () => {
      await session.send('HeapProfiler.collectGarbage');
      return (await session.send('Runtime.getHeapUsage')).usedSize;
    };
    const heapBefore = await heap();
    for (let i = 0; i < 20; i++) await cycle();
    await page.getByRole('button', { name: 'Reset pan', exact: true }).click(); await ready(page);
    const final = await metrics(page);
    const heapAfter = await heap();
    await session.detach();
    expect(final.textureBytes).toBeLessThanOrEqual(warm.textureBytes * 1.05);
    expect(heapAfter).toBeLessThanOrEqual(heapBefore * 1.05);
    const p95 = panFrames.sort((a, b) => a - b)[Math.floor(panFrames.length * 0.95)]!;
    writeFileSync(resolve(output, `performance-dpr${ratio}.json`), JSON.stringify({ warm, final, panP95Ms: p95,
      panFrames, heapBefore, heapAfter }, null, 2));
    expect(p95).toBeLessThanOrEqual(16.7);
  });
});
