/*
 * sequence-data — projects shown inside the scroll sequence,
 * grouped by chapter.
 */

export interface ProjectCard {
  number: string;
  title: string;
  /** short kicker, mono small. e.g., "Native iOS Shortcut" */
  kicker?: string;
  /** main paragraph; the user's "blurb" or "feature-copy" */
  blurb: string;
  /** 3 result/insight bullets, lifted from .feature-points */
  points?: string[];
  tags: string[];
  year: string;
  /** primary CTA. `kind: 'external'` opens the url in a new tab.
   *  `kind: 'modal'` opens an internal modal whose key matches the
   *  url field (e.g., 'dbc'). Strategy cards leave this undefined
   *  and use the chapter-level "Open Case" modal instead. */
  primaryAction?:
    | { kind: 'external'; label: string; url: string }
    | { kind: 'modal';    label: string; url: 'dbc' };
  /** github repo (engineering only) */
  githubUrl?: string;
}

export interface CredentialRow {
  label: string;
  value: string;
}

/*
 * heroContent — Section 1 (Profile) credentials. Lifted from CV
 * (SewonPark_CV_blackrock.pdf) so the verbal layer matches the
 * actual application material. 4 rows, mono small.
 */
export const heroStatement = 'works in code, in systems, in strategy.';

export const heroCredentials: CredentialRow[] = [
  { label: 'currently', value: 'analyst intern · cnerg · seoul' },
  { label: 'previously', value: 'strategy consulting intern · arthur d. little · tokyo' },
  { label: 'education', value: 'b.eng. · university of seoul · 4.30 gpa' },
  { label: 'languages', value: 'japanese n1 · korean · english' },
];

/*
 * Engineering projects. Content lifted from Protfo/index.html lines
 * ~3974–4083 (.landing-feature-card blocks). Tone matches existing
 * site copy; do not rewrite as part of this restructure.
 */
export const engineering: ProjectCard[] = [
  {
    number: '01',
    kicker: 'native ios shortcut',
    title: 'digital business card',
    year: '2026',
    blurb:
      'a qr-based business card you can fork, rebrand, and send — built as a single apple shortcut that runs fully on-device. no app, no server, no signup.',
    points: [
      'paid alternatives lock customization behind subscriptions — this one is free, mit-licensed, and rebrandable.',
      'built fully shortcut-native — entire pipeline (dictionary → vcard qr → composition → photos export) runs on-device with base64-embedded assets.',
      'built for makers — published the 1290×2590 canvas spec, design tokens, and svg infographic for custom theming.',
    ],
    tags: ['apple shortcuts', 'ios', 'figma', 'base64', 'vcard'],
    primaryAction: { kind: 'modal', label: 'Make It Yours', url: 'dbc' },
    githubUrl: 'https://github.com/sewon-p/digital-business-card',
  },
  {
    number: '02',
    kicker: 'full-stack llm service',
    title: 'synthetic driving scenario generation',
    year: '2025',
    blurb:
      'converts natural-language traffic descriptions into runnable sumo simulations through a fine-tuned parameter extractor and role-separated llm orchestration.',
    points: [
      'base llms hallucinate sumo parameters (51.5% mape, +68% speed bias) — fine-tuned on 2,450 seoul pairs, reduced to 10.6% with 0% json failures.',
      'simulation failures are domain-specific — admin logs field-level edits with trainable flags, exports jsonl retraining data.',
      'parameters cascade through dependencies (speed↔v/c↔sigma/tau) — role-separated pipeline isolates extraction from geometry reasoning.',
    ],
    tags: ['fine-tuning', 'prompt engineering', 'ai agent', 'rag'],
    primaryAction: {
      kind: 'external',
      label: 'Open Project',
      url: 'https://sumo-traffic-agent-66pav72ktq-an.a.run.app/about',
    },
    githubUrl: 'https://github.com/sewon-p/sumo-traffic-agent',
  },
  {
    number: '03',
    kicker: 'data & ml pipeline',
    title: 'probedensity — end-to-end traffic density estimation',
    year: '2025',
    blurb:
      'turns smartphone probe trajectories into deployable road-link density estimates through an end-to-end pipeline covering simulation, training, inference, storage, and live inspection.',
    points: [
      'end-to-end pipeline — sumo simulation → fastapi inference → live dashboard, trained on 49k scenarios and deployed over 2.2k seoul arterial links.',
      'gps-only density from 32 trajectory features replaces roadside detectors, achieving mae 1.78 across 0–67 veh/km/lane.',
      'multi-probe aggregation handles asynchronous arrivals — per-traversal prediction, cf-weighted ensemble over 15-min rolling windows (hcm los).',
    ],
    tags: ['data pipeline', 'xgboost', 'fastapi', 'postgresql', 'cloud run'],
    primaryAction: {
      kind: 'external',
      label: 'Open Project',
      url: 'https://traffic-estimator-gcbqhrztha-du.a.run.app/about',
    },
    githubUrl: 'https://github.com/sewon-p/ml_project',
  },
];

