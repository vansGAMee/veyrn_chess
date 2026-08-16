import { chromium } from 'playwright';

async function testGameVisual() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  
  // Make a sandbox move e2-e4
  const e2 = page.locator('[data-sq="e2"]');
  const e4 = page.locator('[data-sq="e4"]');
  
  await e2.click();
  await page.waitForTimeout(100);
  await e4.click();
  await page.waitForTimeout(300);
  
  await page.screenshot({ path: 'scripts/rendered_in_game.png' });
  console.log('In-game screenshot captured to scripts/rendered_in_game.png');
  await browser.close();
}

testGameVisual().catch(err => {
  console.error(err);
  process.exit(1);
});
