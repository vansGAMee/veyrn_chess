import { GameEngine } from '../src/engine/GameEngine';
import { Chess } from 'chess.js';

console.log('─── VEYRN CHESS DOMAIN & LOGIC TEST SUITE ───\n');

let passed = 0;
let total = 0;

function assert(condition: boolean, testName: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    process.exitCode = 1;
  }
}

// 1. Starting Board & Sandbox Mode
{
  const engine = new GameEngine();
  const state = engine.getState();
  assert(state.board.pieces.filter(p => p !== null).length === 32, 'Initial board has 32 pieces');
  assert(state.board.turn === 'w', 'Initial turn is White');
  assert(!state.board.isGameOver, 'Initial game is not over');
  
  // Test legal move in idle/sandbox mode
  const success1 = engine.tryMove({ from: 'e2', to: 'e4' });
  assert(success1 === true, 'Sandbox legal move e2-e4 succeeds');
  assert(engine.getState().board.turn === 'b', 'Turn switches to Black');
  
  // Test illegal move rejection
  const success2 = engine.tryMove({ from: 'e7', to: 'e4' });
  assert(success2 === false, 'Illegal move e7-e4 rejected');
  assert(engine.getState().board.turn === 'b', 'Turn remains Black after illegal attempt');

  // Legal black reply
  const success3 = engine.tryMove({ from: 'e7', to: 'e5' });
  assert(success3 === true, 'Sandbox legal move e7-e5 succeeds');
  assert(engine.getState().board.turn === 'w', 'Turn switches back to White');
}

// 2. Castling (Kingside & Queenside)
{
  const engine = new GameEngine();
  engine.startGame('w');
  // 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O
  engine.tryMove({ from: 'e2', to: 'e4' });
  engine.applyRemoteMove('e7', 'e5');
  engine.tryMove({ from: 'g1', to: 'f3' });
  engine.applyRemoteMove('b8', 'c6');
  engine.tryMove({ from: 'f1', to: 'c4' });
  engine.applyRemoteMove('f8', 'c5');
  
  const castleSuccess = engine.tryMove({ from: 'e1', to: 'g1' });
  assert(castleSuccess === true, 'Kingside castling e1-g1 succeeds');
  const fen = engine.getFen();
  assert(fen.includes('r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1'), 'FEN accurately reflects White castled');
}

// 3. En Passant
{
  const engine = new GameEngine();
  engine.startGame('w');
  // 1. e4 a6 2. e5 d5 3. exd6 (e.p.)
  engine.tryMove({ from: 'e2', to: 'e4' });
  engine.applyRemoteMove('a7', 'a6');
  engine.tryMove({ from: 'e4', to: 'e5' });
  engine.applyRemoteMove('d7', 'd5');
  
  const epSuccess = engine.tryMove({ from: 'e5', to: 'd6' });
  assert(epSuccess === true, 'En passant capture e5xd6 succeeds');
}

// 4. Pawn Promotion
{
  const engine = new GameEngine();
  engine.startGame('w');
  // Setup position for promotion via FEN or rapid moves
  // Using direct chess.js checks:
  const chess = new Chess('8/4P3/8/8/8/8/8/4K2k w - - 0 1');
  const promoMove = chess.move({ from: 'e7', to: 'e8', promotion: 'q' });
  assert(promoMove !== null && promoMove.piece === 'p' && promoMove.promotion === 'q', 'Pawn promotion to Queen succeeds');
  const knightPromo = new Chess('8/4P3/8/8/8/8/8/4K2k w - - 0 1').move({ from: 'e7', to: 'e8', promotion: 'n' });
  assert(knightPromo !== null && knightPromo.promotion === 'n', 'Pawn promotion to Knight succeeds');
}

// 5. Scholar's Mate (Checkmate Detection)
{
  const engine = new GameEngine();
  engine.startGame('w');
  // 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#
  engine.tryMove({ from: 'e2', to: 'e4' });
  engine.applyRemoteMove('e7', 'e5');
  engine.tryMove({ from: 'd1', to: 'h5' });
  engine.applyRemoteMove('b8', 'c6');
  engine.tryMove({ from: 'f1', to: 'c4' });
  engine.applyRemoteMove('g8', 'f6');
  engine.tryMove({ from: 'h5', to: 'f7' });
  
  const state = engine.getState();
  assert(state.board.isCheckmate === true, 'Checkmate correctly detected');
  assert(state.board.isGameOver === true, 'Game over correctly triggered');
  assert(state.room.result?.type === 'checkmate' && state.room.result.winner === 'w', 'White declared checkmate winner');
}

// 6. Stalemate Detection
{
  const chess = new Chess('k7/8/1Q6/8/8/8/8/4K3 b - - 0 1');
  assert(chess.isStalemate() === true, 'Stalemate correctly detected');
  assert(chess.isDraw() === true, 'Stalemate is a draw');
}

// 7. Ghost Premove Queue & Automatic Execution
{
  const engine = new GameEngine();
  engine.startGame('w');
  // White makes move: 1. e4
  engine.tryMove({ from: 'e2', to: 'e4' });
  
  // Opponent turn: White queues premove (e.g. 2. Nf3)
  engine.setPremove({ from: 'g1', to: 'f3' });
  assert(engine.getState().premove?.from === 'g1' && engine.getState().premove?.to === 'f3', 'Premove queued during opponent turn');
  
  // Opponent plays 1... e5 -> premove should automatically execute
  const executed = engine.applyRemoteMove('e7', 'e5');
  assert(executed !== null && executed.from === 'g1' && executed.to === 'f3', 'Queued premove automatically executed upon remote move arrival');
  assert(engine.getState().board.turn === 'b', 'Turn correctly passed back to Black after premove');
  assert(engine.getState().premove === null, 'Premove cleared after execution');
}

// 8. Illegal Premove Dissolves Gracefully
{
  const engine = new GameEngine();
  engine.startGame('w');
  engine.tryMove({ from: 'e2', to: 'e4' });
  
  // Queue a premove that becomes blocked/illegal: e.g. White tries e4-e5
  engine.setPremove({ from: 'e4', to: 'e5' });
  
  // Opponent plays 1... e5, blocking e5 square
  const executed = engine.applyRemoteMove('e7', 'e5');
  assert(executed === null, 'Illegal premove dissolves without crashing or applying illegal state');
  assert(engine.getState().premove === null, 'Premove queue emptied after dissolution');
  assert(engine.getState().board.turn === 'w', 'White turn maintained for fresh input');
}

console.log(`\nResults: ${passed}/${total} assertions passed.`);
if (passed === total) {
  console.log('🎉 ALL DOMAIN & LOGIC TESTS PASSED!\n');
} else {
  process.exit(1);
}
