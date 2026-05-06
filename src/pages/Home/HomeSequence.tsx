import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type Variants,
} from 'motion/react';
import { DotMorph } from '../../composition/DotMorph/DotMorph';
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
const HERO_SCALE_REFERENCE_WIDTH = 1920;
const HERO_SCALE_REFERENCE_HEIGHT = 980;
const HERO_SCALE_MIN = 0.78;
const HERO_SCALE_MAX = 1.10;
const CHAPTER_DOT_SCALE_MAX = 0.38;
const CHAPTER_DOT_SCALE_MIN = 0.16;
// scale = clamp(MIN, frameWidth / DIVISOR, MAX). 5000 was tuned so a
// 1900px frame lands exactly at MAX (0.38) and a 720px frame at 0.144,
// which clamps to MIN (0.16). Linear in between.
const CHAPTER_SCALE_DIVISOR = 5000;
const CHAPTER_DOT_FALLBACK = { x: -HERO_DOT_WIDTH * 0.26, y: -HERO_DOT_HEIGHT * 1.05 };
const PROFILE_TEXT_START = 0.20;
const ENGINEERING_TEXT_START = 0.40;
const STRATEGY_TEXT_START = 0.70;
const CASE_EASE = [0.32, 0.72, 0, 1] as const;
const CASE_TRANSITION = {
  duration: 0.28,
  ease: CASE_EASE,
} as const;

export function HomeSequence(): ReactElement {
  const zoneRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const chapterDotBoxRef = useRef<HTMLSpanElement>(null);
  const [chapterDotTarget, setChapterDotTarget] = useState(CHAPTER_DOT_FALLBACK);
  const [chapterScale, setChapterScale] = useState(CHAPTER_DOT_SCALE_MAX);
  const [heroScale, setHeroScale] = useState(1);
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

  // chapter heading text — engineering for index 2, strategy for index 3
  const chapterLabel = activeIndex === 3 ? SECTIONS[3].label : SECTIONS[2].label;

  useEffect(() => {
    const measureChapterBox = (): void => {
      const frame = frameRef.current;
      const box = chapterDotBoxRef.current;
      if (!frame || !box) return;

      const frameRect = frame.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      const viewportScale = Math.min(
        frameRect.width / HERO_SCALE_REFERENCE_WIDTH,
        frameRect.height / HERO_SCALE_REFERENCE_HEIGHT,
      );
      const nextHeroScale = Math.max(
        HERO_SCALE_MIN,
        Math.min(HERO_SCALE_MAX, viewportScale),
      );
      const frameCenterX = frameRect.left + frameRect.width / 2;
      const frameCenterY = frameRect.top + frameRect.height / 2;
      const boxCenterY = boxRect.top + boxRect.height / 2;
      const textWidth = measureDotTextWidth(chapterLabel, DOT_FONT);

      const nextScale = Math.max(
        CHAPTER_DOT_SCALE_MIN,
        Math.min(CHAPTER_DOT_SCALE_MAX, frameRect.width / CHAPTER_SCALE_DIVISOR),
      );

      setHeroScale((prev) => (Math.abs(prev - nextHeroScale) < 0.002 ? prev : nextHeroScale));
      setChapterScale((prev) => (Math.abs(prev - nextScale) < 0.002 ? prev : nextScale));
      setChapterDotTarget({
        x: boxRect.left - frameCenterX + (textWidth * nextScale) / 2,
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
  }, [chapterLabel]);

  // Dot canvas transforms — three keyframes:
  //   0.00 (hero)    : centered, scale 1
  //   0.20 (profile) : lifted up, slight shrink to make room for credentials
  //   0.40 (chapter) : top-left chapter heading position (measured live)
  const PROFILE_LIFT_Y = -HERO_DOT_HEIGHT * 0.55 * heroScale;
  const PROFILE_SCALE = 0.66 * heroScale;

  const dotScaleRaw = useTransform(
    scrollYProgress,
    [0, 0.12, PROFILE_TEXT_START, 0.32, ENGINEERING_TEXT_START],
    [heroScale, heroScale, PROFILE_SCALE, PROFILE_SCALE, chapterScale],
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


  return (
    <div ref={zoneRef} className={styles.zone}>
      <div className={styles.stage}>
        <div
          ref={frameRef}
          className={styles.frame}
          style={{ '--chapter-scale': chapterScale } as CSSProperties}
        >
          {/* chrome */}
          <div className={styles.guides} aria-hidden="true">
            <span className={styles.guide} />
            <span className={styles.guide} />
            <span className={styles.guide} />
            <span className={styles.guide} />
            <span className={styles.guide} />
          </div>
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
              style={{ scale: dotScaleRaw, x: dotXRaw, y: dotYRaw }}
            >
              <DotMorph
                text={activeLabel}
                width={HERO_DOT_WIDTH}
                height={HERO_DOT_HEIGHT}
                step={8}
                dotRadius={3.2}
                threshold={110}
                accentCount={16}
                font={DOT_FONT}
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
          <DbcModal onClose={() => setOpenBuiltinModal(null)} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const SPLINE_VIEWER_SRC =
  'https://unpkg.com/@splinetool/viewer@1.9.48/build/spline-viewer.js';

function ensureSplineViewerScript(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`script[data-spline-viewer]`)) return;
  const script = document.createElement('script');
  script.type = 'module';
  script.src = SPLINE_VIEWER_SRC;
  script.dataset.splineViewer = '1';
  document.head.appendChild(script);
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

  // Spline 3D scene loader. Lazily upgrades any `.spline-placeholder[data-url]`
  // inside the legacy HTML to a real `<spline-viewer>` once it scrolls into view.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const placeholders = shell.querySelectorAll<HTMLElement>('.spline-placeholder[data-url]');
    if (placeholders.length === 0) return;

    let cancelled = false;
    ensureSplineViewerScript();

    const upgrade = (el: HTMLElement): void => {
      const url = el.dataset.url;
      if (!url || el.dataset.loaded === '1' || cancelled) return;
      el.dataset.loaded = '1';
      void customElements.whenDefined('spline-viewer').then(() => {
        if (cancelled) return;
        const viewer = document.createElement('spline-viewer');
        viewer.setAttribute('url', url);
        viewer.setAttribute('loading-anim-type', 'none');
        viewer.style.width = '100%';
        viewer.style.height = '100%';
        el.replaceChildren(viewer);
      });
    };

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        upgrade(el);
        observer.unobserve(el);
      }
    }, { root: shell, rootMargin: '400px', threshold: 0 });

    for (const el of placeholders) observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
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
