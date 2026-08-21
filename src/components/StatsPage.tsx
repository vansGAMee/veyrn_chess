'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { clearGameRecords, readGameRecords, summarizeGameRecords, type GameRecord } from '@/lib/gameStats';
import { countryCodeToFlag } from '@/lib/countries';
import { useCountry } from '@/lib/useCountry';

const seconds = (value: number) => value > 0 ? `${(value / 1000).toFixed(1)}s` : '—';

export default function StatsPage() {
  const [storedRecords, setStoredRecords] = useState<GameRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { country } = useCountry();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setStoredRecords(readGameRecords());
      setLoaded(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const records = storedRecords;
  const metrics = useMemo(() => summarizeGameRecords(records), [records]);

  const exportLedger = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(storedRecords, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'veyrn-game-ledger.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearLedger = () => {
    clearGameRecords();
    setStoredRecords([]);
  };

  const maxPhase = Math.max(...metrics.phase, 1);
  const chartPoints = records.slice().reverse().map((record, index, all) => {
    const x = all.length === 1 ? 50 : (index / (all.length - 1)) * 100;
    const y = 92 - Math.min(78, (record.avgThinkMs / Math.max(metrics.slowest, 1)) * 100);
    return `${x},${y}`;
  }).join(' ');

  return (
    <main className="stats-shell">
      <header className="stats-header"><Link href="/" className="site-logo">VEYRN CHESS</Link><nav><Link href="/">SYSTEM</Link><span>STATISTICS</span><Link href="/play">BOARD</Link></nav><Link className="site-launch" href="/play">LAUNCH</Link></header>

      <section className="stats-titlebar">
        <div><p className="tech-eyebrow"><i />LOCAL PRECISION LEDGER</p><h1>PLAYER<br />TELEMETRY</h1></div>
        <div className="stats-profile"><span>PLAYER / THIS DEVICE</span><strong>{countryCodeToFlag(country)} {country}</strong><small>{loaded ? `${records.length} RECORDED GAMES` : 'READING LEDGER'}</small></div>
      </section>

      {loaded && records.length === 0 && <div className="demo-notice"><strong>ЖУРНАЛ ПУСТ</strong><span>Здесь нет тестовых данных. Завершите онлайн-партию — результат, ходы и реальные тайминги появятся автоматически.</span><Link href="/play">PLAY →</Link></div>}

      <section className="stats-overview">
        <div className="stat-hero"><small>RHYTHM CONSISTENCY</small><strong>{metrics.decisionSamples >= 3 ? metrics.consistency.toFixed(1) : '—'}</strong><span>requires 3 measured decisions</span></div>
        <div><small>GAMES</small><strong>{records.length.toString().padStart(2, '0')}</strong><span>{metrics.wins}W / {metrics.losses}L / {metrics.draws}D</span></div>
        <div><small>DECISIONS</small><strong>{metrics.moves}</strong><span>legal moves recorded</span></div>
        <div><small>AVG THINK</small><strong>{seconds(metrics.avgThink)}</strong><span>per local move</span></div>
        <div><small>TIME RESERVE</small><strong>{records.length ? `${Math.round(metrics.reserve)}s` : '—'}</strong><span>at game termination</span></div>
      </section>

      <section className="stats-grid-main">
        <article className="stats-module rhythm-detail">
          <header><span>01 / DECISION RHYTHM</span><small>TIME / MOVE</small></header>
          <div className="detail-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M0 25H100M0 50H100M0 75H100" />{chartPoints && <polyline points={chartPoints} />}</svg><span className="axis-y">SLOW<br /><br />NOMINAL<br /><br />FAST</span></div>
          <div className="detail-numbers"><div><small>FASTEST</small><strong>{seconds(metrics.fastest)}</strong></div><div><small>MEDIAN</small><strong>{seconds(metrics.medianThink)}</strong></div><div><small>SLOWEST</small><strong>{seconds(metrics.slowest)}</strong></div></div>
        </article>

        <article className="stats-module outcome-detail">
          <header><span>02 / OUTCOME FIELD</span><small>{records.length} SAMPLES</small></header>
          {[['WINS', metrics.wins], ['DRAWS', metrics.draws], ['LOSSES', metrics.losses]].map(([label, value]) => <div className="outcome-row" key={label}><span>{label}</span><div><i style={{ width: `${(Number(value) / Math.max(records.length, 1)) * 100}%` }} /></div><strong>{value}</strong></div>)}
          <div className="outcome-rate"><strong>{metrics.winRate.toFixed(1)}%</strong><span>CONVERSION RATE</span></div>
        </article>

        <article className="stats-module phase-detail">
          <header><span>03 / PHASE TEMPO</span><small>BEHAVIORAL</small></header>
          {['OPENING', 'MIDDLEGAME', 'ENDGAME'].map((label, index) => <div className="phase-row" key={label}><span>{label}</span><div><i style={{ width: `${(metrics.phase[index] / maxPhase) * 100}%` }} /></div><strong>{seconds(metrics.phase[index])}</strong></div>)}
          <p>Measures decision time by game phase. No engine score is used.</p>
        </article>

        <article className="stats-module grammar-detail">
          <header><span>04 / MOVE GRAMMAR</span><small>TOTAL EVENTS</small></header>
          <div className="grammar-grid"><div><strong>{metrics.captures}</strong><span>CAPTURES</span></div><div><strong>{metrics.checks}</strong><span>CHECKS</span></div><div><strong>{metrics.castles}</strong><span>CASTLES</span></div><div><strong>{(metrics.captures / Math.max(metrics.moves, 1) * 100).toFixed(1)}%</strong><span>CONTACT RATE</span></div></div>
        </article>

        <article className="stats-module opening-detail">
          <header><span>05 / OPENING MATRIX</span><small>FIRST MOVES</small></header>
          {metrics.openings.length === 0 && <p className="module-empty">No completed games</p>}
          {metrics.openings.slice(0, 5).map(([opening, count], index) => <div className="opening-row" key={opening}><span>0{index + 1}</span><strong>{opening}</strong><i>{count}×</i></div>)}
        </article>

        <article className="stats-module network-detail">
          <header><span>06 / NETWORK SIGNAL</span><small>WEBRTC</small></header>
          <div className="network-readout"><strong>{records.length && metrics.medianLatency ? Math.round(metrics.medianLatency) : '—'}<sup>ms</sup></strong><span>MEDIAN PATH</span></div>
          <dl><div><dt>TOPOLOGY</dt><dd>{records.some((record) => record.relay) ? 'DIRECT / RELAY' : 'P2P DIRECT'}</dd></div><div><dt>PRIVACY</dt><dd>END-TO-END</dd></div><div><dt>RELAY GAMES</dt><dd>{records.filter((record) => record.relay).length}</dd></div><div><dt>STORAGE</dt><dd>THIS DEVICE</dd></div></dl>
        </article>
      </section>

      <section className="ledger-table">
        <header><div><span>07 / GAME LEDGER</span><small>RECENT SESSIONS</small></div><div>{records.length > 0 && <button onClick={exportLedger}>EXPORT JSON</button>}{records.length > 0 && <button onClick={clearLedger}>CLEAR LOCAL DATA</button>}</div></header>
        <div className="ledger-head"><span>DATE</span><span>RESULT</span><span>COLOR</span><span>OPENING</span><span>TC</span><span>MOVES</span><span>AVG</span><span>PATH</span></div>
        {records.slice(0, 8).map((record) => <div className="ledger-row" key={record.id}><span>{new Date(record.completedAt).toLocaleDateString('ru-RU')}</span><strong data-outcome={record.outcome}>{record.outcome.toUpperCase()}</strong><span>{record.playerColor === 'w' ? 'WHITE' : 'BLACK'}</span><span>{record.opening}</span><span>{record.timeControl}</span><span>{record.localMoves}</span><span>{seconds(record.avgThinkMs)}</span><span>{record.networkLatencyMs ? `${Math.round(record.networkLatencyMs)}ms` : 'LOCAL'}</span></div>)}
        {loaded && records.length === 0 && <div className="ledger-empty">NO RECORDED SESSIONS</div>}
      </section>

      <section className="stats-method"><span>METHOD / 08</span><h2>ДАННЫЕ, КОТОРЫМ<br />НЕ НУЖЕН ПРОФИЛЬ.</h2><p>VEYRN сохраняет завершённые партии, тайминги решений и сетевую телеметрию только в localStorage этого браузера. Статистика не выдаёт оценку движка за факт: здесь измеряются наблюдаемые действия.</p><Link className="button-primary" href="/play">START NEW SAMPLE <span>↗</span></Link></section>
      <footer className="site-footer"><strong>VEYRN / LOCAL LEDGER V1</strong><div><Link href="/">SYSTEM</Link><Link href="/play">BOARD</Link></div></footer>
    </main>
  );
}
