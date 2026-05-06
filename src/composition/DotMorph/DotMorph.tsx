import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { matchDots, type Pair } from './match';
import { sampleTextDots, type DotPoint } from './sample';
import { lookupPreset } from './dot-presets';
import styles from './DotMorph.module.css';

/*
 * DotMorph — animated point cloud that morphs between text strings.
 *
 * Each dot has a stable id derived from its slot in the persistent
 * "pool". When the target text changes, dots in the current cloud
 * are matched (nearest neighbor) to dots in the new cloud, keeping
 * their ids and colors. Excess dots fade out, missing dots fade in.
 *
 * A small subset of ids carries the tint color and rides along
 * across morphs — visible signature.
 *
 * Rendering is done with requestAnimationFrame on a single 2D canvas
 * for performance with hundreds of dots.
 */

type ActiveDot = {
  id: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  alpha: number;
  targetAlpha: number;
  color: string;
};

interface DotMorphProps {
  text: string;
  width?: number;
  height?: number;
  font?: string;
  step?: number;
  /** rendered radius of each dot in px */
  dotRadius?: number;
  /** luminance cutoff (0–255) for "this pixel is glyph". Lower catches
   *  anti-aliased edges and fills bowls more fully. */
  threshold?: number;
  /** number of accent (tint) dots in the persistent palette */
  accentCount?: number;
  /** color of normal dots */
  inkColor?: string;
  /** color of accent dots */
  tintColor?: string;
  /** ms duration of one morph tween (per-dot, base) */
  duration?: number;
  /** Fired when the user taps within an accent dot. Used by the hero
   *  to wire the easter-egg "3 clicks → dot editor" interaction. */
  onAccentHit?: () => void;
  /** When provided, used as the morph target instead of the preset
   *  lookup or runtime sampling. Lets the caller transform the dot
   *  layout (e.g. wrap "sewon park." onto two lines on mobile)
   *  while keeping the same text identity for animation matching. */
  staticDots?: DotPoint[];
  className?: string;
  style?: React.CSSProperties;
}

// Slower spring → the morph keeps animating across the entire scroll
// transition between sections, instead of finishing instantly when
// the section flips. Visual effect: dots are still mid-flight while
// the cloud is also being translated to its new position.
const SPRING_DAMPING = 0.92;
const SPRING_STIFFNESS = 0.04;

