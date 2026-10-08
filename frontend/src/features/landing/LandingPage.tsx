import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import logo from '@/assets/agl_logo.jpg';
import introVideo from '@/assets/innovatex_hub_intro.mp4';
import { DISPLAY_TZ } from '@/utils/dates';
import { money } from '@/utils/format';
import { tr, type I18nText } from '@/utils/i18n';
import './landing.css';

/* Public landing page for people who are not signed in.
   Layout and text come from "all doc/InnovateX Hub — Landing Page.html"; the challenges are the real ones. */

interface PublicChallenge {
  code: string;
  slug: string;
  title_i18n: I18nText;
  domain: string;
  status: 'open' | 'soon';
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  participation_mode: string;
  team_min_size: number | null;
  team_max_size: number | null;
  problem: string;
  expected_outcome: string;
  total_prize_budget: number | null;
  currency_code: string | null;
  phases: { name: string; opens_at: string | null; closes_at: string | null }[];
  criteria: { name: string; weight_pct: number | null }[];
}

const STAGES = [
  { t: 'Spot a problem', d: 'Notice something slow, wasteful, unsafe or frustrating in your daily work — in any department.', w: 'You' },
  { t: 'Register', d: 'Join a challenge alone, or create a team and share a join link. You approve who joins.', w: 'You and your team' },
  { t: 'Submit your methodology', d: 'Explain your approach, plan, resources and expected impact before the deadline. Edit it until the window closes.', w: 'You and your team' },
  { t: 'Expert review', d: 'Judges score your plan on published criteria and write feedback.', w: 'Judges' },
  { t: 'Shortlist', d: 'The highest-scoring plans move on to build. Every entry receives written feedback.', w: 'Innovation office' },
  { t: 'Build and prototype', d: 'Turn the plan into something that works, with mentor support. A prototype is asked for when the judges need proof.', w: 'Shortlisted teams and mentors' },
  { t: 'Demo Day', d: 'Show your solution working to the jury and leadership.', w: 'Finalists and jury' },
  { t: 'Reward and scale', d: 'Winners are rewarded, and proven solutions are rolled out and reused across Anwar Group.', w: 'Leadership, HR and business owners' },
];

const GOALS: { n: string; v: number | null; t: string; d: string; bar?: string }[] = [
  { n: '20%', v: 20, t: 'of AES employees take part', d: 'Submitting an idea or joining a challenge team in the first year.' },
  { n: '5 days', v: null, t: 'to a first response', d: 'Every submission gets a first check within five working days.', bar: 'Working days, at most' },
  { n: '100%', v: 100, t: 'get written feedback', d: "Including every idea that isn't selected — with reasons and next steps." },
  { n: '50%', v: 50, t: 'of shortlisted ideas reach a prototype', d: 'We back the ideas we select with time, mentors and resources.' },
  { n: '3+', v: null, t: 'solutions reused across the group', d: 'Proven solutions adopted by another team or business.', bar: 'At least three per year' },
];

const AWARDS = [
  'Transformation Innovation of the Year', 'Best AI or Agentic Innovation', 'Best Business Impact', 'Best Engineering Productivity',
  'Best Automation', 'Best Reusable Asset', 'Rising Innovator',
];