/*
 * Strategy projects. Card preview lifted from Protfo/index.html
 * .landing-pm-card blocks (~lines 4109–4153). The `points` and
 * `meta` fields below summarize the legacy modal content
 * (openModal 1..5) for the new CaseModal — three result-oriented
 * bullets per case + role/team/award metadata.
 */
export const strategy: ProjectCard[] = [
  {
    number: '01',
    kicker: 'strategy consulting',
    title: '¥1t m&a strategy for automaker’s infrastructure pivot',
    year: '2026.01',
    blurb:
      'a strategy consulting deliverable proposing three acquisitions to transform a global automaker into a mobility infrastructure platform.',
    points: [
      'mapped autonomous mobility platform risks; framed acquisition thesis around closing the platform-dependency gap.',
      'built valuation cases for 3 m&a targets using per/ebitda multiples, dcf, and revenue-based approaches.',
      'led platform-dependency analysis; presented findings in japanese to principals at adl tokyo.',
    ],
    tags: ['consulting', 'm&a', 'automotive', 'mobility'],
  },
  {
    number: '02',
    kicker: 'cross-border strategy',
    title: 'cross-border commerce & fintech ecosystem',
    year: '2025.01',
    blurb:
      'cross-border pricing gap analysis and a b2b pivot strategy built from market validation and operating-flow design.',
    points: [
      'crawled bunjang/mercari to prove structural arbitrage gaps for identical used-good conditions across kr/jp.',
      'designed a d2c offline hub thesis where the brand controls 100% of price, vmd, and customer experience.',
      'awarded 3rd place at korea startup center · cic tokyo campus startup camp.',
    ],
    tags: ['product', 'fintech', 'cross-border'],
  },
  {
    number: '03',
    kicker: 'logistics concept',
    title: 'hyper-local p2p delivery',
    year: '2024.11',
    blurb:
      'a route-based campus delivery concept using or-tools, last-mile logic, and incentive design to reduce cost and distance.',
    points: [
      'reduced delivery cost 70% (3000→900 krw) and total distance 40% via or-tools vrp on real campus pickup/dropoff data.',
      'designed dynamic incentives so peer drivers could clear deliveries on their existing routes, near-zero detour.',
      'role: pm + python developer; built end-to-end matching prototype.',
    ],
    tags: ['product', 'or-tools', 'logistics'],
  },
  {
    number: '04',
    kicker: 'mobility business model',
    title: 'drive-to-earn reward platform',
    year: '2021.08',
    blurb:
      'a mobility fintech concept linking traffic dispersion, incentive design, and payment lock-in through a staged growth model.',
    points: [
      'reframed congestion-zone surcharges as token rewards for off-peak driving — flips a tax into a savings account.',
      'staged the growth model: pilot district → city-level expansion → payment lock-in via mobility wallet.',
      'awarded 1st place at the venture startup class business-model validation.',
    ],
    tags: ['product', 'mobility', 'fintech'],
  },
  {
    number: '05',
    kicker: 'internship / ux',
    title: 'digital asset trading & ux strategy',
    year: '2021.05',
    blurb:
      'an internship case focused on trading ux, misclick risk reduction, and interface clarity for high-stakes financial actions.',
    points: [
      'redesigned core trading flows to remove ambiguous confirmations on irreversible actions (size, leverage, side).',
      'cut user-reported misclick incidents to 0% in the redesigned segments via post-launch ticket review.',
      'pre-a 300m jpy raised; redesigns shipped to production trading interface.',
    ],
    tags: ['ux', 'fintech', 'trading'],
  },
];
