import { chromium } from 'playwright';

async function testDelightAndPlanning() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  
  // 1. Capture initial static state
  await page.screenshot({ path: 'scripts/verify_static_refined.png' });

  // 2. Right click & drag from e2 to e4 to draw an arrow
  const e2 = page.locator('[data-sq="e2"]');
  const e4 = page.locator('[data-sq="e4"]');
  const g1 = page.locator('[data-sq="g1"]');
  const f3 = page.locator('[data-sq="f3"]');
  const d4 = page.locator('[data-sq="d4"]');

  const e2Box = await e2.boundingBox();
  const e4Box = await e4.boundingBox();
  const g1Box = await g1.boundingBox();
  const f3Box = await f3.boundingBox();
  const d4Box = await d4.boundingBox();

  if (e2Box && e4Box) {
    await page.mouse.move(e2Box.x + e2Box.width / 2, e2Box.y + e2Box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(e4Box.x + e4Box.width / 2, e4Box.y + e4Box.height / 2, { steps: 5 });
    await page.mouse.up({ button: 'right' });
  }

  // Draw second arrow g1 to f3
  if (g1Box && f3Box) {
    await page.mouse.move(g1Box.x + g1Box.width / 2, g1Box.y + g1Box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(f3Box.x + f3Box.width / 2, f3Box.y + f3Box.height / 2, { steps: 5 });
    await page.mouse.up({ button: 'right' });
  }

  // Right click single square d4 to create a marker
  if (d4Box) {
    await page.mouse.move(d4Box.x + d4Box.width / 2, d4Box.y + d4Box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
  }

  await page.waitForTimeout(200);
  await page.screenshot({ path: 'scripts/verify_planning_arrows.png' });

  // 3. Left click a piece and make move e2-e4 (should clear arrows and execute move)
  await e2.click();
  await e4.click();
  await page.waitForTimeout(300);

  await page.screenshot({ path: 'scripts/verify_post_move.png' });

  console.log('Planning & move verification finished successfully!');
  await browser.close();
}

testDelightAndPlanning().catch(err => {
  console.error(err);
  process.exit(1);
});