const LADDER = [
  { when: 'You submit', h: 'Contributor', p: 'Confirmation, profile points and your first badge.', i: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 14l-1.5 7 5-3 5 3-1.5-7' },
  { when: "You're shortlisted", h: 'Certificate', p: 'Recognition in the monthly innovation update.', i: 'M4 4h16v12H4zM8 9h8M8 12h5M9 16v5l3-2 3 2v-5' },
  { when: 'You reach the final', h: 'Time to build', p: 'Dedicated build time, a mentor and a stage at Demo Day.', i: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z' },
  { when: 'You win', h: 'Award and prize', p: 'Trophy, cash award and sponsored training or certification.', i: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4' },
  { when: 'It goes live', h: 'Impact bonus', p: 'An extra reward once real results are verified.', i: 'M4 19h16M6 15l4-4 3 3 5-7M14 7h4v4' },
  { when: 'Others adopt it', h: 'Reusable asset', p: 'Your name on a solution used across Anwar Group businesses.', i: 'M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.4l-5.2 2.8 1-5.9L3.5 9.2l5.9-.8z' },
];

const ABOUT = [
  { h: 'Share your idea', p: 'See something slow, costly or unsafe? Tell us how to fix it. Any employee, any department.', i: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z' },
  { h: 'Join a challenge', p: 'Leaders post real problems. Solve one alone or with a team and compete for the prize.', i: 'M5 21V4M5 4h11l-2 4 2 4H5' },
  { h: 'Fair judging', p: 'Judges score every idea on published criteria and write feedback, selected or not.', i: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4' },
  { h: 'Real rewards', p: 'Winning ideas earn awards, cash prizes and recognition, and are built for real use.', i: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4', gold: true },
];

/** Small label above a section title. */
const Pill = ({ children, gold = false }: { children: ReactNode; gold?: boolean }) => <span className={`pill${gold ? ' gold' : ''}`}>{children}</span>;

/** "Closes in 7d 4h" for an open registration. */
function timeLeft(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d}d ${h}h left` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m left`;
}

/** Hero picture: an idea (light bulb) surrounded by what happens to it — team, fair judging, building, reward. */
function IdeaArt() {
  const badge = (x: number, y: number, label: string, d: string, gold = false) => (
    <g className="art-badge">
      <circle cx={x} cy={y} r="32" fill="#132A3B" stroke={gold ? '#E8A317' : '#46C9C3'} strokeWidth="2" />
      <g transform={`translate(${x - 13} ${y - 13}) scale(1.08)`} fill="none" stroke={gold ? '#E8A317' : '#E8EFF3'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </g>
      <text x={x} y={y + 52} textAnchor="middle" fontSize="13" fontWeight="600" fill={gold ? '#F3C352' : '#E8EFF3'}>
        {label}
      </text>
    </g>
  );
  return (
    <svg className="hero-art" viewBox="0 0 480 400" role="img" aria-label="An idea becomes a result: team up, fair judging, build it, get rewarded">
      <defs>
        <radialGradient id="lpGlow" cx="50%" cy="45%" r="50%">
          <stop offset="0%" stopColor="#E8A317" stopOpacity=".55" />
          <stop offset="60%" stopColor="#E8A317" stopOpacity=".12" />
          <stop offset="100%" stopColor="#E8A317" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lpBulb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE08A" />
          <stop offset="100%" stopColor="#E8A317" />
        </linearGradient>
      </defs>
      <ellipse cx="240" cy="190" rx="190" ry="150" fill="none" stroke="rgba(232,239,243,.22)" strokeWidth="1.5" strokeDasharray="4 8" />
      <circle cx="240" cy="170" r="130" fill="url(#lpGlow)" />
      <g stroke="#F3C352" strokeWidth="4" strokeLinecap="round" className="art-rays">
        <path d="M240 62V44M305 105l13-13M175 105l-13-13M332 170h18M148 170h-18" />
      </g>
      <path d="M240 100a70 70 0 0 1 42 126c-8 6-12 14-12 24v6h-60v-6c0-10-4-18-12-24A70 70 0 0 1 240 100z" fill="url(#lpBulb)" stroke="#FFF3CF" strokeWidth="3" strokeLinejoin="round" />
      <path d="M226 226l-8-36 22 14 22-14-8 36" fill="none" stroke="#8A5A00" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="212" y="262" width="56" height="11" rx="5.5" fill="#E8EFF3" />
      <rect x="220" y="279" width="40" height="11" rx="5.5" fill="#A3B6C4" />
      {badge(84, 104, 'Team up', 'M9 8a3 3 0 1 0 0-.01M3 20c.8-3.2 3.2-5 6-5s5.2 1.8 6 5M17 6.5a2.5 2.5 0 1 1 0 5M17 14.5c2 .3 3.4 1.9 4 4.5')}
      {badge(396, 104, 'Fair judging', 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4')}
      {badge(94, 286, 'Build it', 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z')}
      {badge(386, 286, 'Get rewarded', 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4', true)}
    </svg>
  );
}

const Svg = ({ children, sw = 1.9 }: { children: ReactNode; sw?: number }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** Icon for a domain, chosen by words in its name. */
function DomainIcon({ domain }: { domain: string }) {
  const d = domain.toLowerCase();
  if (d.includes('energy')) return <Svg><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></Svg>;
  if (d.includes('safety')) return <Svg><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></Svg>;
  if (d.includes('procure') || d.includes('supply'))
    return <Svg><rect x="2" y="7" width="12" height="10" rx="1" /><path d="M14 10h4l3 3v4h-7" /><circle cx="6" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></Svg>;
  if (d.includes('hr') || d.includes('human') || d.includes('people'))
    return <Svg><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.5 3.5 5.2" /></Svg>;
  if (d.includes('customer')) return <Svg><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></Svg>;
  if (d.includes('financ')) return <Svg><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 15l3-3 3 2 4-5" /></Svg>;
  if (d.includes('sustain') || d.includes('environ')) return <Svg><path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15" /><path d="M5 19l7-7" /></Svg>;
  return <Svg><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></Svg>;
}
const CalIcon = () => <Svg><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Svg>;
const TeamIcon = () => <Svg><circle cx="9" cy="8" r="3" /><path d="M3 20c.8-3.2 3.2-5 6-5s5.2 1.8 6 5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5c2 .3 3.4 1.9 4 4.5" /></Svg>;

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: DISPLAY_TZ });
const day = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '—');
const short = (text: string, max = 150) => (text.length > max ? text.slice(0, max).replace(/\s+\S*$/, '') + '…' : text);
function teamText(c: PublicChallenge): string {
  if (c.participation_mode === 'INDIVIDUAL') return 'Individual';
  const max = c.team_max_size ?? 5;
  if (c.participation_mode === 'TEAM') return `Teams of ${c.team_min_size ?? 2}–${max}`;
  return `Individual or team of up to ${max}`;
}
const closesText = (c: PublicChallenge) => (c.status === 'open' ? `Registration closes ${day(c.registration_closes_at)}` : `Opens ${day(c.registration_opens_at)}`);

function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <a href="#top" className="brand" aria-label="Anwar Group of Industries — InnovateX Hub home">
      <span className="brand-logo">
        <img src={logo} alt="Anwar Group of Industries" />
      </span>
      {footer && (
        <span className="brand-text">
          <strong>InnovateX Hub</strong>
          <span>Anwar Group of Industries</span>
        </span>
      )}
    </a>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stage, setStage] = useState(0);
  const [auto, setAuto] = useState(true);
  const [domain, setDomain] = useState('All');
  const [details, setDetails] = useState<PublicChallenge | null>(null);
  const [metersOn, setMetersOn] = useState(false);
  const goalsRef = useRef<HTMLUListElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const challenges = useQuery({
    queryKey: ['public', 'challenges'],
    queryFn: () => api.get<{ items: PublicChallenge[]; stats?: { challenges: number; ideas: number; entries: number; rewarded: number } }>('/public/challenges'),
    retry: 1,
    staleTime: 60_000,
  });
  const list = useMemo(() => challenges.data?.items ?? [], [challenges.data]);
  const domains = useMemo(() => ['All', ...new Set(list.map((c) => c.domain))], [list]);
  const shown = list.filter((c) => domain === 'All' || c.domain === domain);
  const stats = challenges.data?.stats;

  useEffect(() => {
    document.title = 'InnovateX Hub — Anwar Group of Industries';
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The journey rail walks through the stages once, until the visitor picks a stage.
  useEffect(() => {
    if (!auto || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setStage((s) => (s >= STAGES.length - 1 ? s : s + 1)), 2200);
    return () => window.clearInterval(id);
  }, [auto]);
  useEffect(() => {
    if (stage >= STAGES.length - 1) setAuto(false);
    const sc = railRef.current;
    const btn = sc?.querySelectorAll<HTMLButtonElement>('.stage-btn')[stage];
    if (sc && btn && sc.scrollWidth > sc.clientWidth) sc.scrollTo({ left: btn.offsetLeft - sc.clientWidth / 2 + btn.offsetWidth / 2, behavior: 'smooth' });
  }, [stage]);
  const pick = (i: number) => {
    setAuto(false);
    setStage(Math.max(0, Math.min(STAGES.length - 1, i)));
  };

  useEffect(() => {
    const el = goalsRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([en]) => en.isIntersecting && setMetersOn(true), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!details) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDetails(null);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [details]);

  const login = (next?: string) => navigate(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  const register = (c: PublicChallenge) => login(c.status === 'open' ? `/challenges/${c.slug}/register` : `/challenges/${c.slug}`);
  const nav = [
    ['#about', 'About'],
    ['#journey', 'How it works'],
    ['#challenges', 'Challenges'],
    ['#goals', 'Goals'],
    ['#rewards', 'Rewards'],
  ];

  return (
    <div className="lp">
      <a className="skip" href="#main">
        Skip to content
      </a>

      <header className={`site-header${scrolled || menuOpen ? ' scrolled' : ''}`}>
        <div className="wrap nav">
          <Brand />
          <nav aria-label="Main">
            <ul className="nav-links">
              {nav.map(([href, label]) => (
                <li key={href}>
                  <a href={href}>{label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="nav-actions">
            <Link className="btn btn-ghost btn-sm" to="/login">
              Log in
            </Link>
            <Link className="btn btn-primary btn-sm" to="/signup">
              Sign up
            </Link>
            <button className="menu-btn" aria-expanded={menuOpen} aria-controls="mobileMenu" aria-label="Open menu" onClick={() => setMenuOpen((o) => !o)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
          </div>
        </div>
        <div className={`mobile-menu${menuOpen ? ' open' : ''}`} id="mobileMenu">
          {nav.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setMenuOpen(false)}>
              {label}
            </a>
          ))}
          <Link className="btn btn-outline" to="/login">
            Log in
          </Link>
        </div>
      </header>

      <main id="main">
        <section className="hero" id="top" aria-labelledby="heroTitle">
          <div className="wrap">
            <div className="hero-grid">
              <div>
                <p data-in="1">
                  <Pill>Anwar Group's platform for new ideas</Pill>
                </p>
                <h1 id="heroTitle" data-in="2">
                  InnovateX <em>Hub</em>
                </h1>
                <p className="hero-motive" data-in="3">
                  Have an idea to make work better? Share it here. The best ideas get built and rewarded.
                </p>
                <p className="hero-lead" data-in="4">
                  InnovateX Hub collects innovative ideas from every employee. Join a challenge or share your own idea, alone or with a team. Judges review every
                  idea and give written feedback, and winning ideas earn awards, prizes and recognition.
                </p>
                <div className="hero-ctas" data-in="4">
                  <button className="btn btn-primary" onClick={() => login('/ideas/new')}>
                    Share an idea
                  </button>
                  <a className="btn btn-outline" href="#challenges">
                    Explore challenges
                  </a>
                </div>
              </div>
              <div data-in="3">
                <video className="hero-video" src={introVideo} autoPlay muted loop playsInline controls preload="metadata" aria-label="InnovateX Hub introduction video" />
              </div>
            </div>
            {stats && (
              <ul className="stats" data-in="5" aria-label="InnovateX Hub in numbers">
                {[
                  { n: stats.ideas, l: 'Ideas shared', i: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z' },
                  { n: stats.challenges, l: 'Challenges', i: 'M5 21V4M5 4h11l-2 4 2 4H5' },
                  { n: stats.entries, l: 'Challenge entries', i: 'M9 8a3 3 0 1 0 0-.01M3 20c.8-3.2 3.2-5 6-5s5.2 1.8 6 5M17 6.5a2.5 2.5 0 1 1 0 5M17 14.5c2 .3 3.4 1.9 4 4.5' },
                  { n: stats.rewarded, l: 'Ideas rewarded', i: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4', gold: true },
                ].map((s) => (
                  <li key={s.l} className={s.gold ? 'gold' : undefined}>
                    <Svg sw={1.9}>
                      <path d={s.i} />
                    </Svg>
                    <strong>{s.n}</strong>
                    <span>{s.l}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="journey" id="journey" data-in="5" aria-labelledby="journeyTitle">
              <div className="journey-head">
                <h2 id="journeyTitle">How it works: from idea to reward</h2>
                <p>Select a stage to see what happens.</p>
              </div>
              <div className="rail-scroll" ref={railRef}>
                <ol className="rail">
                  <span className="rail-track" aria-hidden="true" />
                  <span className="rail-fill" aria-hidden="true" style={{ width: `calc((100% - 100%/8) * ${stage / (STAGES.length - 1)})` }} />
                  {STAGES.map((s, i) => (
                    <li key={s.t}>
                      <button
                        className={`stage-btn${i === STAGES.length - 1 ? ' reward' : ''}${i === stage ? ' active' : ''}${i < stage ? ' done' : ''}`}
                        aria-label={`Stage ${i + 1}: ${s.t}`}
                        aria-current={i === stage ? 'step' : undefined}
                        onClick={() => pick(i)}
                      >
                        <span className="stage-dot">{i + 1}</span>
                        <span className="stage-label">{s.t}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="stage-detail" aria-live="polite">
                <div>
                  <p className="count">
                    Stage {stage + 1} of {STAGES.length}
                  </p>
                  <h3>{STAGES[stage].t}</h3>
                  <p>{STAGES[stage].d}</p>
                  <p className="who">Who's involved: {STAGES[stage].w}</p>
                </div>
                <div className="rail-controls">
                  <button className="icon-btn" aria-label="Previous stage" disabled={stage === 0} onClick={() => pick(stage - 1)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                  <button className="icon-btn" aria-label="Next stage" disabled={stage === STAGES.length - 1} onClick={() => pick(stage + 1)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="about" id="about" aria-labelledby="aboutTitle">
          <div className="wrap about-grid">
            <IdeaArt />
            <div>
              <Pill gold>What is InnovateX Hub?</Pill>
              <h2 id="aboutTitle">
                One place to collect, judge and <em>reward ideas</em>
              </h2>
              <p className="about-lead">
                The people who do the work know best how to improve it. InnovateX Hub is where every Anwar Group employee can send an idea, and where good ideas
                are recognised and rewarded.
              </p>
              <ul className="about-cards">
                {ABOUT.map((a) => (
                  <li key={a.h} className={a.gold ? 'gold' : undefined}>
                    <span className="ico" aria-hidden="true">
                      <Svg sw={1.9}>
                        <path d={a.i} />
                      </Svg>
                    </span>
                    <h3>{a.h}</h3>
                    <p>{a.p}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="challenges" aria-labelledby="chTitle">
          <div className="wrap">
            <div className="sec-head">
              <div>
                <Pill>Open challenges</Pill>
                <h2 id="chTitle">
                  Challenges you can <em>join</em>
                </h2>
              </div>
              <p>A challenge is a real problem the group wants solved. Pick one, send your idea, and compete for the prize. Every business area counts.</p>
            </div>
            {domains.length > 2 && (
              <div className="filters" role="group" aria-label="Filter challenges by domain">
                {domains.map((d) => (
                  <button key={d} className="chip" aria-pressed={d === domain} onClick={() => setDomain(d)}>
                    {d === 'All' ? 'All domains' : d}
                  </button>
                ))}
              </div>
            )}
            <div className="grid" aria-live="polite">
              {challenges.isLoading ? (
                <p className="empty">Loading challenges…</p>
              ) : shown.length === 0 ? (
                <p className="empty">{challenges.isError ? 'Challenges could not be loaded. Log in to see them.' : 'No challenges are open for registration right now. Check back soon.'}</p>
              ) : (
                shown.map((c) => (
                  <article className="card" key={c.code}>
                    <div className="card-top">
                      <span className="domain">
                        <DomainIcon domain={c.domain} />
                        {c.domain}
                      </span>
                      <span className={`status ${c.status}`}>
                        {c.status === 'open' && <i className="live" aria-hidden="true" />}
                        {c.status === 'open' ? 'Open now' : 'Coming soon'}
                      </span>
                    </div>
                    <h3>{tr(c.title_i18n)}</h3>
                    <p>{short(c.problem)}</p>
                    <ul className="facts">
                      <li>
                        <CalIcon />
                        {closesText(c)}
                        {c.status === 'open' && timeLeft(c.registration_closes_at) && <b className="left">{timeLeft(c.registration_closes_at)}</b>}
                      </li>
                      <li>
                        <TeamIcon />
                        {teamText(c)}
                      </li>
                    </ul>
                    <div className="card-actions">
                      <button className="btn btn-outline btn-sm" style={{ color: 'var(--ink)' }} onClick={() => setDetails(c)}>
                        More details
                      </button>
                      <button className="btn btn-primary btn-sm" onClick={() => register(c)}>
                        {c.status === 'open' ? 'Register' : 'Log in to follow'}
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="motivation" id="why" aria-labelledby="whyTitle">
          <div className="wrap motive-grid">
            <div>
              <h2 className="big-quote" id="whyTitle">
                The people closest to the work see the best improvements first.
              </h2>
              <p className="motive-side">
                A slow approval, a wasted batch, a risky step on the floor — you notice them every day. InnovateX Hub gives that knowledge a direct path to the people
                who can act on it, and makes sure you get the credit.
              </p>
            </div>
            <ul className="promises">
              <li>
                <span className="ico" aria-hidden="true"><Svg sw={2}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></Svg></span>
                <div>
                  <h3>Your idea keeps your name</h3>
                  <p>Every submission is time-stamped and credited to you and your team, from the first draft to the final award.</p>
                </div>
              </li>
              <li>
                <span className="ico" aria-hidden="true"><Svg sw={2}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Svg></span>
                <div>
                  <h3>Your work stays private</h3>
                  <p>Other participants never see your plan, files or scores. Only the judges and the innovation office do.</p>
                </div>
              </li>
              <li>
                <span className="ico" aria-hidden="true"><Svg sw={2}><path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z" /></Svg></span>
                <div>
                  <h3>Fair judging, written feedback</h3>
                  <p>Judges score every plan on published criteria. Selected or not, you'll know why and what to improve.</p>
                </div>
              </li>
              <li>
                <span className="ico" aria-hidden="true"><Svg sw={2}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z" /></Svg></span>
                <div>
                  <h3>Build it, don't just pitch it</h3>
                  <p>Shortlisted teams get time, mentors and resources to turn the plan into something that works.</p>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <section id="goals" aria-labelledby="goalsTitle">
          <div className="wrap">
            <div className="sec-head">
              <div>
                <Pill>Our goals</Pill>
                <h2 id="goalsTitle">
                  What we're aiming for in <em>year one</em>
                </h2>
              </div>
              <p>We measure the program by results and by how well it treats the people who take part — not by how many ideas arrive.</p>
            </div>
            <ul className="goals-list" ref={goalsRef}>
              {GOALS.map((g) => (
                <li className="goal" key={g.t}>
                  <div className="goal-num">{g.n}</div>
                  <div>
                    <h3>{g.t}</h3>
                    <p>{g.d}</p>
                  </div>
                  <div>
                    {g.v !== null && (
                      <div className="meter" aria-hidden="true">
                        <span style={{ width: metersOn ? `${g.v}%` : 0 }} />
                      </div>
                    )}
                    <small>{g.bar ?? `Target: ${g.n}`}</small>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rewards" id="rewards" aria-labelledby="rewardsTitle">
          <div className="wrap">
            <div className="sec-head">
              <div>
                <Pill gold>Rewards</Pill>
                <h2 id="rewardsTitle">
                  Every good idea is <em>rewarded</em>
                </h2>
              </div>
              <p>You are thanked from the first step, and the reward grows as your idea goes further. The biggest rewards go to ideas that prove real value.</p>
            </div>
            <ol className="ladder">
              {LADDER.map((s, i) => (
                <li className={`step${i === LADDER.length - 1 ? ' top' : ''}`} tabIndex={0} key={s.h}>
                  <span className="step-ico" aria-hidden="true">
                    <Svg sw={1.8}>
                      <path d={s.i} />
                    </Svg>
                  </span>
                  <p className="when">{s.when}</p>
                  <h3>{s.h}</h3>
                  <p>{s.p}</p>
                </li>
              ))}
            </ol>
            <div className="awards">
              <div>
                <h3>Award categories</h3>
                <p>Each challenge cycle ends with awards decided by the jury and approved by leadership.</p>
              </div>
              <div>
                <ul className="award-list">
                  {AWARDS.map((a) => (
                    <li key={a}>
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" />
                      </svg>
                      {a}
                    </li>
                  ))}
                </ul>
                <p className="rule-note">
                  <strong>One rule for top awards:</strong> no working evidence, no top award. Team prizes are shared by the credit split your team agrees.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="cta" aria-labelledby="ctaTitle">
          <div className="wrap">
            <div className="cta-box">
              <div>
                <h2 id="ctaTitle">Your next idea could be the one the whole group uses.</h2>
                <p>Sign up in under a minute.</p>
              </div>
              <div className="btns">
                <Link className="btn btn-light" to="/signup">
                  Sign up
                </Link>
                <a className="btn btn-outline" href="#challenges">
                  See challenges
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <div className="foot-grid">
            <div>
              <Brand footer />
              <p style={{ marginTop: 16 }}>Run by Anwar Enterprise Systems (AES) and the Enterprise Innovation Office.</p>
            </div>
            <div>
              <h3>Platform</h3>
              <ul>
                <li><a href="#challenges">Challenges</a></li>
                <li><a href="#journey">How it works</a></li>
                <li><a href="#rewards">Rewards</a></li>
                <li><a href="#goals">Goals</a></li>
              </ul>
            </div>
            <div>
              <h3>Take part</h3>
              <ul>
                <li><Link to="/signup">Sign up</Link></li>
                <li><Link to="/login">Log in</Link></li>
                <li><Link to={`/login?next=${encodeURIComponent('/ideas/new')}`}>Share an idea</Link></li>
              </ul>
            </div>
            <div>
              <h3>Help</h3>
              <ul>
                <li><a href="#why">Why take part</a></li>
              </ul>
            </div>
          </div>
          <div className="foot-bottom">
            <span>© {new Date().getFullYear()} Anwar Group of Industries. For employees of Anwar Group companies.</span>
            <span>InnovateX Hub</span>
          </div>
        </div>
      </footer>

      {details && (
        <div className="overlay drawer-overlay open" role="dialog" aria-modal="true" aria-labelledby="dTitle" onClick={(e) => e.target === e.currentTarget && setDetails(null)}>
          <div className="drawer">
            <button className="close-btn" aria-label="Close details" onClick={() => setDetails(null)} autoFocus>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <span className="domain">
              <DomainIcon domain={details.domain} />
              {details.domain}
            </span>
            <h2 id="dTitle">{tr(details.title_i18n)}</h2>
            <h3>The problem</h3>
            <p>{details.problem || '—'}</p>
            {details.expected_outcome && (
              <>
                <h3>What success looks like</h3>
                <p>{details.expected_outcome}</p>
              </>
            )}
            <h3>Who can join</h3>
            <p>Anwar Group employees. {teamText(details)}.</p>
            <h3>Timeline</h3>
            <ol className="timeline">
              {details.phases.map((p) => (
                <li key={p.name + p.opens_at}>
                  {p.name}
                  <span>
                    {day(p.opens_at)} – {day(p.closes_at)}
                  </span>
                </li>
              ))}
            </ol>
            {details.criteria.length > 0 && (
              <>
                <h3>How you'll be judged</h3>
                <table className="criteria">
                  <tbody>
                    {details.criteria.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td>{c.weight_pct != null ? `${c.weight_pct}%` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {details.total_prize_budget ? (
              <>
                <h3>Prize</h3>
                <p>Prizes worth {money(details.total_prize_budget, details.currency_code ?? 'BDT')} in total, plus certificates for shortlisted entries.</p>
              </>
            ) : null}
            <div className="drawer-actions">
              <button className="btn btn-primary" onClick={() => register(details)}>
                {details.status === 'open' ? 'Register' : 'Log in to follow'}
              </button>
              <button className="btn btn-outline" style={{ color: 'var(--ink)' }} onClick={() => login()}>
                Log in
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
