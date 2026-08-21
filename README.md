# VEYRN Chess

> **Precision Digital Chess Instrument**  
> A high-performance, free, and open chess platform with tactile play, private local telemetry, and direct peer-to-peer multiplayer.

---

![VEYRN Chess Instrument](docs/screenshots/instrument_board.png)

---

## Overview

**VEYRN Chess** is a modern web-based chess instrument engineered to eliminate platform friction and visual clutter. It combines a multilingual launch page, manufactured-mineral board, direct browser-to-browser rooms, optional Lichess matchmaking, and a detailed behavioral telemetry ledger stored only in the player's browser — with no VEYRN account, trackers, or paywalls.

### Key Highlights

- **Free & Universal Access**: Instant games with no registration or paywalls required.
- **P2P WebRTC Multiplayer**: A first-party serverless signaling route negotiates an encrypted browser-to-browser WebRTC DataChannel, typically in well under one second.
- **Lichess Board API Client**: Optional OAuth PKCE login finds a casual 10+0 opponent on Lichess while moves, clocks, resignation, and the finished PGN remain inside the VEYRN board.
- **Real Waitlist & SVG Country Flags**: Unique email registrations persist in Upstash Redis, while country is detected from IP, synchronized between peers, and remains manually overridable without a VEYRN profile.
- **Private Precision Ledger**: Completed games generate local decision-rhythm, phase-tempo, move-grammar, opening, clock, and network metrics.
- **Obsidian Instrument Aesthetic**: High-contrast, mathematically calibrated OKLCH color palette (Warm Mineral & Deep Cool Slate) with a micro-3D milled board perimeter.
- **Right-Click Planning Layer**: Professional vector analysis arrows and square markers rendered on a non-occluding overlay layer.
- **Hardware-Composited Drag Pipeline**: 60/120 FPS piece manipulation with center-locked pickup, direct pointer capture, sub-pixel tracking, and zero React render overhead during drags.
- **Mobile-First Game Controls**: 44px+ time presets, an explicit private-room action, and a centered post-game report with rematch, PGN and statistics actions.
- **Procedural Web Audio Engine**: Synthesized tactile stone-on-mineral clicks, deep sub-frequency capture impacts, and spatial stereo panning across board files.
- **Tabular Precision Clocks**: Monospace tabular numerals synchronized across peers with side-specific active indicators.

---

## Visual Previews

| Analysis & Planning Arrows | Active Game & Move Echo |
| :---: | :---: |
| ![Planning Arrows](docs/screenshots/planning_arrows.png) | ![Active Game](docs/screenshots/in_game.png) |

---

## Architecture & Technology Stack

```
VEYRN.ru/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── signal/[roomId]/route.ts  # Ephemeral Serverless WebRTC Signaling
│   │   ├── room/[id]/page.tsx            # P2P Guest Route
│   │   ├── globals.css                   # Obsidian Instrument Design Tokens & Geometry
│   │   ├── layout.tsx                    # Typography & Root Layout
│   │   ├── page.tsx                      # Marketing landing page
│   │   ├── play/page.tsx                 # Host & Sandbox Interface
│   │   ├── stats/page.tsx                # Private local telemetry ledger
│   │   └── privacy/page.tsx              # Plain-language privacy policy
│   ├── components/
│   │   ├── Chessboard.tsx                # Drag Pipeline, Planning Layer & Signal Rail
│   │   ├── Clock.tsx                     # Tabular Monospace Readout
│   │   ├── GameControls.tsx              # Compact Glass Control Strip
│   │   ├── GamePage.tsx                  # Engine & Transport Orchestrator
│   │   ├── Pieces.tsx                    # Custom Scalable Vector Piece Family
│   │   └── PromotionDialog.tsx           # Pawn Promotion Selector
│   ├── engine/
│   │   ├── GameEngine.ts                 # Chess Domain Coordinator (chess.js wrapper)
│   │   └── SoundEngine.ts                # Web Audio Procedural Synthesis
│   ├── lib/lichess.ts                     # OAuth PKCE + official Lichess Board API client
│   ├── transport/
│   │   └── GameTransport.ts              # WebRTC transport + serverless negotiation
│   └── types/
│       ├── chess.ts                      # Domain Models & Time Controls
│       └── protocol.ts                   # Binary/JSON Wire Protocol Envelopes
├── scripts/
│   ├── test-engine.ts                    # 26 Domain & Game Logic Assertions
│   ├── test-signaling.ts                 # Serverless Signaling Integration Tests
│   └── test-two-clients.ts               # Multi-Client Playwright E2E Test
├── docs/
│   └── screenshots/                      # Architecture & UI Screenshots
└── package.json
```

