import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

interface DockPosition {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

interface DictionaryDockProps {
  children: ReactNode;
  contentRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  onClose: () => void;
}

const POSITION_STORAGE_KEY = 'japanese-study:dictionary-position:v1:desktop';
const DESKTOP_BREAKPOINT = 900;
const VIEWPORT_GAP = 12;
const DOCK_WIDTH = 432;
const MIN_VISIBLE_HEIGHT = 180;

function isDesktopDock(): boolean {
  return window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT + 1}px)`).matches;
}

function readPosition(): DockPosition | null {
  try {
    const stored = window.localStorage.getItem(POSITION_STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return null;
    const { x, y } = parsed as Partial<DockPosition>;
    return typeof x === 'number' && Number.isFinite(x)
      && typeof y === 'number' && Number.isFinite(y)
      ? { x, y }
      : null;
  } catch {
    return null;
  }
}

function savePosition(position: DockPosition | null): void {
  try {
    if (position) {
      window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position));
    } else {
      window.localStorage.removeItem(POSITION_STORAGE_KEY);
    }
  } catch {
    // The dock still works when browser storage is unavailable.
  }
}

function clampPosition(
  position: DockPosition,
  dock: HTMLElement,
): DockPosition {
  const width = Math.min(dock.getBoundingClientRect().width || DOCK_WIDTH, window.innerWidth);
  const headerHeight = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--study-header-height'),
  ) || 64;
  return {
    x: Math.min(
      Math.max(position.x, VIEWPORT_GAP),
      Math.max(VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP),
    ),
    y: Math.min(
      Math.max(position.y, headerHeight + VIEWPORT_GAP),
      Math.max(headerHeight + VIEWPORT_GAP, window.innerHeight - MIN_VISIBLE_HEIGHT),
    ),
  };
}

export function DictionaryDock({
  children,
  contentRef,
  open,
  onClose,
}: DictionaryDockProps): ReactElement | null {
  const dockRef = useRef<HTMLElement>(null);
  const dragState = useRef<DragState | null>(null);
  const animationFrame = useRef<number | null>(null);
  const queuedPosition = useRef<DockPosition | null>(null);
  const [position, setPosition] = useState<DockPosition | null>(() => readPosition());
  const positionRef = useRef<DockPosition | null>(position);

  const commitPosition = (nextPosition: DockPosition): void => {
    positionRef.current = nextPosition;
    setPosition(nextPosition);
  };

  const queuePosition = (nextPosition: DockPosition): void => {
    queuedPosition.current = nextPosition;
    if (animationFrame.current !== null) return;
    animationFrame.current = window.requestAnimationFrame(() => {
      animationFrame.current = null;
      if (queuedPosition.current) commitPosition(queuedPosition.current);
      queuedPosition.current = null;
    });
  };

  const resetPosition = (): void => {
    positionRef.current = null;
    setPosition(null);
    savePosition(null);
  };

  const finishDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    const dragging = dragState.current;
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (queuedPosition.current) {
      if (animationFrame.current !== null) {
        window.cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }
      commitPosition(queuedPosition.current);
      queuedPosition.current = null;
    }
    savePosition(positionRef.current);
  };

  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const keepDockVisible = (): void => {
      const dock = dockRef.current;
      const currentPosition = positionRef.current;
      if (!dock || !currentPosition || !isDesktopDock()) return;
      const nextPosition = clampPosition(currentPosition, dock);
      if (nextPosition.x !== currentPosition.x || nextPosition.y !== currentPosition.y) {
        commitPosition(nextPosition);
        savePosition(nextPosition);
      }
    };
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(keepDockVisible);
    if (dockRef.current) observer?.observe(dockRef.current);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', keepDockVisible);
    window.visualViewport?.addEventListener('resize', keepDockVisible);
    return () => {
      observer?.disconnect();
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', keepDockVisible);
      window.visualViewport?.removeEventListener('resize', keepDockVisible);
      if (animationFrame.current !== null) {
        window.cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const dockStyle = position
    ? ({
        '--study-dictionary-x': `${position.x}px`,
        '--study-dictionary-y': `${position.y}px`,
      } as CSSProperties)
    : undefined;

  return createPortal(
    <aside
      ref={dockRef}
      className="studyDictionaryDock"
      data-positioned={position ? 'true' : 'false'}
      style={dockStyle}
      aria-label="기사 사전"
    >
      <header className="studyDictionaryDockHeader">
        <button
          type="button"
          className="studyDictionaryDragHandle"
          aria-label="사전 창 이동. 방향키로도 옮길 수 있습니다."
          onPointerDown={(event) => {
            if (event.button !== 0 || !isDesktopDock() || !dockRef.current) return;
            const rect = dockRef.current.getBoundingClientRect();
            dragState.current = {
              pointerId: event.pointerId,
              offsetX: event.clientX - rect.left,
              offsetY: event.clientY - rect.top,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const dragging = dragState.current;
            const dock = dockRef.current;
            if (!dragging || dragging.pointerId !== event.pointerId || !dock) return;
            queuePosition(clampPosition({
              x: event.clientX - dragging.offsetX,
              y: event.clientY - dragging.offsetY,
            }, dock));
          }}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
            if (!isDesktopDock() || !dockRef.current) return;
            const movement = event.shiftKey ? 48 : 16;
            const directions: Partial<Record<string, DockPosition>> = {
              ArrowLeft: { x: -movement, y: 0 },
              ArrowRight: { x: movement, y: 0 },
              ArrowUp: { x: 0, y: -movement },
              ArrowDown: { x: 0, y: movement },
            };
            const direction = directions[event.key];
            if (!direction) return;
            event.preventDefault();
            const rect = dockRef.current.getBoundingClientRect();
            const nextPosition = clampPosition({
              x: rect.left + direction.x,
              y: rect.top + direction.y,
            }, dockRef.current);
            commitPosition(nextPosition);
            savePosition(nextPosition);
          }}
        >
          <span>QUICK DICTIONARY</span>
          <strong className="studyDictionaryDockDesktopCopy">끌어서 본문 옆에 놓기</strong>
          <strong className="studyDictionaryDockMobileCopy">화면 아래에서 바로 찾기</strong>
        </button>
        <div className="studyDictionaryDockActions">
          <button className="studyDictionaryReset" type="button" onClick={resetPosition}>원위치</button>
          <button type="button" onClick={onClose} aria-label="사전 닫기">닫기</button>
        </div>
      </header>
      <div className="studyDictionaryDockBody" ref={contentRef}>
        {children}
      </div>
    </aside>,
    document.body,
  );
}
