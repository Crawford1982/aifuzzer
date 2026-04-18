'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Headless Chromium: rendered text + PNG screenshot for vision models.
 */
async function browsePage(policyUrl, options = {}) {
  const { chromium } = require('playwright');
  const timeoutMs = options.timeoutMs || 60000;
  const maxScreenshotBytes = options.maxScreenshotBytes || 4 * 1024 * 1024;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'en-US'
    });
    const page = await context.newPage();
    await page.goto(policyUrl, {
      timeout: timeoutMs,
      waitUntil: 'domcontentloaded'
    });

    try {
      await page.waitForLoadState('networkidle', { timeout: 12000 });
    } catch (_e) {
      await sleep(2000);
    }
    await sleep(1200);

    const title = await page.title();
    const finalUrl = page.url();
    const text = await page
      .evaluate(() => (document.body && document.body.innerText) || '')
      .catch(() => '');

    let buf = await page.screenshot({ type: 'png', fullPage: false });

    if (options.tryFullPage !== false) {
      const full = await page.screenshot({ type: 'png', fullPage: true });
      if (full.length <= maxScreenshotBytes) buf = full;
    }
    if (buf.length > maxScreenshotBytes) {
      buf = await page.screenshot({ type: 'png', fullPage: false });
    }

    return {
      finalUrl,
      title,
      text: String(text).slice(0, 100000),
      screenshotBase64: buf.toString('base64'),
      screenshotBytes: buf.length
    };
  } finally {
    await browser.close();
  }
}

module.exports = { browsePage };
