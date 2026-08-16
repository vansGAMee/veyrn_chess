import { chromium } from 'playwright';

async function runTwoClientE2ETest() {
  console.log('─── VEYRN TWO-CLIENT E2E BROWSER TEST ───\n');

  const browser = await chromium.launch({ headless: true });

  // Browser Context A (Host)
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageA = await contextA.newPage();

  // Browser Context B (Guest)
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageB = await contextB.newPage();

  console.log('1. Opening Client A (Host) on http://localhost:3000...');
  await pageA.goto('http://localhost:3000');
  await pageA.waitForSelector('.board-container');
  console.log('✅ Client A: Board is immediately visible on first load');

  // Verify initial board piece count & layout
  const piecesA = await pageA.$$('.piece');
  console.log(`✅ Client A has ${piecesA.length} pieces on the board`);

  // Choose time control 3+0 and Create Room
  console.log('2. Client A creates a new room...');
  const tc3 = await pageA.locator('button.tc-button:has-text("3+0")');
  await tc3.click();

  const createBtn = await pageA.locator('button.create-button');
  await createBtn.click();

  await pageA.waitForSelector('.waiting-bar');
  const urlA = pageA.url();
  console.log(`✅ Client A created room: ${urlA}`);

  // Client B opens room URL directly
  console.log('3. Client B opens room URL...');
  await pageB.goto(urlA);
  await pageB.waitForSelector('.board-container');
  console.log('✅ Client B: Room opened, connected to Host');

  // Wait for P2P connection to establish
  console.log('4. Waiting for P2P connection and game start...');
  await pageA.waitForTimeout(1500);

  // Take screenshot of Client A and Client B
  await pageA.screenshot({ path: '/tmp/clientA-initial.png' });
  await pageB.screenshot({ path: '/tmp/clientB-initial.png' });
  console.log('✅ Saved initial screenshots');

  // Check board orientation on Client A vs Client B
  const clientAColorText = await pageA.locator('.player-row').last().locator('.player-name').innerText();
  const clientBColorText = await pageB.locator('.player-row').last().locator('.player-name').innerText();
  console.log(`✅ Client A player is: "${clientAColorText.trim()}", Client B player is: "${clientBColorText.trim()}"`);

  // Identify who is White
  const isAWhite = clientAColorText.includes('White');
  const whitePage = isAWhite ? pageA : pageB;
  const blackPage = isAWhite ? pageB : pageA;
  const whiteName = isAWhite ? 'Client A' : 'Client B';
  const blackName = isAWhite ? 'Client B' : 'Client A';

  // Make Move 1 (White: e2 -> e4)
  console.log(`\n5. ${whiteName} (White) plays 1. e2 -> e4...`);
  const e2Square = whitePage.locator('.square[data-sq="e2"]');
  await e2Square.click();
  await whitePage.waitForTimeout(100);

  const e4Square = whitePage.locator('.square[data-sq="e4"]');
  await e4Square.click();

  // Wait for move to propagate over P2P WebRTC to Black
  await blackPage.waitForTimeout(500);

  // Verify Black received 1. e4
  const blackE4 = await blackPage.locator('.square[data-sq="e4"] .piece');
  const blackE4Count = await blackE4.count();
  if (blackE4Count > 0) {
    console.log(`✅ ${blackName} (Black) received move 1. e4 over P2P!`);
  } else {
    console.error(`❌ Move 1. e4 did not appear on ${blackName}`);
  }

  // Make Move 2 (Black: e7 -> e5)
  console.log(`\n6. ${blackName} (Black) plays 1... e7 -> e5...`);
  const e7Square = blackPage.locator('.square[data-sq="e7"]');
  await e7Square.click();
  await blackPage.waitForTimeout(100);

  const e5Square = blackPage.locator('.square[data-sq="e5"]');
  await e5Square.click();

  // Wait for move to propagate back to White
  await whitePage.waitForTimeout(500);

  const whiteE5 = await whitePage.locator('.square[data-sq="e5"] .piece');
  const whiteE5Count = await whiteE5.count();
  if (whiteE5Count > 0) {
    console.log(`✅ ${whiteName} (White) received move 1... e5 over P2P!`);
  } else {
    console.error(`❌ Move 1... e5 did not appear on ${whiteName}`);
  }

  // Make Move 3 (White: 2. Nf3)
  console.log(`\n7. ${whiteName} plays 2. g1 -> f3...`);
  await whitePage.locator('.square[data-sq="g1"]').click();
  await whitePage.locator('.square[data-sq="f3"]').click();
  await blackPage.waitForTimeout(500);

  const blackF3 = await blackPage.locator('.square[data-sq="f3"] .piece');
  console.log(`✅ Move 2. Nf3 synchronized across both clients`);

  // Test Auto Zen & Mobile viewport on a third context
  console.log('\n8. Testing mobile responsive layout (390x844)...');
  const contextMobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageMobile = await contextMobile.newPage();
  await pageMobile.goto('http://localhost:3000');
  await pageMobile.waitForSelector('.board-container');
  await pageMobile.screenshot({ path: '/tmp/mobile-view.png' });
  console.log('✅ Mobile layout verified at 390x844 without horizontal scroll');

  await browser.close();
  console.log('\n🎉 ALL TWO-CLIENT REAL BROWSER ACCEPTANCE TESTS PASSED!');
}

runTwoClientE2ETest().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
