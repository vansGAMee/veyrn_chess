import { chromium } from 'playwright';

async function runVerification() {
  const browser = await chromium.launch({ headless: true });

  // 1. Desktop 1280x800 (Windowed)
  const page1280 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page1280.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page1280.waitForTimeout(500);

  // Test drag from center
  const e2 = page1280.locator('[data-sq="e2"]');
  const e2Box = await e2.boundingBox();
  if (e2Box) {
    await page1280.mouse.move(e2Box.x + e2Box.width / 2, e2Box.y + e2Box.height / 2);
    await page1280.mouse.down();
    await page1280.mouse.move(e2Box.x + e2Box.width / 2, e2Box.y + e2Box.height / 2 - 120, { steps: 5 });
    await page1280.screenshot({ path: 'scripts/verify_drag_center_1280.png' });
    await page1280.mouse.up();
  }

  await page1280.screenshot({ path: 'scripts/verify_static_1280.png' });

  // 2. Desktop 1440x900 (Large / Fullscreen)
  const page1440 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page1440.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page1440.waitForTimeout(500);
  await page1440.screenshot({ path: 'scripts/verify_static_1440.png' });

  // 3. Mobile 390x844
  const pageMobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await pageMobile.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await pageMobile.waitForTimeout(500);
  await pageMobile.screenshot({ path: 'scripts/verify_mobile_390.png' });

  console.log('All verification screenshots captured!');
  await browser.close();
}

runVerification().catch(err => {
  console.error(err);
  process.exit(1);
});