### Core Technologies

- **Framework**: Next.js 16 (App Router, Turbopack, Serverless API Routes)
- **Language**: TypeScript 5 (Strict Mode)
- **Domain Engine**: `chess.js` 1.4.0 (Full FIDE Rule Compliance, PGN Generation, En Passant, Castling, 50-Move & Threefold Draw Detection)
- **Multiplayer Transport**: WebRTC DataChannels with first-party serverless signaling and optional TURN fallback
- **Public Matchmaking**: Official Lichess Board API with browser-side OAuth 2.0 PKCE; casual rapid 10+0 only
- **Production Storage**: Upstash Redis for signaling messages and unique waitlist registrations
- **Acoustics**: Web Audio API (Synthesized BiquadFilters, stereo spatial panning, sub-bass oscillator transients)
- **Styling**: Vanilla CSS with CSS Custom Properties and OKLCH color space

---

## Launch Roadmap & Milestone

VEYRN is launch-ready for invite-link games and optional Lichess rapid matchmaking; the public waitlist is collecting demand for native VEYRN matchmaking.

- [x] **Phase 1**: Core Chess Engine & Domain Logic (26/26 Tests Passing)
- [x] **Phase 2**: Dual-Channel WebRTC P2P Transport & Session Recovery
- [x] **Phase 3**: Obsidian Instrument Design System & Hardware Drag Engine
- [x] **Phase 4**: Right-Click Planning Vector Layer & Raycast-Style Control Strip
- [x] **Phase 5 (Launch Platform)**: Multilingual landing page, private player telemetry, and database-free P2P room discovery.
- [x] **Phase 6**: Official Lichess Board API client with OAuth PKCE, casual rapid search, clock synchronization, premoves, results, and local statistics.
- [ ] **Phase 7**: Engine Analysis integration (Stockfish 17 via WebAssembly) & opening book explorer.

---

## Getting Started

### Prerequisites

- Node.js 18.18+ or 20+
- npm, pnpm, or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/vansGAMee/veyrn_chess.git

# Enter project directory
cd veyrn_chess

# Install dependencies
npm install
```

### Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the landing page or [http://localhost:3000/play](http://localhost:3000/play) for the board.

### Free Vercel deployment

1. In Vercel, choose **Add New → Project**, import `vansGAMee/veyrn_chess`, keep the detected **Next.js** preset, and deploy.
2. Create a free Redis database at Upstash, then open **Project → Settings → Environment Variables** in Vercel.
3. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for **Production, Preview and Development**. These values power multi-instance room signaling and the unique waitlist counter.
4. Open **Deployments**, select the latest deployment and choose **Redeploy** so the new variables are included.
5. Verify `/api/waitlist`, create a room in one browser, and open its URL in another browser or device.

No paid service is required for the MVP. Public STUN is built in. TURN is optional for restrictive corporate/VPN/mobile NATs; if you add it, set `NEXT_PUBLIC_TURN_URLS`, `NEXT_PUBLIC_TURN_USERNAME` and `NEXT_PUBLIC_TURN_CREDENTIAL` from a trusted provider and redeploy. Never commit Redis or TURN credentials.

### Running Test Suites

```bash
# Run domain engine & logic tests (26 assertions)
npx tsx scripts/test-engine.ts

# Run WebRTC signaling endpoint tests
npx tsx scripts/test-signaling.ts

# Run full automated Playwright dual-client E2E test
npx tsx scripts/test-two-clients.ts

# Run the mocked Lichess OAuth, seek, move, clock, result, and ledger flow
npx tsx scripts/test-lichess-client.ts
```

### Production Build

```bash
npm run build
npm start
```

---

## License

This project is licensed under the MIT License — free and open for the global chess community.
