import { chromium } from 'playwright';

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  
  await page.screenshot({ path: 'scripts/rendered_instrument.png' });
  console.log('Screenshot captured to scripts/rendered_instrument.png');
  await browser.close();
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
