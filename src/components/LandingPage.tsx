'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CountrySelect } from '@/components/CountrySelect';
import { CountryFlag } from '@/components/CountryFlag';
import { useCountry } from '@/lib/useCountry';
import { readGameRecords, summarizeGameRecords, type GameRecord } from '@/lib/gameStats';

const copy = {
  ru: {
    nav: ['СИСТЕМА', 'ТЕЛЕМЕТРИЯ', 'ПРОТОКОЛ'],
    launch: 'ЗАПУСТИТЬ',
    eyebrow: 'P2P / БЕЗ АККАУНТА / ЛОКАЛЬНЫЙ ЖУРНАЛ',
    titleA: 'VEYRN',
    titleB: 'CHESS',
    lead: 'Шахматная платформа как точный цифровой инструмент: мгновенная онлайн-партия, премиальная контрастная доска и статистика поведения, которой нет в обычных профилях.',
    play: 'ИГРАТЬ ОНЛАЙН',
    stats: 'ОТКРЫТЬ СТАТИСТИКУ',
    verified: 'СИСТЕМА ГОТОВА / WEBRTC ЗАШИФРОВАН',
    waitlistPlaceholder: 'ВАШ EMAIL',
    waitlistButton: 'ВСТАТЬ В СПИСОК',
    waitlistPrivacy: 'Только уведомление о запуске подбора. Без профиля и рассылок.',
    statTitle: 'НЕ ТОЛЬКО СЧЁТ. ВАШ ПОЧЕРК.',
    statLead: 'VEYRN измеряет то, что теряют обычные рейтинги: ритм решений, темп по фазам, структуру ходов, остаток времени и качество соединения.',
    privacy: 'Без движка, трекеров и облачного профиля. Журнал партий остаётся в вашем браузере.',
    protocolTitle: 'ССЫЛКА — ЭТО И ЕСТЬ КОМНАТА.',
    protocolLead: 'Никаких регистраций и ожидания соперника в очереди. Создайте защищённую комнату и отправьте URL.',
    steps: ['ВЫБЕРИТЕ КОНТРОЛЬ', 'СОЗДАЙТЕ КОМНАТУ', 'ПЕРЕДАЙТЕ ХОД'],
    boardSpecs: [['CENTER-LOCK', 'Фигура всегда под центром курсора'], ['DUAL CONTRAST', 'Каждая фигура читается на любом поле'], ['ENGRAVED GRID', 'Координаты видны без напряжения'], ['MOBILE FIRST', 'Крупные контролы и точный touch']],
    globalTitle: 'СОЗДАНО ДЛЯ ИГРОКОВ БЕЗ ГРАНИЦ.',
    globalLead: 'Русский — полноценный язык платформы. Международные игровые комнаты работают по одной ссылке.',
    final: 'ДОСКА УЖЕ ГОТОВА.',
  },
  en: {
    nav: ['SYSTEM', 'TELEMETRY', 'PROTOCOL'],
    launch: 'LAUNCH',
    eyebrow: 'P2P / ZERO ACCOUNT / LOCAL LEDGER',
    titleA: 'VEYRN',
    titleB: 'CHESS',
    lead: 'A chess platform built as a precision digital instrument: instant online play, a premium high-contrast board and behavioral statistics that ordinary profiles never capture.',
    play: 'PLAY ONLINE',
    stats: 'OPEN STATISTICS',
    verified: 'SYSTEM READY / WEBRTC ENCRYPTED',
    waitlistPlaceholder: 'YOUR EMAIL',
    waitlistButton: 'JOIN WAITLIST',
    waitlistPrivacy: 'One matchmaking launch notice. No profile and no newsletters.',
    statTitle: 'NOT JUST A SCORE. YOUR SIGNATURE.',
    statLead: 'VEYRN measures what ratings discard: decision rhythm, phase tempo, move structure, clock reserve and connection quality.',
    privacy: 'No engine, trackers or cloud profile. Your game ledger stays in your browser.',
    protocolTitle: 'THE LINK IS THE ROOM.',
    protocolLead: 'No registration and no matchmaking queue. Create an encrypted room and send the URL.',
    steps: ['SELECT CONTROL', 'CREATE ROOM', 'TRANSMIT MOVE'],
    boardSpecs: [['CENTER-LOCK', 'Every piece locks to the cursor center'], ['DUAL CONTRAST', 'Every piece reads on every square'], ['ENGRAVED GRID', 'Coordinates remain unmistakable'], ['MOBILE FIRST', 'Large controls and precise touch']],
    globalTitle: 'BUILT FOR PLAYERS WITHOUT BORDERS.',
    globalLead: 'Russian is a first-class platform language. International rooms work through one shared link.',
    final: 'THE BOARD IS READY.',
  },
};

function MiniBoard() {
  return (
    <div className="hero-board" aria-hidden="true">
      <div className="hero-board-rail" />
      {Array.from({ length: 64 }, (_, index) => (
        <span className={(Math.floor(index / 8) + index) % 2 ? 'dark' : 'light'} key={index} />
      ))}
    </div>
  );
}

