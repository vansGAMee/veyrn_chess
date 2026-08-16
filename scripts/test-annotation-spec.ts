import { chromium } from 'playwright';

async function testAnnotations() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  async function drawArrow(fromSq: string, toSq: string) {
    const fromEl = page.locator(`[data-sq="${fromSq}"]`);
    const toEl = page.locator(`[data-sq="${toSq}"]`);
    const b1 = await fromEl.boundingBox();
    const b2 = await toEl.boundingBox();
    if (b1 && b2) {
      await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2, { steps: 5 });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(50);
    }
  }

  async function markSquare(sq: string) {
    const el = page.locator(`[data-sq="${sq}"]`);
    const b = await el.boundingBox();
    if (b) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down({ button: 'right' });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(50);
    }
  }

  // 1. One adjacent arrow: e2 -> e3
  await drawArrow('e2', 'e3');

  // 2. One knight-like planning arrow: g1 -> f3
  await drawArrow('g1', 'f3');

  // 3. One full-board diagonal: c1 -> h6
  await drawArrow('c1', 'h6');

  // 4. Three intersecting arrows: d2 -> d4, e7 -> e5, f1 -> c4
  await drawArrow('d2', 'd4');
  await drawArrow('e7', 'e5');
  await drawArrow('f1', 'c4');

  // 5. Square marker on e4
  await markSquare('e4');

  await page.waitForTimeout(200);
  await page.screenshot({ path: 'scripts/verify_annotations_spec.png' });
  console.log('Annotations screenshot saved to scripts/verify_annotations_spec.png');

  await browser.close();
}

testAnnotations().catch(err => {
  console.error(err);
  process.exit(1);
});
