import { chromium } from 'playwright';

async function run() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  const installMocks = () => {
    const testWindow = window as typeof window & {
      __lichessRequests: Array<{ url: string; method: string; body: string }>;
      __lichessGameStream?: ReadableStreamDefaultController<Uint8Array>;
    };
    const encoder = new TextEncoder();
    const send = (message: unknown) => {
      testWindow.__lichessGameStream?.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
    };

    localStorage.setItem('oauth2authcodepkce-state', JSON.stringify({
      isHTTPDecoratorActive: true,
      accessToken: {
        value: 'browser-test-token',
        expiry: new Date(Date.now() + 3_600_000).toString(),
      },
      authorizationCode: 'browser-test-code',
      hasAuthCodeBeenExchangedForAccessToken: true,
      scopes: ['board:play'],
    }));
    localStorage.setItem('veyrn:country:v1', 'RU');
    testWindow.__lichessRequests = [];

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString();
      if (!url.startsWith('https://lichess.org/')) return originalFetch(input, init);

      testWindow.__lichessRequests.push({
        url,
        method: init?.method || 'GET',
        body: init?.body?.toString() || '',
      });

      if (url.endsWith('/api/account')) {
        return new Response(JSON.stringify({ id: 'veyrn-tester', username: 'veyrn-tester' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/user/')) {
        return new Response(JSON.stringify({ profile: { country: 'US' } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/api/stream/event')) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            setTimeout(() => controller.enqueue(encoder.encode(`${JSON.stringify({
              type: 'gameStart',
              game: {
                id: 'mock-game-1',
                color: 'white',
                opponent: { id: 'mock-opponent', username: 'mock-opponent', rating: 1700 },
              },
            })}\n`)), 120);
          },
        }));
      }
      if (url.endsWith('/api/board/seek')) {
        return new Response(new ReadableStream<Uint8Array>({ start() {} }));
      }
      if (url.includes('/api/board/game/stream/mock-game-1')) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            testWindow.__lichessGameStream = controller;
            setTimeout(() => send({
              type: 'gameFull',
              id: 'mock-game-1',
              initialFen: 'startpos',
              white: { id: 'veyrn-tester', name: 'veyrn-tester', rating: 1600 },
              black: { id: 'mock-opponent', name: 'mock-opponent', rating: 1700 },
              state: {
                type: 'gameState', moves: '', wtime: 60000, btime: 60000,
                winc: 0, binc: 0, status: 'started',
              },
            }), 20);
          },
        }));
      }
      if (url.includes('/move/e2e4')) {
        setTimeout(() => send({
          type: 'gameState', moves: 'e2e4', wtime: 59800, btime: 60000,
          winc: 0, binc: 0, status: 'started',
        }), 20);
        setTimeout(() => send({
          type: 'gameState', moves: 'e2e4 e7e5', wtime: 59800, btime: 59900,
          winc: 0, binc: 0, status: 'started',
        }), 70);
        return new Response(JSON.stringify({ ok: true }));
      }
      if (url.endsWith('/resign')) {
        setTimeout(() => send({
          type: 'gameState', moves: 'e2e4 e7e5', wtime: 59800, btime: 59900,
          winc: 0, binc: 0, status: 'resign', winner: 'black',
        }), 20);
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({ ok: true }));
    };
  };
  await context.addInitScript({
    content: `globalThis.__name = (target) => target; (${installMocks.toString()})();`,
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => console.error(`PAGE ERROR: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`BROWSER ERROR: ${message.text()}`);
  });
  await page.goto(`${baseUrl}/play`);
  const lichessButton = page.getByRole('button', { name: /Play a casual 10\+0 game/ });
  await lichessButton.waitFor();
  try {
    await page.getByText('@veyrn-tester').waitFor({ timeout: 3000 });
  } catch (error) {
    console.error(await page.locator('body').innerText());
    console.error(await page.evaluate(() => ({
      oauth: localStorage.getItem('oauth2authcodepkce-state'),
      requests: (window as typeof window & { __lichessRequests?: unknown }).__lichessRequests,
    })));
    throw error;
  }
  await lichessButton.click();

  await page.locator('.resign-btn').waitFor({ timeout: 5000 });
  if (!(await page.locator('.instrument-nav').innerText()).includes('LIVE / LICHESS')) {
    throw new Error('Lichess mode was not shown in the navigation.');
  }
  const opponentRow = await page.locator('.player-row').first().innerText();
  if (!opponentRow.toLowerCase().includes('mock-opponent')) {
    throw new Error(`Lichess opponent was not rendered: ${opponentRow}`);
  }

  const initialClocks = await page.locator('.clock').allTextContents();
  if (initialClocks[0] !== '1:00') {
    throw new Error(`Lichess milliseconds were rendered incorrectly: ${JSON.stringify(initialClocks)}`);
  }

  await page.locator('.square[data-sq="e2"]').click();
  await page.locator('.square[data-sq="e4"]').click();
  await page.locator('.square[data-sq="e5"] .piece').waitFor({ timeout: 5000 });

  const requests = await page.evaluate(() => (
    window as typeof window & { __lichessRequests: Array<{ url: string; method: string; body: string }> }
  ).__lichessRequests);
  const seek = requests.find((request) => request.url.endsWith('/api/board/seek'));
  if (!seek || seek.method !== 'POST' || seek.body !== 'rated=false&time=10&increment=0') {
    throw new Error(`Invalid Lichess seek request: ${JSON.stringify(seek)}`);
  }
  if (!requests.some((request) => request.url.endsWith('/move/e2e4') && request.method === 'POST')) {
    throw new Error('The move was not sent through the Lichess Board API.');
  }

  await page.locator('.resign-btn').click();
  await page.locator('.game-result-card').waitFor({ timeout: 5000 });
  const result = await page.locator('.game-end-summary').innerText();
  if (!result.toLowerCase().includes('resignation') || !result.toLowerCase().includes('black won')) {
    throw new Error(`Unexpected Lichess game result: ${result}`);
  }
  const ledgerSize = await page.evaluate(() => JSON.parse(
    localStorage.getItem('veyrn:game-ledger:v1') || '[]'
  ).length);
  if (ledgerSize !== 1) throw new Error(`Expected one saved Lichess game, got ${ledgerSize}.`);

  const authContext = await browser.newContext();
  const authPage = await authContext.newPage();
  await authPage.route('https://lichess.org/oauth**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<title>Mock Lichess OAuth</title>',
  }));
  await authPage.goto(`${baseUrl}/play`);
  const authButton = authPage.getByRole('button', { name: /Play a casual 10\+0 game/ });
  await authButton.waitFor();
  const [oauthRequest] = await Promise.all([
    authPage.waitForRequest((request) => request.url().startsWith('https://lichess.org/oauth?')),
    authButton.click(),
  ]);
  const oauthUrl = new URL(oauthRequest.url());
  if (
    oauthUrl.searchParams.get('client_id') !== 'veyrn-chess' ||
    oauthUrl.searchParams.get('redirect_uri') !== `${baseUrl}/play` ||
    oauthUrl.searchParams.get('scope') !== 'board:play' ||
    oauthUrl.searchParams.get('code_challenge_method') !== 'S256' ||
    !oauthUrl.searchParams.get('code_challenge')
  ) {
    throw new Error(`Invalid Lichess OAuth request: ${oauthRequest.url()}`);
  }
  await authContext.close();

  await browser.close();
  console.log('Lichess Board API browser flow passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
