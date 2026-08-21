# I built a browser chess client that can play Lichess games without becoming another chess server

I wanted a chess board that felt precise, opened without an account, and told me something useful after the game. I did not want to build another closed player pool and then pretend that an empty matchmaking queue was a feature.

That became [VEYRN Chess](https://veyrn-chess.vercel.app): a free, open-source chess client with two ways to play online.

- Send a private-room link and play directly browser to browser over WebRTC.
- Connect a Lichess account and find a casual 10+0 opponent through the official Lichess Board API while staying on the VEYRN board.

The source is on [GitHub](https://github.com/vansGAMee/veyrn_chess).

## The empty-network problem

A new multiplayer product starts with a cruel loop: no players means slow matchmaking, and slow matchmaking means no players.

Private rooms solve half of it. The host creates a link, the guest opens it, a short-lived serverless signaling route exchanges WebRTC offers and ICE candidates, and the game then moves to an encrypted DataChannel. The signaling data expires after a few minutes; it is not a game archive.

But a private link is useless when your friends are offline. For that case VEYRN can act as a Lichess client. OAuth uses PKCE in the browser, VEYRN opens the official Board API event stream, starts a casual rapid seek, and sends legal moves back to Lichess. Lichess remains the server and source of truth; VEYRN is only the interface.

This is deliberately not bot scraping and not an unofficial bridge. It uses the API Lichess provides for third-party boards and clients.

## The board had to earn its place

Most chess interfaces are usable. The harder target is making the board disappear under your hand.

VEYRN uses pointer capture and transform-based dragging so a piece stays locked to the pointer instead of jumping toward whichever edge was grabbed. Click-to-move and drag-to-move share the same legal-move path. Premoves are shown as a separate visual state and are revalidated when the turn changes. Right-click arrows and square markers live on a non-blocking SVG layer, so planning marks never steal a move.

The visual problem was just as concrete. Coordinates, legal-move dots, last-move squares, check state, pieces and arrows all compete for contrast. I ended up treating the board as an instrument panel: restrained mineral squares, a high-contrast piece set, crisp coordinates, and state colors that remain distinct from both square colors.

On mobile, time controls are full-size targets rather than tiny inline links. The end-of-game report sits over the board and gives the useful actions immediately: next opponent, private room, PGN, or the behavioral report.

## Statistics that stay on the device

VEYRN records completed games in local browser storage. The report goes beyond wins and losses:

- think time by opening, middlegame and endgame;
- clock pressure and time-spending distribution;
- move timing and decision rhythm;
- captures, checks, castling and move-pattern summaries;
- network mode and country matchup context;
- finished PGN.

There is no VEYRN profile and no cloud game history. Deleting browser data deletes the ledger. The site uses anonymous, cookie-free Vercel page-view analytics, but moves, PGNs and local reports are not sent with those events.

Country flags are detected approximately from the connection and can be overridden manually. In a private room each side receives the other player's selected country code, so two players do not collapse into one default flag.

## What was unexpectedly difficult

Three parts took more time than the headline features:

1. **Serverless signaling latency.** A serverless instance cannot be treated like a permanent WebSocket process. Messages need short polling, deduplication, expiry and recovery without making room creation feel stalled.
2. **Authoritative remote state.** A Lichess stream may reconnect or deliver state after the local animation. The client must reconcile clocks, move history and results without accepting an optimistic illegal move.
3. **Input geometry.** A board that looks correct can still feel wrong. Pointer coordinates, board orientation, transforms and capture all have to agree at every viewport size.

## Try to break it

Open [VEYRN Chess](https://veyrn-chess.vercel.app), choose a time control, and either create a private room or use **Play on Lichess**. No VEYRN registration is required.

I am especially interested in blunt feedback about three things: how the first piece pickup feels, whether board states remain readable on your display, and whether the local report reveals anything you would actually use before the next game.

Repository: [github.com/vansGAMee/veyrn_chess](https://github.com/vansGAMee/veyrn_chess)

Suggested tags: `webdev`, `javascript`, `opensource`, `chess`
