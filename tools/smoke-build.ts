/**
 * Smoke test for the production build.
 *
 * Serves `dist/` from a subdirectory — the way a game portal and GitHub Pages
 * both serve it — loads it in headless Chromium, and asserts that the game
 * actually starts: a canvas is attached, nothing 404s, and no error reaches
 * the console.
 *
 * This exists because a bug got past three commits of "verified working".
 * Every check had been run against the dev server, which serves modules
 * unbundled. The production bundle deadlocked on startup and rendered nothing,
 * and no unit test could see it: the failure only exists after Rollup has
 * bundled the code. `npm run build` succeeding says the build produced files,
 * not that the files work.
 *
 * Run with `npm run smoke`.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

/** Subdirectory to serve under, mirroring `https://<user>.github.io/<repo>/`. */
const BASE_PATH = '/thrice-bound/';
const PORT = 4321;
/** Generous: a cold headless start on a loaded CI runner is not instant. */
const BOOT_TIMEOUT_MS = 30_000;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const distDir = resolve('dist');

function startServer(): Promise<{ close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    void (async () => {
      const url = (req.url ?? '/').split('?')[0] ?? '/';
      if (!url.startsWith(BASE_PATH)) {
        res.writeHead(404).end('outside base path');
        return;
      }
      const relative = url.slice(BASE_PATH.length) || 'index.html';
      // `normalize` plus the prefix check keeps a crafted path inside dist.
      const filePath = join(distDir, normalize(relative).replace(/^(\.\.[/\\])+/, ''));
      if (!filePath.startsWith(distDir)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      try {
        const body = await readFile(filePath);
        res.writeHead(200, {
          'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
        });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    })();
  });

  return new Promise((resolveServer) => {
    server.listen(PORT, () => {
      resolveServer({
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

async function main(): Promise<void> {
  const server = await startServer();
  // swiftshader gives a software WebGL context, so this runs on a machine with
  // no GPU. `CHROMIUM_PATH` points at an already-installed browser; without it
  // Playwright resolves its own, using the full browser rather than the
  // headless shell, which is not always present.
  const executablePath = process.env['CHROMIUM_PATH'];
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
    ...(executablePath !== undefined ? { executablePath } : { channel: 'chromium' }),
  });

  const failures: string[] = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
    page.on('console', (message) => {
      if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
    });
    page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));
    page.on('requestfailed', (request) =>
      failures.push(`request failed: ${request.url()}`),
    );
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failures.push(`${response.status()} ${response.url()}`);
      }
    });

    const startedAt = Date.now();
    await page.goto(`http://localhost:${PORT}${BASE_PATH}`);

    let started = true;
    try {
      await page.waitForSelector('#game-root canvas', { timeout: BOOT_TIMEOUT_MS });
    } catch {
      started = false;
      failures.push(
        `no canvas attached within ${BOOT_TIMEOUT_MS}ms — the game did not start`,
      );
    }

    // Read through Playwright's API rather than `page.evaluate`, so this file
    // needs no DOM types — `tools/` is type-checked without them on purpose.
    // Only meaningful once the canvas exists; otherwise this would throw its
    // own timeout on top of the failure already recorded.
    let width = 0;
    let height = 0;
    if (started) {
      const canvas = page.locator('#game-root canvas').first();
      width = Number(await canvas.getAttribute('width'));
      height = Number(await canvas.getAttribute('height'));
      if (!Number.isFinite(width) || !Number.isFinite(height) || width * height === 0) {
        failures.push(`canvas has no drawable area: ${width}x${height}`);
      }
    }

    if (failures.length === 0) {
      console.log(
        `smoke: ok — canvas ${width}x${height} in ${Date.now() - startedAt}ms ` +
          `(served from ${BASE_PATH})`,
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }

  if (failures.length > 0) {
    console.error(`smoke: FAILED with ${failures.length} problem(s)`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  }
}

await main();