export function DotMorph({
  text,
  width = 1280,
  height = 320,
  font = "500 200px 'Geist', 'Geist Mono', system-ui, sans-serif",
  step = 8,
  dotRadius = 3.2,
  threshold = 110,
  accentCount = 12,
  inkColor = '#0A0E14',
  tintColor = '#3B6EF5',
  onAccentHit,
  staticDots,
  className,
  style,
}: DotMorphProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotsRef = useRef<ActiveDot[]>([]);
  const accentIdsRef = useRef<Set<number>>(new Set());
  const nextIdRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const rafStartRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);

  // Resolve target dots — explicit staticDots win, then preset,
  // then runtime sampling as fallback.
  const targetDots: DotPoint[] = useMemo(() => {
    if (typeof document === 'undefined' || !ready) return [];
    if (staticDots && staticDots.length > 0) return staticDots;
    const preset = lookupPreset(text);
    if (preset) return preset;
    return sampleTextDots({ text, font, width, height, step, threshold });
  }, [ready, text, font, width, height, step, threshold, staticDots]);

  // Ensure the exact canvas font is loaded before sampling. Otherwise a cold
  // production visit can sample fallback glyphs while local HMR appears correct.
  useEffect(() => {
    let cancelled = false;
    if (typeof document === 'undefined') return;
    const fonts = document.fonts;
    if (!fonts) {
      setReady(true);
      return;
    }
    Promise.all([
      fonts.load(font),
      fonts.ready,
    ]).then(() => {
      if (!cancelled) setReady(true);
    }).catch(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [font]);

  // when target changes, match against current cloud and migrate ids
  useEffect(() => {
    if (!ready) return;
    const current = dotsRef.current;

    if (current.length === 0) {
      // first render — assign ids fresh, choose accent indices
      const indices = shuffleIndices(targetDots.length);
      const accentSet = new Set(indices.slice(0, accentCount));
      accentIdsRef.current = new Set();
      const newDots: ActiveDot[] = targetDots.map((p, i) => {
        const id = nextIdRef.current;
        nextIdRef.current += 1;
        const isAccent = accentSet.has(i);
        if (isAccent) accentIdsRef.current.add(id);
        return {
          id,
          x: p.x,
          y: p.y,
          targetX: p.x,
          targetY: p.y,
          alpha: 0,
          targetAlpha: 1,
          color: isAccent ? tintColor : inkColor,
        };
      });
      dotsRef.current = newDots;
      // re-arm the rAF loop. The animation effect ran first (before
      // fonts were ready) and settled with no dots; we need to kick
      // it back into motion now that the first cloud has landed.
      rafStartRef.current?.();
      return;
    }

    // subsequent renders: match current dots to target dots
    const fromCloud: DotPoint[] = current.map((d) => ({ x: d.x, y: d.y }));
    const { pairs, extraFromIndices, extraToIndices } = matchDots(fromCloud, targetDots);

    const next: ActiveDot[] = [];
    const accentIds = accentIdsRef.current;

    // pairs: existing dot keeps id + color, moves toward new position
    for (const pair of pairs as Pair[]) {
      const src = current[pair.fromIndex];
      next.push({
        ...src,
        targetX: pair.to.x,
        targetY: pair.to.y,
        targetAlpha: 1,
      });
    }

    // extras in `from` that have no target → fade to zero, keep position
    for (const i of extraFromIndices) {
      const src = current[i];
      next.push({
        ...src,
        targetAlpha: 0,
      });
    }

    // extras in target with no source → spawn new dots
    for (const j of extraToIndices) {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      // chance to be accent if we have fewer accents than target
      const shouldAccent = accentIds.size < accentCount && Math.random() < 0.15;
      if (shouldAccent) accentIds.add(id);
      next.push({
        id,
        x: targetDots[j].x,
        y: targetDots[j].y,
        targetX: targetDots[j].x,
        targetY: targetDots[j].y,
        alpha: 0,
        targetAlpha: 1,
        color: shouldAccent ? tintColor : inkColor,
      });
    }

    dotsRef.current = next;
    rafStartRef.current?.();
  }, [targetDots, ready, accentCount, inkColor, tintColor]);

  // animation loop — spring toward targets
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const velocity = new Map<number, { vx: number; vy: number }>();

    // settle thresholds — below these, the dot is "at rest" and the
    // loop can stop until something kicks it (target change / restart).
    const POS_EPS = 0.05;
    const VEL_EPS = 0.02;
    const ALPHA_EPS = 0.005;

    const tick = (): void => {
      ctx.clearRect(0, 0, width, height);
      const dots = dotsRef.current;
      const stillToRemove: number[] = [];
      let moving = false;

      for (let i = 0; i < dots.length; i += 1) {
        const d = dots[i];
        let v = velocity.get(d.id);
        if (!v) {
          v = { vx: 0, vy: 0 };
          velocity.set(d.id, v);
        }
        const fx = (d.targetX - d.x) * SPRING_STIFFNESS;
        const fy = (d.targetY - d.y) * SPRING_STIFFNESS;
        v.vx = (v.vx + fx) * SPRING_DAMPING;
        v.vy = (v.vy + fy) * SPRING_DAMPING;
        d.x += v.vx;
        d.y += v.vy;

        // alpha lerp
        d.alpha += (d.targetAlpha - d.alpha) * 0.12;
        if (d.targetAlpha === 0 && d.alpha < 0.02) {
          stillToRemove.push(i);
          moving = true;
          continue;
        }

        if (
          Math.abs(d.targetX - d.x) > POS_EPS ||
          Math.abs(d.targetY - d.y) > POS_EPS ||
          Math.abs(v.vx) > VEL_EPS ||
          Math.abs(v.vy) > VEL_EPS ||
          Math.abs(d.targetAlpha - d.alpha) > ALPHA_EPS
        ) {
          moving = true;
        }

        ctx.globalAlpha = d.alpha;
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(d.x, d.y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // prune fully-faded extras (in reverse so indices stay valid)
      for (let k = stillToRemove.length - 1; k >= 0; k -= 1) {
        const idx = stillToRemove[k];
        const removed = dots[idx];
        velocity.delete(removed.id);
        accentIdsRef.current.delete(removed.id);
        dots.splice(idx, 1);
      }

      if (moving) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    const start = (): void => {
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    start();
    // expose start so the target-change effect can re-arm us
    rafStartRef.current = start;

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      rafStartRef.current = null;
    };
  }, [width, height, dotRadius]);

  /*
   * Accent-dot interactions — easter-egg layer.
   *  - hover  : pointer cursor when the mouse sits over a visible
   *             accent dot, default cursor otherwise.
   *  - click  : the hit dot demotes from accent to ink (visible
   *             "spent" feedback) and onAccentHit fires; the rAF
   *             loop is re-armed in case the cloud had settled.
   * Hit radius is 3× the rendered dot radius (min 12 px) so taps
   * are forgiving on touch devices without making the cursor flicker
   * across half the cloud.
   */
  const localFromEvent = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height,
    };
  };

  const findAccentNear = (lx: number, ly: number): ActiveDot | null => {
    const accentIds = accentIdsRef.current;
    const hitR = Math.max(dotRadius * 3, 12);
    const hitR2 = hitR * hitR;
    let best: { dot: ActiveDot; d2: number } | null = null;
    for (const dot of dotsRef.current) {
      if (!accentIds.has(dot.id)) continue;
      if (dot.alpha < 0.5) continue;
      const dx = dot.x - lx;
      const dy = dot.y - ly;
      const d2 = dx * dx + dy * dy;
      if (d2 < hitR2 && (!best || d2 < best.d2)) {
        best = { dot, d2 };
      }
    }
    return best ? best.dot : null;
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!onAccentHit) return;
    const local = localFromEvent(e);
    if (!local) return;
    const hit = findAccentNear(local.x, local.y);
    if (!hit) return;
    // demote accent → ink so the user sees their click registered
    hit.color = inkColor;
    accentIdsRef.current.delete(hit.id);
    rafStartRef.current?.();
    onAccentHit();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!onAccentHit) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const local = localFromEvent(e);
    if (!local) return;
    const over = findAccentNear(local.x, local.y);
    canvas.style.cursor = over ? 'pointer' : '';
  };

  return (
    <canvas
      ref={canvasRef}
      className={`${styles.canvas} ${className ?? ''}`.trim()}
      style={style}
      aria-label={text}
      role="img"
      onClick={onAccentHit ? handleClick : undefined}
      onMouseMove={onAccentHit ? handleMouseMove : undefined}
    />
  );
}

function shuffleIndices(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
