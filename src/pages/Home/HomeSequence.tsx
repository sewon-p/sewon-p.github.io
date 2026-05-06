import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from 'react';
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useTransform,
  type Variants,
} from 'motion/react';
import { DotMorph } from '../../composition/DotMorph/DotMorph';
import { lookupPreset } from '../../composition/DotMorph/dot-presets';
import { Card } from '../../primitives/Card/Card';
import { Button } from '../../primitives/Button/Button';
import { DbcModal } from './DbcModal';
import { useModalA11y } from './useModalA11y';
import { getLegacyCaseHtml } from './legacy-cases';
import './legacy-cases/legacy-modal.css';
import {
  engineering,
  heroCredentials,
  heroStatement,
  strategy,
  type ProjectCard,
} from './sequence-data';
import styles from './HomeSequence.module.css';

/*
 * HomeSequence — four-section scroll sequence.
 *
 * Section 0 — HERO STEP 1  (scroll 0.00–0.20)
 *   "sewon park." dot cloud, large, centered.
 *   Tagline footer + scroll cue.
 *
 * Section 1 — HERO STEP 2 / PROFILE  (scroll 0.20–0.40)
 *   Same dot cloud, slightly smaller and lifted up.
 *   Adds the primary statement + 4-row credentials below.
 *
 * Section 2 — ENGINEERING  (scroll 0.40–0.70)
 *   Dot cloud morphs into "engineering" and shrinks to chapter
 *   heading position (top-left).
 *
 * Section 3 — STRATEGY  (scroll 0.70–1.00)
 *   Dot cloud morphs again, same chapter layout, different cases.
 *
 * Implementation:
 *   - Sticky 100vh stage with ~600vh zone (4 × 150vh).
 *   - Single DotMorph instance handles all four labels (hero/profile
 *     share label "sewon park."; engineering/strategy each their own).
 *   - Position of dot cloud is measured live against a hidden anchor
 *     box (chapterDotBoxRef) so the cloud lands precisely in the
 *     top-left chapter heading region.
 */

const SECTIONS = [
  { id: 'hero',        label: 'sewon park.' },
  { id: 'profile',     label: 'sewon park.' },
  { id: 'engineering', label: 'engineering' },
  { id: 'strategy',    label: 'strategy' },
] as const;

// dot canvas bounding box (large enough for the longest label).
// Motion scales+translates this whole block; the canvas itself draws
// the same dot radius regardless of scale, so the visible dot size
// shrinks with the cloud — exactly the "ratio preserved" behavior.
const HERO_DOT_WIDTH = 1400;
const HERO_DOT_HEIGHT = 360;
const DOT_FONT = "500 200px 'Geist', system-ui, sans-serif";
const CHAPTER_DOT_SCALE = 0.38;
const CHAPTER_DOT_FALLBACK = { x: -HERO_DOT_WIDTH * 0.26, y: -HERO_DOT_HEIGHT * 1.05 };
const PROFILE_TEXT_START = 0.20;
const ENGINEERING_TEXT_START = 0.40;
const STRATEGY_TEXT_START = 0.70;
const CASE_EASE = [0.32, 0.72, 0, 1] as const;
const CASE_TRANSITION = {
  duration: 0.28,
  ease: CASE_EASE,
} as const;
const DEFAULT_FIELD_TUNING = {
  x: -656,
  y: 28,
  size: 596,
  opacity: 2,
} as const;

/* Mobile two-line wrap of the "sewon park." preset. The single-line
   render is ~1200 px wide which forces a tiny scale on a 360-px
   phone; splitting at the gap lets each line bind to ~560 px and
   roughly doubles the visible glyph size.

   Both sub-clouds are individually re-centred on the canvas centre
   (CANVAS_CX = 700) so the two stacked lines sit horizontally
   centred — without this the combined cloud drifts way off to the
   left of the canvas and disappears outside the visible frame. */
const CANVAS_CX = 700;
const PARK_X_THRESHOLD = 700;
const SEWON_X_CENTER = (76 + 636) / 2;     // 356, from preset bounds
const PARK_X_CENTER  = (756 + 1276) / 2;   // 1016, from preset bounds
const SEWON_DX = CANVAS_CX - SEWON_X_CENTER;  // +344 → recentre sewon
const PARK_DX  = CANVAS_CX - PARK_X_CENTER;   // −316 → recentre park
const SEWON_DY = -80;
const PARK_DY = 80;
const MOBILE_HERO_LINE_WIDTH = 560;

function dotsForMobileTwoLine(presetDots: { x: number; y: number }[]): { x: number; y: number }[] {
  return presetDots.map((p) =>
    p.x >= PARK_X_THRESHOLD
      ? { x: p.x + PARK_DX, y: p.y + PARK_DY }
      : { x: p.x + SEWON_DX, y: p.y + SEWON_DY },
  );
}

