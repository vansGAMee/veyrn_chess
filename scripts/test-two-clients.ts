import { chromium } from 'playwright';

async function runTwoClientE2ETest() {
  console.log('─── VEYRN TWO-CLIENT E2E BROWSER TEST ───\n');

  const port = process.env.PORT || '3000';
  const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
  const forceRelay = process.env.FORCE_RELAY === '1';
  const dropFirstSignalPost = process.env.DROP_FIRST_SIGNAL_POST === '1';

  const browser = await chromium.launch({ headless: true });

  // Browser Context A (Host)
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await contextA.addInitScript(() => localStorage.setItem('veyrn:country:v1', 'RU'));
  const pageA = await contextA.newPage();

  // Browser Context B (Guest)
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await contextB.addInitScript(() => localStorage.setItem('veyrn:country:v1', 'DE'));

  if (dropFirstSignalPost) {
    for (const context of [contextA, contextB]) {
      let dropped = false;
      await context.route('**/api/signal/**', async (route) => {
        if (!dropped && route.request().method() === 'POST') {
          dropped = true;
          await route.abort('connectionreset');
          return;
        }
        await route.continue();
      });
    }
    console.log('🧪 First signaling POST will be dropped for each client');
  }

  if (forceRelay) {
    for (const context of [contextA, contextB]) {
      await context.addInitScript(() => {
        const NativePeerConnection = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends NativePeerConnection {
          constructor(config?: RTCConfiguration) {
            super({ ...config, iceTransportPolicy: 'relay' });
          }
        } as typeof RTCPeerConnection;
      });
    }
    console.log('🔒 TURN relay-only mode enabled');
  }
  const pageB = await contextB.newPage();

  for (const [label, page] of [['HOST', pageA], ['GUEST', pageB]] as const) {
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning' || message.text().includes('[VEYRN')) {
        console.log(`[${label} ${message.type()}] ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => console.log(`[${label} pageerror] ${error.message}`));
    page.on('requestfailed', (request) => {
      console.log(`[${label} requestfailed] ${request.url()} · ${request.failure()?.errorText}`);
    });
  }

  console.log(`1. Opening Client A (Host) on ${baseUrl}...`);
  await pageA.goto(`${baseUrl}/play`);
  await pageA.waitForSelector('.board-container');
  console.log('✅ Client A: Board is immediately visible on first load');

  // Verify initial board piece count & layout
  const piecesA = await pageA.$$('.piece');
  console.log(`✅ Client A has ${piecesA.length} pieces on the board`);

  // Choose time control 3+0 and Create Room
  console.log('2. Client A creates a new room...');
  const tc3 = await pageA.locator('button.tc-item:has-text("3+0")');
  await tc3.click();

  const createBtn = await pageA.locator('button.control-action-create');
  await createBtn.click();

  await pageA.waitForSelector('.waiting-bar');
  const roomId = await pageA.locator('.waiting-bar').getAttribute('data-room-id');
  if (!roomId) throw new Error('Host did not expose a room ID');
  const urlA = `${baseUrl}/room/${roomId}`;
  console.log(`✅ Client A created room: ${urlA}`);

  // Client B opens room URL directly
  console.log('3. Client B opens room URL...');
  const connectionStartedAt = Date.now();
  await pageB.goto(urlA);
  await pageB.waitForSelector('.board-container');
  console.log('✅ Client B: Room opened, connecting to Host...');

  // Wait for P2P connection to establish (ready state received, playing begins)
  console.log('4. Waiting for P2P connection and game start...');
  await Promise.all([
    pageA.waitForSelector('.resign-btn', { timeout: 30000 }),
    pageB.waitForSelector('.resign-btn', { timeout: 30000 }),
  ]);
  const connectionMs = Date.now() - connectionStartedAt;
  if (connectionMs > 5000) throw new Error(`P2P negotiation took too long: ${connectionMs}ms`);
  console.log(`✅ P2P negotiation completed in ${connectionMs}ms`);

  // Check board orientation on Client A vs Client B
  const clientAColorText = await pageA.locator('.player-row').last().locator('.player-name').innerText();
  const clientBColorText = await pageB.locator('.player-row').last().locator('.player-name').innerText();
  console.log(`✅ Client A player is: "${clientAColorText.trim()}", Client B player is: "${clientBColorText.trim()}"`);

  const countryRows = await Promise.all([
    pageA.locator('.player-row').first().locator('.player-identity-copy strong').innerText(),
    pageA.locator('.player-row').last().locator('.player-identity-copy strong').innerText(),
    pageB.locator('.player-row').first().locator('.player-identity-copy strong').innerText(),
    pageB.locator('.player-row').last().locator('.player-identity-copy strong').innerText(),
  ]);
  if (countryRows.join('/') !== 'DE/RU/RU/DE') {
    throw new Error(`Country handshake mismatch: ${countryRows.join('/')}`);
  }
  console.log('✅ RU and DE flags/codes are distinct and synchronized for both players');

  // Identify who is White
  const isAWhite = clientAColorText.toLowerCase().includes('white');
  const whitePage = isAWhite ? pageA : pageB;
  const blackPage = isAWhite ? pageB : pageA;
  const whiteName = isAWhite ? 'Client A' : 'Client B';
  const blackName = isAWhite ? 'Client B' : 'Client A';

  // Make Move 1 (White: e2 -> e4)
  console.log(`\n5. ${whiteName} (White) drags 1. e2 -> e4 from an off-center grab...`);
  const e2Piece = whitePage.locator('.square[data-sq="e2"] .piece');
  const e4Square = whitePage.locator('.square[data-sq="e4"]');
  const [pieceBox, targetBox] = await Promise.all([e2Piece.boundingBox(), e4Square.boundingBox()]);
  if (!pieceBox || !targetBox) throw new Error('Could not measure drag geometry');
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetBox.y + targetBox.height / 2;
  await whitePage.mouse.move(pieceBox.x + 5, pieceBox.y + 5);
  await whitePage.mouse.down();
  await whitePage.mouse.move(targetX, targetY, { steps: 4 });
  await whitePage.waitForTimeout(50);
  const draggedBox = await whitePage.locator('.piece.dragging').boundingBox();
  if (!draggedBox || Math.abs(draggedBox.x + draggedBox.width / 2 - targetX) > 2 || Math.abs(draggedBox.y + draggedBox.height / 2 - targetY) > 2) {
    throw new Error('Dragged piece did not lock its center to the pointer');
  }
  await whitePage.mouse.up();
  console.log('✅ Off-center grab re-centered the piece exactly under the pointer');

  const whiteE4Local = await whitePage.locator('.square[data-sq="e4"] .piece').count();
  if (whiteE4Local !== 1) {
    const selectedLocator = whitePage.locator('.square.selected');
    const selected = await selectedLocator.count() ? await selectedLocator.first().getAttribute('data-sq') : null;
    throw new Error(`Local move 1. e4 was not committed (selected: ${selected || 'none'})`);
  }

  // Wait for move to propagate over P2P WebRTC to Black
  await blackPage.waitForTimeout(600);

  // Verify Black received 1. e4
  const blackE4Count = await blackPage.locator('.square[data-sq="e4"] .piece').count();
  if (blackE4Count > 0) {
    console.log(`✅ ${blackName} (Black) received move 1. e4 over WebRTC!`);
  } else {
    throw new Error(`Move 1. e4 did not appear on ${blackName}`);
  }

  // Make Move 2 (Black: e7 -> e5)
  console.log(`\n6. ${blackName} (Black) plays 1... e7 -> e5...`);
  const e7Square = blackPage.locator('.square[data-sq="e7"]');
  await e7Square.click();
  await blackPage.waitForTimeout(100);

  const e5Square = blackPage.locator('.square[data-sq="e5"]');
  await e5Square.click();

  // Wait for move to propagate back to White
  await whitePage.waitForTimeout(600);

  const whiteE5Count = await whitePage.locator('.square[data-sq="e5"] .piece').count();
  if (whiteE5Count > 0) {
    console.log(`✅ ${whiteName} (White) received move 1... e5 over WebRTC!`);
  } else {
    throw new Error(`Move 1... e5 did not appear on ${whiteName}`);
  }

  // Make Move 3 (White: 2. Nf3)
  console.log(`\n7. ${whiteName} plays 2. g1 -> f3...`);
  await whitePage.locator('.square[data-sq="g1"]').click();
  await whitePage.locator('.square[data-sq="f3"]').click();
  await blackPage.waitForTimeout(600);

  const blackF3Count = await blackPage.locator('.square[data-sq="f3"] .piece').count();
  if (blackF3Count > 0) {
    console.log(`✅ Move 2. Nf3 synchronized across both clients`);
  } else {
    throw new Error(`Move 2. Nf3 did not appear on ${blackName}`);
  }

  console.log('\n8. Ending the game and verifying the real local ledger...');
  await blackPage.locator('.resign-btn').click();
  await Promise.all([
    whitePage.waitForSelector('.game-end-summary'),
    blackPage.waitForSelector('.game-end-summary'),
  ]);
  if (await whitePage.locator('.game-result-card').count() !== 1) throw new Error('Centered result overlay missing');
  const firstLedgerCounts = await Promise.all([
    pageA.evaluate(() => JSON.parse(localStorage.getItem('veyrn:game-ledger:v1') || '[]').length),
    pageB.evaluate(() => JSON.parse(localStorage.getItem('veyrn:game-ledger:v1') || '[]').length),
  ]);
  if (firstLedgerCounts.some((count) => count !== 1)) throw new Error(`Expected one saved game per player, got ${firstLedgerCounts.join('/')}`);

  console.log('9. Verifying rematch color swap and handshake...');
  await whitePage.locator('.control-action-rematch').click();
  await Promise.all([
    whitePage.waitForSelector('.resign-btn'),
    blackPage.waitForSelector('.resign-btn'),
  ]);
  const rematchColors = await Promise.all([
    pageA.locator('.player-row').last().locator('.player-name').innerText(),
    pageB.locator('.player-row').last().locator('.player-name').innerText(),
  ]);
  if (rematchColors[0].toLowerCase().includes('white') === rematchColors[1].toLowerCase().includes('white')) {
    throw new Error(`Rematch assigned the same color to both players: ${rematchColors.join(' / ')}`);
  }
  console.log('✅ Rematch started with opposite, swapped colors');

  await pageA.locator('.resign-btn').click();
  await Promise.all([
    pageA.waitForSelector('.game-end-summary'),
    pageB.waitForSelector('.game-end-summary'),
  ]);
  await Promise.all([pageA.goto(`${baseUrl}/stats`), pageB.goto(`${baseUrl}/stats`)]);
  await Promise.all([
    pageA.waitForSelector('.ledger-row'),
    pageB.waitForSelector('.ledger-row'),
  ]);
  const [ledgerA, ledgerB] = await Promise.all([
    pageA.locator('.ledger-row').count(),
    pageB.locator('.ledger-row').count(),
  ]);
  if (ledgerA !== 2 || ledgerB !== 2) throw new Error(`Expected two real records per player, got ${ledgerA}/${ledgerB}`);
  console.log('✅ Both players received two real, completed-game statistics records');

  // Test Auto Zen & Mobile viewport on a third context
  console.log('\n10. Testing mobile responsive layout (390x844)...');
  const contextMobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const pageMobile = await contextMobile.newPage();
  await pageMobile.goto(`${baseUrl}/play`);
  await pageMobile.waitForSelector('.board-container');
  const mobileMetrics = await pageMobile.evaluate(() => {
    const board = document.querySelector('.board-container')!.getBoundingClientRect();
    const controls = [...document.querySelectorAll<HTMLElement>('.tc-item')].map((item) => item.getBoundingClientRect().height);
    const create = document.querySelector('.control-action-create')!.getBoundingClientRect().height;
    return { boardWidth: board.width, boardHeight: board.height, controls, create, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  if (Math.abs(mobileMetrics.boardWidth - mobileMetrics.boardHeight) > 0.5) throw new Error('Mobile board is not square');
  if (mobileMetrics.controls.some((height) => height < 44) || mobileMetrics.create < 44) throw new Error('Mobile time controls are below 44px');
  if (mobileMetrics.overflow > 0) throw new Error(`Mobile horizontal overflow: ${mobileMetrics.overflow}px`);
  console.log('✅ Mobile layout verified at 390x844 without horizontal scroll');

  await pageMobile.locator('.square[data-sq="e2"]').tap();
  if (await pageMobile.locator('.square.selected[data-sq="e2"]').count() !== 1) {
    throw new Error('Mobile tap did not select the e2 pawn');
  }
  if (await pageMobile.locator('.square.legal[data-sq="e4"]').count() !== 1) {
    throw new Error('Mobile selection did not highlight e4 as a legal destination');
  }
  await pageMobile.locator('.square[data-sq="e4"]').tap();
  if (await pageMobile.locator('.square[data-sq="e4"] .piece').count() !== 1) {
    throw new Error('Mobile tap-to-move did not commit e2-e4');
  }
  console.log('✅ Mobile tap selects a piece, highlights legal targets and commits the move');

  await browser.close();
  console.log('\n🎉 ALL TWO-CLIENT REAL BROWSER ACCEPTANCE TESTS PASSED!');
}

runTwoClientE2ETest().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