export default function LandingPage() {
  const [language, setLanguage] = useState<'ru' | 'en'>('ru');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [waitlistCount, setWaitlistCount] = useState<number | null>(null);
  const [waitlistState, setWaitlistState] = useState<'idle' | 'sending' | 'joined' | 'exists' | 'error'>('idle');
  const [waitlistMessage, setWaitlistMessage] = useState('');
  const [records, setRecords] = useState<GameRecord[]>([]);
  const { country, setCountry, source: countrySource } = useCountry();
  const t = copy[language];
  const metrics = useMemo(() => summarizeGameRecords(records), [records]);
  const rhythmPoints = records.slice(0, 18).reverse().map((record, index, all) => {
    const x = all.length === 1 ? 310 : (index / (all.length - 1)) * 620;
    const y = 132 - Math.min(108, (record.avgThinkMs / Math.max(metrics.slowest, 1)) * 108);
    return `${x},${y}`;
  }).join(' ');

  useEffect(() => {
    const frame = requestAnimationFrame(() => setRecords(readGameRecords()));
    fetch('/api/waitlist', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { count: number }) => setWaitlistCount(data.count))
      .catch(() => {
        setWaitlistState('error');
        setWaitlistMessage('Список ожидания временно недоступен / Waitlist unavailable');
      });
    return () => cancelAnimationFrame(frame);
  }, []);

  const joinWaitlist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWaitlistState('sending');
    setWaitlistMessage('');
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, country, website }),
      });
      const data = await response.json() as { count?: number; joined?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || 'Request failed');
      setWaitlistCount(data.count ?? waitlistCount);
      setWaitlistState(data.joined ? 'joined' : 'exists');
      setWaitlistMessage(data.joined
        ? (language === 'ru' ? 'Вы в списке. Сообщим один раз при запуске подбора.' : 'You are on the list. We will send one launch notice.')
        : (language === 'ru' ? 'Этот email уже в списке.' : 'This email is already on the list.'));
      setEmail('');
    } catch (error) {
      setWaitlistState('error');
      setWaitlistMessage(error instanceof Error ? error.message : 'Request failed');
    }
  };

  return (
    <main className="site-shell">
      <header className="site-header">
        <Link className="site-logo" href="/">VEYRN CHESS</Link>
        <nav className="site-nav" aria-label="Main navigation">
          <a href="#system">{t.nav[0]}</a>
          <a href="#telemetry">{t.nav[1]}</a>
          <a href="#protocol">{t.nav[2]}</a>
        </nav>
        <div className="site-actions">
          <div className="language-switch" aria-label="Language">
            <button className={language === 'ru' ? 'active' : ''} onClick={() => setLanguage('ru')} aria-label="Русский">🇷🇺 <span>RU</span></button>
            <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} aria-label="English">🇬🇧 <span>EN</span></button>
          </div>
          <Link className="site-launch" href="/play">{t.launch}</Link>
        </div>
      </header>

      <section className="hero-section" id="system">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-copy">
          <p className="tech-eyebrow"><i />{t.eyebrow}</p>
          <h1><span>{t.titleA}</span><span>{t.titleB}</span></h1>
          <p className="hero-lead">{t.lead}</p>
          <div className="hero-actions">
            <Link className="button-primary" href="/play">{t.play}<span>↗</span></Link>
            <Link className="button-technical" href="/stats">{t.stats}<span>→</span></Link>
          </div>
          <form className="waitlist-form" onSubmit={joinWaitlist}>
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t.waitlistPlaceholder} autoComplete="email" aria-label={t.waitlistPlaceholder} />
            <input className="waitlist-trap" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" />
            <button type="submit" disabled={waitlistState === 'sending'}>{waitlistState === 'sending' ? '…' : t.waitlistButton}</button>
          </form>
          <p className="waitlist-note">{t.waitlistPrivacy} <Link href="/privacy">PRIVACY</Link></p>
          <p className="waitlist-feedback" aria-live="polite">{waitlistMessage}</p>
          <p className="system-status"><i />STATUS: [{waitlistCount === null ? '—' : waitlistCount}] / 3000 WAITING · {t.verified}</p>
        </div>
        <div className="hero-object">
          <div className="hero-index"><span>BOARD / 01</span><span>64 × CALIBRATED</span></div>
          <MiniBoard />
          <div className="hero-object-label"><span>OBSIDIAN INSTRUMENT</span><span>READY</span></div>
        </div>
        <div className="calibration-strip" aria-hidden="true">
          {Array.from({ length: 64 }, (_, index) => <i className={index < 46 ? 'active' : ''} key={index} />)}
        </div>
      </section>

      <section className="telemetry-section" id="telemetry">
        <div className="section-index"><span>02</span><span>PLAYER TELEMETRY</span></div>
        <div className="section-intro">
          <h2>{t.statTitle}</h2>
          <div>
            <p>{t.statLead}</p>
            <p className="privacy-note">{t.privacy}</p>
          </div>
        </div>

        <div className="telemetry-panel">
          <div className="telemetry-head">
            <span>PLAYER / THIS DEVICE</span><span>LAST {Math.min(records.length, 30)} GAMES</span><span className="live-label"><i /> {records.length ? 'LEDGER ACTIVE' : 'AWAITING FIRST GAME'}</span>
          </div>
          <div className="telemetry-primary">
            <div className="win-module"><small>RHYTHM CONSISTENCY</small><strong>{metrics.decisionSamples >= 3 ? metrics.consistency.toFixed(1) : '—'}</strong><span>{records.length ? `${metrics.moves} RECORDED MOVES` : 'NO SAMPLES'}</span></div>
            <div className="rhythm-module">
              <div className="module-label"><span>DECISION RHYTHM</span><span>{metrics.avgThink ? `${(metrics.avgThink / 1000).toFixed(1)}s AVG` : 'NO DATA'}</span></div>
              <svg viewBox="0 0 620 150" preserveAspectRatio="none" role="img" aria-label="Decision rhythm sample chart">
                <path className="chart-grid" d="M0 30H620M0 75H620M0 120H620" />
                {rhythmPoints && <polyline className="chart-line" points={rhythmPoints} />}
              </svg>
              <div className="chart-axis"><span>OPENING</span><span>MIDDLEGAME</span><span>ENDGAME</span></div>
            </div>
          </div>
          <div className="telemetry-grid">
            <div><small>INSTANT MOVES</small><strong>{records.length ? `${metrics.instantRate.toFixed(1)}%` : '—'}</strong><span>under 2 seconds</span></div>
            <div><small>PHASE DELTA</small><strong>{metrics.phase[0] && metrics.phase[2] ? `${((metrics.phase[2] - metrics.phase[0]) / 1000).toFixed(1)}s` : '—'}</strong><span>endgame minus opening</span></div>
            <div><small>CAPTURE RATE</small><strong>{records.length ? (metrics.captures / records.length).toFixed(1) : '—'}</strong><span>per game</span></div>
            <div><small>NETWORK MEDIAN</small><strong>{metrics.medianLatency ? `${Math.round(metrics.medianLatency)}ms` : '—'}</strong><span>measured WebRTC path</span></div>
          </div>
          <div className="telemetry-foot"><span>NO ENGINE EVALUATION</span><span>BEHAVIORAL SIGNALS ONLY</span><Link href="/stats">OPEN FULL LEDGER →</Link></div>
        </div>
      </section>

      <section className="protocol-section" id="protocol">
        <div className="section-index"><span>03</span><span>ROOM PROTOCOL</span></div>
        <div className="protocol-layout">
          <div className="protocol-copy"><h2>{t.protocolTitle}</h2><p>{t.protocolLead}</p><Link className="button-primary" href="/play">{t.play}<span>↗</span></Link></div>
          <ol className="protocol-steps">
            {t.steps.map((step, index) => (
              <li key={step}><span>0{index + 1}</span><strong>{step}</strong><small>{index === 0 ? '∞  /  3+0  /  3+2  /  5+0  /  10+0' : index === 1 ? 'VEYR.N/ROOM/••••••••' : 'WEBRTC / END-TO-END'}</small></li>
            ))}
          </ol>
        </div>
        <div className="board-specs">
          {t.boardSpecs.map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}
        </div>
      </section>

      <section className="global-section">
        <div className="global-copy"><p className="tech-eyebrow"><i />GLOBAL ACCESS</p><h2>{t.globalTitle}</h2><p>{t.globalLead}</p><div className="country-control"><small>{countrySource === 'ip' ? 'ОПРЕДЕЛЕНО ПО IP' : 'ВЫБРАНО НА УСТРОЙСТВЕ'}</small><CountrySelect value={country} onChange={setCountry} /></div></div>
        <div className="region-grid">
          {[
            ['RU', 'RU', 'САРАТОВ / MOSCOW'], ['GB', 'EN', 'LONDON / GLOBAL'],
            ['DE', 'DE', 'FRANKFURT / EU'], ['FR', 'FR', 'PARIS / EU'],
            ['ES', 'ES', 'MADRID / LATAM'], ['IN', 'HI', 'MUMBAI / ASIA'],
          ].map(([countryCode, code, region]) => <div key={code}><span><CountryFlag code={countryCode} /></span><strong>{code}</strong><small>{region}</small></div>)}
        </div>
      </section>

      <section className="final-cta"><span>04 / LAUNCH</span><h2>{t.final}</h2><Link className="button-primary" href="/play">{t.play}<span>↗</span></Link></section>
      <footer className="site-footer"><strong>© 2026 VEYRN CHESS // CALIBRATION COMPLETE</strong><div><Link href="/stats">STATISTICS</Link><Link href="/privacy">PRIVACY</Link><a href="#protocol">PROTOCOL</a><a href="https://github.com/vansGAMee/veyrn_chess" target="_blank" rel="noreferrer">SOURCE</a></div></footer>
    </main>
  );
}