export function HomeSequence(): ReactElement {
  const zoneRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const chapterDotBoxRef = useRef<HTMLSpanElement>(null);
  /*
   * Easter egg — three taps on accent (blue) dots while sitting on
   * the hero or profile section take you to /dot-editor.html. Counter
   * resets if the user idles for 1.5s between taps so casual scroll
   * fiddling doesn't accidentally trigger.
   */
  const accentHitsRef = useRef({ count: 0, last: 0, timer: 0 });
  const onAccentHit = (): void => {
    const now = Date.now();
    const state = accentHitsRef.current;
    if (now - state.last > 1500) state.count = 0;
    state.count += 1;
    state.last = now;
    window.clearTimeout(state.timer);
    if (state.count >= 3) {
      state.count = 0;
      window.location.href = '/dot-editor.html';
      return;
    }
    state.timer = window.setTimeout(() => {
      state.count = 0;
    }, 1500);
  };
  const [chapterDotTarget, setChapterDotTarget] = useState(CHAPTER_DOT_FALLBACK);
  const [heroFitScale, setHeroFitScale] = useState(1);
  const [chapterFitScale, setChapterFitScale] = useState(CHAPTER_DOT_SCALE);
  /* Hoisted up here (above measureChapterBox) so the effect's deps
     array can reference it without TDZ. */
  const isMobileViewport = useIsMobile();
  const densityScale = useHomeDensity();
  const chapterDotScale = chapterFitScale;
  const frameStyle = {
    '--home-density': densityScale,
    '--field-x': `${DEFAULT_FIELD_TUNING.x}px`,
    '--field-y': `${DEFAULT_FIELD_TUNING.y}px`,
    '--field-size': `${DEFAULT_FIELD_TUNING.size}px`,
    '--field-opacity': `${DEFAULT_FIELD_TUNING.opacity}%`,
  } as CSSProperties;
  const { scrollYProgress } = useScroll({
    target: zoneRef,
    offset: ['start start', 'end end'],
  });

  const activeIndex = useScrollSectionIndex(zoneRef);
  const activeLabel = SECTIONS[activeIndex].label;

  // Right-edge horizontal accent bar — slides top → bottom in
  // discrete snaps tied to the four section anchors (0, 0.20,
  // 0.40, 0.70, 1.0). Within a section it nearly holds still;
  // when crossing a threshold it jumps quickly to the next slot.
  // The input/output asymmetry is what produces the "탁 걸린다" feel.
  const accentBarTop = useTransform(
    scrollYProgress,
    [0, 0.18, 0.22, 0.38, 0.42, 0.68, 0.72, 1],
    ['0%', '8%', '25%', '33%', '50%', '58%', '75%', '100%'],
  );

  // strategy modal — opened from CaseStudy "open case" button
  const [openCase, setOpenCase] = useState<ProjectCard | null>(null);
  // built-in modal key (currently only 'dbc'). Card primary action
  // can request opening one of these by setting its action kind to
  // 'modal' with url matching the key.
  const [openBuiltinModal, setOpenBuiltinModal] = useState<'dbc' | null>(null);

  /*
   * Deep-link support: visiting "/#make-yours" opens the DBC modal
   * automatically. Carried over from the pre-rebrand site so that any
   * external links pointing at the old hash anchor still work. Cleared
   * on close so refreshing does not silently re-open the modal.
   */
  useEffect(() => {
    const checkHash = (): void => {
      if (window.location.hash === '#make-yours') {
        setOpenBuiltinModal('dbc');
      }
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, []);

  const closeBuiltinModal = (): void => {
    setOpenBuiltinModal(null);
    if (window.location.hash === '#make-yours') {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }
  };

  // chapter heading text — engineering for index 2, strategy for index 3
  const chapterLabel = activeIndex === 3 ? SECTIONS[3].label : SECTIONS[2].label;

  useEffect(() => {
    const measureChapterBox = (): void => {
      const frame = frameRef.current;
      const box = chapterDotBoxRef.current;
      if (!frame || !box) return;

      const frameRect = frame.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      const frameCenterX = frameRect.left + frameRect.width / 2;
      const frameCenterY = frameRect.top + frameRect.height / 2;
      const boxCenterY = boxRect.top + boxRect.height / 2;
      const textWidth = measureDotTextWidth(chapterLabel, DOT_FONT);

      // Hero + chapter fit: the 200-px-font dot artworks measure roughly
      // 1100 px ("sewon park.") and 1300 px ("engineering"). Density
      // alone does not guarantee they sit inside narrow viewports, so
      // each scale is clamped against the live frame width with a small
      // safety pad. The result drives both the dot transform and the
      // chapterDotTarget anchor math (which depends on the same scale).
      // On mobile the hero wraps onto two lines, so the binding width
      // is the longer line ("sewon" ≈ 560 px) — gives ~2× scale.
      const fullHeroTextWidth = measureDotTextWidth('sewon park.', DOT_FONT);
      const heroSafetyPad = 24;
      const heroBindWidth = isMobileViewport
        ? MOBILE_HERO_LINE_WIDTH
        : fullHeroTextWidth;
      const heroFit = (frameRect.width - heroSafetyPad * 2) / heroBindWidth;
      const nextHeroFit = Math.max(0.16, Math.min(densityScale, heroFit));

      const chapterMaxFit = (frameRect.width - heroSafetyPad * 2) / textWidth;
      const chapterTarget = CHAPTER_DOT_SCALE * densityScale;
      const nextChapterFit = Math.max(0.12, Math.min(chapterTarget, chapterMaxFit));

      setHeroFitScale((prev) => (Math.abs(prev - nextHeroFit) < 0.002 ? prev : nextHeroFit));
      setChapterFitScale((prev) => (Math.abs(prev - nextChapterFit) < 0.002 ? prev : nextChapterFit));
      setChapterDotTarget({
        x: boxRect.left - frameCenterX + (textWidth * nextChapterFit) / 2,
        y: boxCenterY - frameCenterY,
      });
    };

    measureChapterBox();
    document.fonts?.ready?.then(measureChapterBox).catch(() => {});

    const observer = new ResizeObserver(measureChapterBox);
    if (frameRef.current) observer.observe(frameRef.current);
    if (chapterDotBoxRef.current) observer.observe(chapterDotBoxRef.current);
    window.addEventListener('resize', measureChapterBox);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measureChapterBox);
    };
  }, [chapterDotScale, chapterLabel, densityScale, isMobileViewport]);

  // Dot canvas transforms — three keyframes:
  //   0.00 (hero)    : centered, scale 1
  //   0.20 (profile) : lifted up, slight shrink to make room for credentials
  //   0.40 (chapter) : top-left chapter heading position (measured live)
  const HERO_DOT_SCALE = heroFitScale;
  const PROFILE_LIFT_Y = -HERO_DOT_HEIGHT * 0.55 * heroFitScale;
  const PROFILE_SCALE = 0.66 * heroFitScale;

  const dotScaleRaw = useTransform(
    scrollYProgress,
    [0, 0.12, PROFILE_TEXT_START, 0.32, ENGINEERING_TEXT_START],
    [HERO_DOT_SCALE, HERO_DOT_SCALE, PROFILE_SCALE, PROFILE_SCALE, chapterDotScale],
  );
  const dotXRaw = useTransform(
    scrollYProgress,
    [0, 0.12, PROFILE_TEXT_START, 0.32, ENGINEERING_TEXT_START],
    [0, 0, 0, 0, chapterDotTarget.x],
  );
  const dotYRaw = useTransform(
    scrollYProgress,
    [0, 0.12, PROFILE_TEXT_START, 0.32, ENGINEERING_TEXT_START],
    [0, 0, PROFILE_LIFT_Y, PROFILE_LIFT_Y, chapterDotTarget.y],
  );

  /*
   * Mobile dot canvas — driven by activeIndex, NOT live scrollYProgress.
   * On a phone the live tracking causes the cloud to scrub continuously
   * while the user is still mid-swipe, which makes touch areas shift
   * under the finger and feels jerky. Instead we observe activeIndex
   * (which only flips after the snap settles on the next section) and
   * tween three motion values to the discrete target with our signature
   * ease-settle curve. Desktop keeps the live scroll behaviour. */
  const dotScaleM = useMotionValue(heroFitScale);
  const dotXM = useMotionValue(0);
  const dotYM = useMotionValue(0);

  useEffect(() => {
    if (!isMobileViewport) return;
    /*
     * Mobile profile lift is computed against the actual frame height
     * (not the desktop hero-height proxy). The profile layer is now
     * centered vertically via flex on the mobile media query, so the
     * dot needs to climb to roughly the upper-third (≈ 20 % from top)
     * to leave clear air above the "works in code…" statement.
     */
    const frameHeight = frameRef.current?.getBoundingClientRect().height
      ?? (typeof window !== 'undefined' ? window.innerHeight : 0);
    const mobileProfileLiftY = -frameHeight * 0.3;

    let scaleTarget: number;
    let xTarget: number;
    let yTarget: number;
    switch (activeIndex) {
      case 0:
        scaleTarget = HERO_DOT_SCALE;
        xTarget = 0;
        yTarget = 0;
        break;
      case 1:
        scaleTarget = PROFILE_SCALE;
        xTarget = 0;
        yTarget = mobileProfileLiftY;
        break;
      case 2:
      case 3:
      default:
        scaleTarget = chapterDotScale;
        xTarget = chapterDotTarget.x;
        yTarget = chapterDotTarget.y;
        break;
    }
    const opts = { duration: 0.36, ease: CASE_EASE };
    const a1 = animate(dotScaleM, scaleTarget, opts);
    const a2 = animate(dotXM, xTarget, opts);
    const a3 = animate(dotYM, yTarget, opts);
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [
    activeIndex,
    isMobileViewport,
    HERO_DOT_SCALE,
    PROFILE_SCALE,
    chapterDotScale,
    chapterDotTarget.x,
    chapterDotTarget.y,
    dotScaleM,
    dotXM,
    dotYM,
  ]);

  const dotScale = isMobileViewport ? dotScaleM : dotScaleRaw;
  const dotX = isMobileViewport ? dotXM : dotXRaw;
  const dotY = isMobileViewport ? dotYM : dotYRaw;

  /* Mobile two-line wrap of "sewon park.": fetch the preset, transform
     park dots to the second line, hand the result to DotMorph as
     staticDots. Other labels (engineering / strategy / nothing) use
     the preset / sampling default. */
  const heroStaticDots = useMemo(() => {
    if (!isMobileViewport) return undefined;
    if (activeLabel !== 'sewon park.') return undefined;
    const preset = lookupPreset('sewon park.');
    if (!preset) return undefined;
    return dotsForMobileTwoLine(preset);
  }, [isMobileViewport, activeLabel]);

  // hero tagline — visible only at section 0
  const heroTaglineOpacity = useTransform(
    scrollYProgress,
    [0, 0.1, 0.16],
    [1, 1, 0],
  );

  // profile (statement + credentials) — visible only at section 1
  const profileOpacity = useTransform(
    scrollYProgress,
    [0.16, PROFILE_TEXT_START + 0.02, 0.36, ENGINEERING_TEXT_START],
    [0, 1, 1, 0],
  );
  const profileY = useTransform(
    scrollYProgress,
    [0.16, PROFILE_TEXT_START + 0.02],
    [16, 0],
  );

  // scroll cue
  const cueOpacity = useTransform(scrollYProgress, [0, 0.08, 0.14], [1, 1, 0]);
  const heroOnlyOpacity = activeIndex === 0 ? heroTaglineOpacity : 0;
  const heroOnlyCueOpacity = activeIndex === 0 ? cueOpacity : 0;
  const profileLayerOpacity = activeIndex === 1 ? profileOpacity : 0;
  const fieldOpacityRaw = useTransform(
    scrollYProgress,
    [0.34, ENGINEERING_TEXT_START, 0.96],
    [0, 1, 1],
  );
  const fieldOpacity = activeIndex >= 2 ? fieldOpacityRaw : 0;
  const fieldY = useTransform(
    scrollYProgress,
    [ENGINEERING_TEXT_START, STRATEGY_TEXT_START, 1],
    [0, -12 * densityScale, -24 * densityScale],
  );


  return (
    <div ref={zoneRef} className={styles.zone}>
      {/* Snap anchors — invisible scroll-snap targets at each section
          threshold so the page parks on hero / profile / engineering /
          strategy and never between two sections. */}
      <span className={`${styles.snapAnchor} ${styles.snapAnchorHero}`} aria-hidden="true" />
      <span className={`${styles.snapAnchor} ${styles.snapAnchorProfile}`} aria-hidden="true" />
      <span className={`${styles.snapAnchor} ${styles.snapAnchorEngineering}`} aria-hidden="true" />
      <span className={`${styles.snapAnchor} ${styles.snapAnchorStrategy}`} aria-hidden="true" />
      <div className={styles.stage}>
        <div
          ref={frameRef}
          className={styles.frame}
          style={frameStyle}
        >
          {/* chrome */}
          <div className={styles.guides} aria-hidden="true">
            <span className={styles.guide} />
            <span className={styles.guide} />
            <span className={styles.guide} />
            <span className={styles.guide} />
            <span className={styles.guide} />
          </div>
          <motion.span
            className={styles.tonalField}
            style={{ opacity: fieldOpacity, y: fieldY }}
            aria-hidden="true"
          />
          {/* right-edge rail + thumb — physical chapter selector. */}
          <div className={styles.accentTrack} aria-hidden="true">
            <span className={styles.accentRail} />
            <span className={`${styles.accentStop} ${styles.accentStopStart}`} />
            <span className={`${styles.accentStop} ${styles.accentStopProfile}`} />
            <span className={`${styles.accentStop} ${styles.accentStopEngineering}`} />
            <span className={`${styles.accentStop} ${styles.accentStopStrategy}`} />
            <span className={`${styles.accentStop} ${styles.accentStopEnd}`} />
            <motion.span
              className={styles.accentBar}
              style={{ top: accentBarTop }}
            />
          </div>
          <motion.span
            className={styles.scrollCue}
            style={{ opacity: heroOnlyCueOpacity }}
            aria-hidden="true"
          >
            scroll
          </motion.span>
          <span
            ref={chapterDotBoxRef}
            className={styles.chapterDotBox}
            aria-hidden="true"
          />



          {/* dot canvas — anchored to frame center, scaled+translated by scroll */}
          <div className={styles.dotAnchor}>
            <motion.div
              className={styles.dotStage}
              style={{ scale: dotScale, x: dotX, y: dotY }}
            >
              <DotMorph
                text={activeLabel}
                width={HERO_DOT_WIDTH}
                height={HERO_DOT_HEIGHT}
                step={8}
                dotRadius={3.2}
                threshold={110}
                accentCount={32}
                font={DOT_FONT}
                onAccentHit={onAccentHit}
                staticDots={heroStaticDots}
              />
            </motion.div>
          </div>

          {/* hero tagline — visible only at section 0 */}
          <motion.div
            className={styles.heroTagline}
            style={{ opacity: heroOnlyOpacity }}
            aria-hidden={activeIndex !== 0}
          >
            <span className={styles.taglineLeft}>reason, all the way down.</span>
            <span className={styles.taglineRight}>engineering · strategy</span>
          </motion.div>

          {/* profile (statement + credentials) — visible only at section 1 */}
          <motion.div
            className={styles.profileLayer}
            style={{ opacity: profileLayerOpacity, y: profileY }}
            aria-hidden={activeIndex !== 1}
          >
            <p className={styles.profileStatement}>{heroStatement}</p>
            <dl className={styles.profileCredentials}>
              {heroCredentials.map((row) => (
                <div key={row.label} className={styles.profileRow}>
                  <dt className={styles.profileLabel}>{row.label}</dt>
                  <dd className={styles.profileValue}>{row.value}</dd>
                </div>
              ))}
              <div className={styles.profileRow}>
                <dt className={styles.profileLabel}>contact</dt>
                <dd className={`${styles.profileValue} ${styles.profileLinks}`}>
                  <a href="mailto:rlaalsgur2367@inu.ac.kr">mail</a>
                  {' · '}
                  <a
                    href="https://github.com/sewon-p"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    github
                  </a>
                  {' · '}
                  <a href="/SewonPark_CV.pdf" download>
                    cv
                  </a>
                </dd>
              </div>
            </dl>
          </motion.div>

          {activeIndex === 2 ? (
            <motion.div
              key="engineering"
              className={styles.caseLayer}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={CASE_TRANSITION}
            >
              <motion.span
                className={styles.caseBackdrop}
                aria-hidden="true"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.56, ease: CASE_EASE, delay: 0.08 }}
              />
              <h2 className={styles.caseLayerLabel}>
                engineering · {engineering.length} projects
              </h2>
              <ChapterCases
                projects={engineering}
                onOpenBuiltin={setOpenBuiltinModal}
              />
            </motion.div>
          ) : null}

          {activeIndex === 3 ? (
            <motion.div
              key="strategy"
              className={styles.caseLayer}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={CASE_TRANSITION}
            >
              <motion.span
                className={styles.caseBackdrop}
                aria-hidden="true"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.56, ease: CASE_EASE, delay: 0.08 }}
              />
              <h2 className={styles.caseLayerLabel}>
                strategy · {strategy.length} cases
              </h2>
              <ChapterCases
                projects={strategy}
                onOpenCase={setOpenCase}
                onOpenBuiltin={setOpenBuiltinModal}
              />
            </motion.div>
          ) : null}
        </div>
      </div>

      <AnimatePresence>
        {openCase ? (
          <CaseModal project={openCase} onClose={() => setOpenCase(null)} />
        ) : null}
        {openBuiltinModal === 'dbc' ? (
          <DbcModal onClose={closeBuiltinModal} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}


// Global handler for the legacy `<div onclick="window.toggleUxBulletin(this)">`
// markup inside p3.html (UX transformation demo). Using a window-scoped
// function keeps the inline attribute working through dangerouslySetInnerHTML.
declare global {
  interface Window {
    toggleUxBulletin?: (el: HTMLElement) => void;
  }
}

function ensureUxBulletinHandler(): void {
  if (typeof window === 'undefined') return;
  if (window.toggleUxBulletin) return;
  window.toggleUxBulletin = (el: HTMLElement): void => {
    el.classList.toggle('is-active');
  };
}

interface CaseModalProps {
  project: ProjectCard;
  onClose: () => void;
}

function CaseModal({ project, onClose }: CaseModalProps): ReactElement {
  const legacyHtml = getLegacyCaseHtml(project.number);
  const shellRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [progress, setProgress] = useState(0);

  useModalA11y(wrapRef, onClose);
  ensureUxBulletinHandler();

  // Track scroll progress inside the modal shell so the right-edge
  // tint bar mirrors the page's top-right accent (slides top→bottom
  // as the user reads through the case study).
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const onScroll = (): void => {
      const max = shell.scrollHeight - shell.clientHeight;
      const ratio = max > 0 ? shell.scrollTop / max : 0;
      setProgress(Math.max(0, Math.min(1, ratio)));
    };
    onScroll();
    shell.addEventListener('scroll', onScroll, { passive: true });
    return () => shell.removeEventListener('scroll', onScroll);
  }, [legacyHtml]);

  /*
   * Spline upgrade — eager. As soon as the modal mounts and the
   * <spline-viewer> custom element is registered, replace every
   * `<div class="spline-placeholder" data-spline-url="…">` with a
   * real <spline-viewer>. The IntersectionObserver-based lazy path
   * we used previously had two failure modes (StrictMode dev double-
   * mount stranding the upgrade flag, and modals where the user
   * never scrolled past the fold) and silent failure beats clever:
   * eager guarantees the scenes always render. The viewer carries
   * loading="lazy" so Spline still defers its own WebGL init until
   * the canvas itself becomes visible.
   */
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    let cancelled = false;
    void customElements.whenDefined('spline-viewer').then(() => {
      if (cancelled) return;
      const placeholders = shell.querySelectorAll<HTMLElement>(
        '.spline-placeholder[data-spline-url]:not([data-spline-upgraded])',
      );
      placeholders.forEach((el) => {
        const url = el.getAttribute('data-spline-url');
        if (!url) return;
        const viewer = document.createElement('spline-viewer');
        viewer.setAttribute('url', url);
        viewer.setAttribute('loading-anim-type', 'spinner-small-dark');
        viewer.setAttribute('loading', 'lazy');
        viewer.setAttribute('pixel-ratio', '1.5');
        viewer.style.width = '100%';
        viewer.style.height = '100%';
        el.replaceChildren(viewer);
        el.dataset.splineUpgraded = '1';
      });
    });

    return () => {
      cancelled = true;
    };
  }, [legacyHtml]);
  return (
    <motion.div
      className={styles.modalOverlay}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        ref={wrapRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.modalCardWrap}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={CASE_TRANSITION}
      >
        {/* right-edge reading rail, mirrors the home page selector.
            Lives outside the scroll shell so it stays pinned. */}
        <div className={styles.modalProgressTrack} aria-hidden="true">
          <span className={styles.modalProgressRail} />
          <span
            className={styles.modalProgressBar}
            style={{ top: `calc(${progress * 100}% - ${progress} * var(--xs))` }}
          />
        </div>

        <div ref={shellRef} className={styles.modalShell}>
          <span id={titleId} className="srOnly">{project.title}</span>
          <button
            type="button"
            className={styles.modalCloseFloat}
            onClick={onClose}
            aria-label="Close case study"
          >
            <span aria-hidden="true">×</span>
          </button>

          {legacyHtml ? (
            <div
              className="legacyCase"
              dangerouslySetInnerHTML={{ __html: legacyHtml }}
            />
          ) : (
            <Card variant="l2" className={styles.modalCard}>
              <Card.Head>
                <span className={styles.caseNumber}>{project.number}</span>
                {project.kicker ? <span>{project.kicker}</span> : null}
                <span className={styles.caseYear}>{project.year}</span>
              </Card.Head>
              <Card.Title className={styles.modalTitle}>{project.title}</Card.Title>
              <Card.Body>{project.blurb}</Card.Body>
              {project.points && project.points.length > 0 ? (
                <Card.Points>
                  {project.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </Card.Points>
              ) : null}
              <Card.Tags>
                {project.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </Card.Tags>
            </Card>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

interface ChapterCasesProps {
  projects: ProjectCard[];
  /** when set, "open case" button opens this modal target (strategy chapter) */
  onOpenCase?: (project: ProjectCard) => void;
  /** open a named built-in modal (e.g., 'dbc' for the DBC card) */
  onOpenBuiltin?: (key: 'dbc') => void;
}

function ChapterCases({ projects, onOpenCase, onOpenBuiltin }: ChapterCasesProps): ReactElement {
  // active = which project is shown in the main column.
  // Side index includes ALL projects (1, 2, 3 …); clicking one of
  // them swaps the main without leaving the chapter.
  const [activeNumber, setActiveNumber] = useState(projects[0].number);
  const active = projects.find((p) => p.number === activeNumber) ?? projects[0];

  // reset to first project when the projects array changes (chapter swap)
  useEffect(() => {
    setActiveNumber(projects[0].number);
  }, [projects]);

  return (
    <CaseStudy
      project={active}
      allProjects={projects}
      activeNumber={activeNumber}
      onSelect={setActiveNumber}
      onOpenCase={onOpenCase}
      onOpenBuiltin={onOpenBuiltin}
    />
  );
}

interface CaseStudyProps {
  project: ProjectCard;
  allProjects: ProjectCard[];
  activeNumber: string;
  onSelect: (n: string) => void;
  /** when set, "open case" button opens this modal target (strategy chapter) */
  onOpenCase?: (project: ProjectCard) => void;
  onOpenBuiltin?: (key: 'dbc') => void;
}

function CaseStudy({
  project,
  allProjects,
  activeNumber,
  onSelect,
  onOpenCase,
  onOpenBuiltin,
}: CaseStudyProps): ReactElement {
  const shouldReduceMotion = useReducedMotion();
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <CaseSlider
        allProjects={allProjects}
        activeNumber={activeNumber}
        onSelect={onSelect}
        onOpenCase={onOpenCase}
        onOpenBuiltin={onOpenBuiltin}
      />
    );
  }
  const caseShellVariants: Variants = shouldReduceMotion
    ? {
        hidden: { opacity: 1 },
        show: { opacity: 1 },
        exit: { opacity: 1 },
      }
    : {
        hidden: { opacity: 0, filter: 'blur(2px)' },
        show: {
          opacity: 1,
          filter: 'blur(0px)',
          transition: {
            duration: 0.28,
            ease: CASE_EASE,
            staggerChildren: 0.045,
          },
        },
        exit: {
          opacity: 0,
          filter: 'blur(2px)',
          transition: { duration: 0.18, ease: CASE_EASE },
        },
      };
  const caseItemVariants: Variants = shouldReduceMotion
    ? {
        hidden: { opacity: 1 },
        show: { opacity: 1 },
        exit: { opacity: 1 },
      }
    : {
        hidden: { opacity: 0, filter: 'blur(2px)' },
        show: {
          opacity: 1,
          filter: 'blur(0px)',
          transition: { duration: 0.24, ease: CASE_EASE },
        },
        exit: { opacity: 0, transition: { duration: 0.14, ease: CASE_EASE } },
      };

  return (
    <div className={styles.case}>
      <div className={styles.caseMain}>
        <AnimatePresence mode="wait">
          <motion.div
            key={project.number}
            className={styles.caseDisplay}
            variants={caseShellVariants}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <motion.div className={styles.caseHead} variants={caseItemVariants}>
              <span className={styles.caseNumber}>{project.number}</span>
              {project.kicker ? (
                <span className={styles.caseKicker}>{project.kicker}</span>
              ) : null}
              <span className={styles.caseYear}>{project.year}</span>
            </motion.div>

            <motion.h3 className={styles.caseTitle} variants={caseItemVariants}>
              {project.title}
            </motion.h3>

            <motion.p className={styles.caseBlurb} variants={caseItemVariants}>
              {project.blurb}
            </motion.p>

            {project.points && project.points.length > 0 ? (
              <motion.ul className={styles.casePoints} variants={caseItemVariants}>
                {project.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </motion.ul>
            ) : null}

            <motion.div className={styles.caseTags} variants={caseItemVariants}>
              {project.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </motion.div>

            <motion.div className={styles.caseActions} variants={caseItemVariants}>
              {(() => {
                const action = project.primaryAction;
                if (action) {
                  return (
                    <Button
                      variant="primary"
                      onClick={() => {
                        if (action.kind === 'modal') {
                          onOpenBuiltin?.(action.url);
                        } else {
                          window.open(action.url, '_blank', 'noopener,noreferrer');
                        }
                      }}
                    >
                      {action.label}
                    </Button>
                  );
                }
                if (onOpenCase) {
                  if (isMobile) {
                    /* legacy strategy modals are dense, multi-column case
                       studies that do not collapse cleanly into a phone
                       column. Surface the headline and bullets inline
                       above; nudge full-detail readers to desktop. */
                    return (
                      <p className={styles.caseDesktopNotice}>
                        full case study available on desktop
                      </p>
                    );
                  }
                  return (
                    <Button variant="primary" onClick={() => onOpenCase(project)}>
                      Open Case
                    </Button>
                  );
                }
                return null;
              })()}
              {project.githubUrl ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    window.open(
                      project.githubUrl,
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                >
                  GitHub
                </Button>
              ) : null}
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      <ul className={styles.caseSide}>
        {allProjects.map((p) => {
          const isActive = p.number === activeNumber;
          return (
            <li
              key={p.number}
              className={`${styles.caseSideRow} ${isActive ? styles.caseSideRowActive : ''}`}
            >
              {isActive ? (
                <motion.span
                  layoutId="case-side-thumb"
                  className={styles.caseSideThumb}
                  transition={CASE_TRANSITION}
                  aria-hidden="true"
                />
              ) : null}
              <button
                type="button"
                className={styles.caseSideLink}
                onClick={() => onSelect(p.number)}
                aria-current={isActive ? 'true' : undefined}
              >
                <span className={styles.caseSideNum}>{p.number}</span>
                <span className={styles.caseSideTitle}>{p.title}</span>
                <span className={styles.caseSideYear}>{p.year}</span>
              </button>
            </li>
          );
        })}
      </ul>

    </div>
  );
}

interface CaseSliderProps {
  allProjects: ProjectCard[];
  activeNumber: string;
  onSelect: (n: string) => void;
  onOpenCase?: (project: ProjectCard) => void;
  onOpenBuiltin?: (key: 'dbc') => void;
}

/*
 * Mobile case slider — a single-axis scroll-snap track. The chapter
 * lays out one case per slide; the user moves between them with a
 * thumb swipe (or drag on desktop devtools), and the small numerical
 * counter at the top updates as the snap settles. No nav buttons:
 * the gesture itself is the control, in the spirit of Rams' "less,
 * but better" — let the obvious affordance do the work.
 */
function CaseSlider({
  allProjects,
  activeNumber,
  onSelect,
  onOpenCase,
  onOpenBuiltin,
}: CaseSliderProps): ReactElement {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const total = allProjects.length;
  const activeIndex = Math.max(
    0,
    allProjects.findIndex((p) => p.number === activeNumber),
  );

  /* Sync the slider scroll position when activeNumber comes from
     somewhere other than a swipe (e.g. desktop side-index → resize
     to mobile). Uses scrollTo with auto behavior to avoid an init jump. */
  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;
    const targetLeft = activeIndex * el.clientWidth;
    if (Math.abs(el.scrollLeft - targetLeft) > 1) {
      el.scrollTo({ left: targetLeft, behavior: 'auto' });
    }
  }, [activeIndex]);

  /* Pull activeNumber from the snap position so other consumers
     (chapter heading, etc.) stay in sync with the visible slide.
     Also drive the rail bar position so the tint indicator slides
     smoothly with the swipe — same behaviour as the desktop accent
     bar, just rotated 90 degrees. */
  const onScroll = (): void => {
    const el = sliderRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const progress = max > 0 ? el.scrollLeft / max : 0;
    setScrollProgress(progress);
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    const target = allProjects[idx];
    if (target && target.number !== activeNumber) {
      onSelect(target.number);
    }
  };

  const current = allProjects[activeIndex];
  const totalLabel = String(total).padStart(2, '0');

  return (
    <div className={styles.case}>
      <div className={styles.caseSliderHeader}>
        <span className={styles.caseSliderCounter} aria-live="polite">
          <span className={styles.caseSliderCurrent}>
            {current?.number ?? '01'}
          </span>
          <span className={styles.caseSliderDivider}>/</span>
          <span className={styles.caseSliderTotal}>{totalLabel}</span>
        </span>
        <div className={styles.caseSliderRail} aria-hidden="true">
          <span className={styles.caseSliderRailLine} />
          {allProjects.map((p, i) => (
            <span
              key={p.number}
              className={styles.caseSliderStop}
              style={{
                left: total > 1 ? `${(i / (total - 1)) * 100}%` : '50%',
              }}
            />
          ))}
          <span
            className={styles.caseSliderBar}
            style={{ left: `${scrollProgress * 100}%` }}
          />
        </div>
      </div>
      <div
        ref={sliderRef}
        className={styles.caseSlider}
        onScroll={onScroll}
        role="region"
        aria-label="Case studies, swipe to browse"
      >
        {allProjects.map((p) => (
          <article key={p.number} className={styles.caseSlide}>
            <CaseContent
              project={p}
              onOpenCase={onOpenCase}
              onOpenBuiltin={onOpenBuiltin}
              isMobile
            />
          </article>
        ))}
      </div>
    </div>
  );
}

interface CaseContentProps {
  project: ProjectCard;
  onOpenCase?: (project: ProjectCard) => void;
  onOpenBuiltin?: (key: 'dbc') => void;
  isMobile: boolean;
}

function CaseContent({
  project,
  onOpenCase,
  onOpenBuiltin,
  isMobile,
}: CaseContentProps): ReactElement {
  const action = project.primaryAction;

  const renderPrimary = (): ReactElement | null => {
    if (action) {
      return (
        <Button
          variant="primary"
          onClick={() => {
            if (action.kind === 'modal') {
              onOpenBuiltin?.(action.url);
            } else {
              window.open(action.url, '_blank', 'noopener,noreferrer');
            }
          }}
        >
          {action.label}
        </Button>
      );
    }
    if (onOpenCase) {
      if (isMobile) {
        return (
          <p className={styles.caseDesktopNotice}>
            full case study available on desktop
          </p>
        );
      }
      return (
        <Button variant="primary" onClick={() => onOpenCase(project)}>
          Open Case
        </Button>
      );
    }
    return null;
  };

  return (
    <div className={styles.caseDisplay}>
      <div className={styles.caseHead}>
        <span className={styles.caseNumber}>{project.number}</span>
        {project.kicker ? (
          <span className={styles.caseKicker}>{project.kicker}</span>
        ) : null}
        <span className={styles.caseYear}>{project.year}</span>
      </div>
      <h3 className={styles.caseTitle}>{project.title}</h3>
      <p className={styles.caseBlurb}>{project.blurb}</p>
      {project.points && project.points.length > 0 ? (
        <ul className={styles.casePoints}>
          {project.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
      <div className={styles.caseTags}>
        {project.tags.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className={styles.caseActions}>
        {renderPrimary()}
        {project.githubUrl ? (
          <Button
            variant="ghost"
            onClick={() =>
              window.open(project.githubUrl, '_blank', 'noopener,noreferrer')
            }
          >
            GitHub
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/*
 * Home density is a fluid content scale, not a device table. The
 * composition keeps growing past 15" (1680 px) — capping there made
 * 27" QHD / ultrawide displays feel sparse, with the artwork floating
 * in a sea of unused viewport. Three anchor widths drive the ramp:
 *   - phone   (≤480 px)              → MOBILE_DENSITY  (~0.92, mobile-tight)
 *   - 13" desktop (~1280 px)         → DESKTOP_COMPACT_DENSITY (0.9)
 *   - 15" desktop (~1680 px)         → DENSITY_REFERENCE (1.0)
 *   - beyond 1680                    → keeps the same 1280→1680 slope
 *                                      (linear), capped only by an
 *                                      absolute ceiling for safety.
 */
const MOBILE_DENSITY = 0.92;
const DESKTOP_COMPACT_DENSITY = 0.9;
const DENSITY_REFERENCE = 1;
const DENSITY_CEILING = 1.5;
const MOBILE_MAX_WIDTH = 480;
const DESKTOP_COMPACT_WIDTH = 1280;
const DENSITY_FULL_WIDTH = 1680;

function useHomeDensity(): number {
  const [density, setDensity] = useState(() => {
    if (typeof window === 'undefined') return DENSITY_REFERENCE;
    return getHomeDensity(window.innerWidth);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const update = (): void => setDensity(getHomeDensity(window.innerWidth));

    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);

    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  return density;
}

function getHomeDensity(width: number): number {
  if (width <= MOBILE_MAX_WIDTH) return MOBILE_DENSITY;
  if (width <= DESKTOP_COMPACT_WIDTH) {
    // mobile → desktop-compact ramp (480 → 1280)
    const t = (width - MOBILE_MAX_WIDTH) / (DESKTOP_COMPACT_WIDTH - MOBILE_MAX_WIDTH);
    return MOBILE_DENSITY + (DESKTOP_COMPACT_DENSITY - MOBILE_DENSITY) * t;
  }
  /* Past the 13" anchor we extend the desktop slope linearly so 27"
     QHD / ultrawide monitors keep gaining UI presence instead of
     hitting a hard cap at 1680. The slope is the (compact → reference)
     run; capped at DENSITY_CEILING so 4K+ displays stay reasonable. */
  const slope = (DENSITY_REFERENCE - DESKTOP_COMPACT_DENSITY)
    / (DENSITY_FULL_WIDTH - DESKTOP_COMPACT_WIDTH);
  const linear = DESKTOP_COMPACT_DENSITY + (width - DESKTOP_COMPACT_WIDTH) * slope;
  return Math.min(DENSITY_CEILING, linear);
}

const MOBILE_BREAKPOINT_PX = 720;

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= MOBILE_BREAKPOINT_PX;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const update = (): void => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT_PX);

    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);

    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  return isMobile;
}

/*
 * useScrollSectionIndex — subscribes to a MotionValue and returns the
 * current section index. Plain useState avoids re-rendering on every
 * scroll tick; only when the section actually flips.
 */
function useScrollSectionIndex(
  zoneRef: RefObject<HTMLDivElement | null>,
): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const updateIndex = (): void => {
      const zone = zoneRef.current;
      if (!zone) return;

      const scrollable = zone.offsetHeight - window.innerHeight;
      const progress = scrollable > 0
        ? Math.max(0, Math.min(1, -zone.getBoundingClientRect().top / scrollable))
        : 0;
      const next = getSectionIndex(progress);
      setIndex((prev) => (prev === next ? prev : next));
    };

    updateIndex();
    window.addEventListener('scroll', updateIndex, { passive: true });
    window.addEventListener('resize', updateIndex);

    return () => {
      window.removeEventListener('scroll', updateIndex);
      window.removeEventListener('resize', updateIndex);
    };
  }, [zoneRef]);

  return index;
}

/*
 * Section flips happen ~6% before the visual landing point so the
 * dot morph (slow spring) has time to migrate during the scroll
 * transition instead of starting only after the user arrives.
 */
const SECTION_LEAD = 0.06;
function getSectionIndex(progress: number): number {
  if (progress >= STRATEGY_TEXT_START - SECTION_LEAD) return 3;
  if (progress >= ENGINEERING_TEXT_START - SECTION_LEAD) return 2;
  if (progress >= PROFILE_TEXT_START - SECTION_LEAD) return 1;
  return 0;
}

function measureDotTextWidth(text: string, font: string): number {
  if (typeof document === 'undefined') return HERO_DOT_WIDTH / 2;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return HERO_DOT_WIDTH / 2;

  context.font = font;
  return context.measureText(text).width;
}
