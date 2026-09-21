import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { GradingPanel } from './GradingPanel';
import { DictionaryPanel } from './DictionaryPanel';
import { DictionaryDock } from './DictionaryDock';
import { lookupJotoba } from './dictionary';
import type {
  AnnotationGradingFeedback,
  AnnotationKind,
  GradingCardProposalDecision,
  GradingJudgement,
  LearningCard,
  NewLearningCard,
  StudyArticle,
  StudyResponse,
  TextAnnotation,
} from './model';

const CHECK_KIND: AnnotationKind = 'unknown';

interface ViewportRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

interface SelectionRange {
  start: number;
  end: number;
  quote: string;
  anchorRect: ViewportRect;
}

type AnnotationActionTarget =
  | { type: 'selection'; selection: SelectionRange }
  | {
      type: 'annotation';
      annotationId: string;
      quote: string;
      anchorRect: ViewportRect;
    };

interface ActionPopoverPosition {
  left: number;
  top: number;
  placement: 'above' | 'below';
}

export interface AnnotationGradingInput {
  userReading: string;
  userMeaning: string;
}

export interface ArticleWorkbenchProps {
  article: StudyArticle;
  articleOptions: StudyArticle[];
  responses: StudyResponse[];
  cards: LearningCard[];
  isDemo: boolean;
  cardPipelineManaged?: boolean;
  onSelectArticle: (articleId: string) => void;
  onUpdateArticle: (article: StudyArticle) => void;
  onUpdateResponse: (response: StudyResponse, saveImmediately?: boolean) => void;
  onCreateCard: (card: NewLearningCard) => 'added' | 'linked' | 'exists' | 'blocked';
  gradingInputsLocked?: boolean;
  onRequestGrading?: (articleId: string) => void | Promise<void>;
  onRetryGrading?: (articleId: string) => void | Promise<void>;
  onRefreshGrading?: () => void | Promise<void>;
  onUpdateAnnotationGrading?: (
    articleId: string,
    annotationId: string,
    input: AnnotationGradingInput,
  ) => void;
  onUpdateCardProposalDecision?: (
    articleId: string,
    proposalId: string,
    decision: Extract<GradingCardProposalDecision, 'accepted' | 'rejected'>,
  ) => void | Promise<void>;
  onConfirmGradingCards?: (
    articleId: string,
    acceptedProposalIds: string[],
  ) => void | Promise<void>;
}

const gradingStatusCopy = {
  draft: '작성 중',
  submitted: '채점 요청됨',
  graded: '채점 완료',
  cards_confirmed: '정리 완료',
  failed: '채점 실패',
} as const;

const judgementCopy: Record<GradingJudgement, string> = {
  correct: '맞음',
  partial: '부분',
  incorrect: '오답',
  ungraded: '확인 안 됨',
};

function annotationGradingDraft(
  annotation: TextAnnotation,
): AnnotationGradingFeedback {
  return {
    userReading: '',
    userMeaning: '',
    correctReading: '',
    correctMeaning: '',
    judgement: 'ungraded',
    simpleMistake: false,
    reviewUnit: annotation.quote.trim(),
  };
}

function ResponseGradingResult({ response }: { response: StudyResponse }): ReactElement | null {
  const grading = response.grading;
  if (!grading) return null;

  const rows = [
    ['맞은 부분', grading.correctPoints],
    ['놓친 근거', grading.missingEvidence],
    ['오류 유형', grading.errorType],
    ['교정 답안', grading.correctedAnswer],
  ].filter(([, value]) => value.trim());

  return (
    <section
      className="studyResponseGrading"
      aria-label={`Q${response.ordinal} 채점 결과`}
    >
      <header>
        <span>채점 결과</span>
        <strong className={`studyJudgement studyJudgement-${grading.judgement}`}>
          {judgementCopy[grading.judgement]}
        </strong>
      </header>
      {rows.length ? (
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="studyFeedbackEmpty">기록된 피드백이 없습니다.</p>
      )}
      {grading.issues.length ? (
        <details className="studyResponseIssues">
          <summary>오독 정정 {grading.issues.length}개</summary>
          <ol>
            {grading.issues.map((issue, index) => (
              <li key={`${issue.quote}-${index}`}>
                <strong lang="ja">{issue.quote}</strong>
                <p>{issue.correction}</p>
                <small>{issue.type}{issue.simpleMistake ? ' · 단순 실수' : ''}</small>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

function renderAnnotatedText(
  bodyText: string,
  annotations: TextAnnotation[],
  onActivate: (annotation: TextAnnotation, element: HTMLElement) => void,
): ReactElement[] {
  const valid = annotations
    .filter(
      (item) =>
        item.start >= 0 &&
        item.end > item.start &&
        item.end <= bodyText.length &&
        bodyText.slice(item.start, item.end) === item.quote,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const nodes: ReactElement[] = [];
  let cursor = 0;

  valid.forEach((annotation) => {
    if (annotation.start < cursor) return;
    if (annotation.start > cursor) {
      nodes.push(
        <span key={`plain-${cursor}`}>{bodyText.slice(cursor, annotation.start)}</span>,
      );
    }
    nodes.push(
      <span
        key={annotation.id}
        className="studyAnnotationMark"
        data-annotation={annotation.id}
        title="체크한 표현"
        role="button"
        tabIndex={0}
        aria-label={`${annotation.quote} 체크 메뉴 열기`}
        onClick={(event) => {
          const activeSelection = window.getSelection();
          if (activeSelection && !activeSelection.isCollapsed) return;
          onActivate(annotation, event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onActivate(annotation, event.currentTarget);
        }}
      >
        {bodyText.slice(annotation.start, annotation.end)}
      </span>,
    );
    cursor = annotation.end;
  });

  if (cursor < bodyText.length) {
    nodes.push(<span key={`plain-${cursor}`}>{bodyText.slice(cursor)}</span>);
  }
  return nodes;
}

function captureSelection(root: HTMLElement): SelectionRange | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const quote = range.toString();
  const end = start + quote.length;
  if (!quote.trim()) return null;
  return { start, end, quote, anchorRect: snapshotRect(range.getBoundingClientRect()) };
}

function snapshotRect(rect: DOMRect | ClientRect): ViewportRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function positionActionPopover(rect: ViewportRect): ActionPopoverPosition {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const horizontalEdge = Math.min(78, Math.max(48, viewportWidth / 2));
  const center = rect.left + rect.width / 2;
  const left = Math.min(
    viewportLeft + viewportWidth - horizontalEdge,
    Math.max(viewportLeft + horizontalEdge, center),
  );
  const roomBelow = viewportTop + viewportHeight - rect.bottom;
  const roomAbove = rect.top - viewportTop;
  const placement = roomBelow < 68 && roomAbove > roomBelow ? 'above' : 'below';
  return {
    left,
    top: placement === 'above' ? rect.top - 6 : rect.bottom + 6,
    placement,
  };
}

function sentenceAt(bodyText: string, start: number, end: number): string {
  const left = Math.max(
    bodyText.lastIndexOf('。', start - 1),
    bodyText.lastIndexOf('\n', start - 1),
  );
  const period = bodyText.indexOf('。', end);
  const newline = bodyText.indexOf('\n', end);
  const candidates = [period, newline].filter((value) => value >= 0);
  const right = candidates.length ? Math.min(...candidates) + 1 : bodyText.length;
  return bodyText.slice(left + 1, right).trim();
}

export function ArticleWorkbench({
  article,
  articleOptions,
  responses,
  cards,
  isDemo,
  cardPipelineManaged = false,
  onSelectArticle,
  onUpdateArticle,
  onUpdateResponse,
  onCreateCard,
  gradingInputsLocked,
  onRequestGrading,
  onRetryGrading,
  onRefreshGrading,
  onUpdateAnnotationGrading,
  onUpdateCardProposalDecision,
  onConfirmGradingCards,
}: ArticleWorkbenchProps): ReactElement {
  const articleRef = useRef<HTMLDivElement>(null);
  const dictionaryRef = useRef<HTMLDivElement>(null);
  const actionPopoverRef = useRef<HTMLDivElement>(null);
  const dictionaryReturnFocusRef = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [actionTarget, setActionTarget] = useState<AnnotationActionTarget | null>(null);
  const [actionPosition, setActionPosition] = useState<ActionPopoverPosition | null>(null);
  const [dictionaryQuery, setDictionaryQuery] = useState('');
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [cardNotice, setCardNotice] = useState('');
  const gradingStatus = article.grading?.status ?? 'draft';
  const inputsLocked = gradingInputsLocked ?? gradingStatus !== 'draft';

  const articleResponses = useMemo(
    () =>
      responses
        .filter((response) => response.articleId === article.id)
        .sort((a, b) => a.ordinal - b.ordinal),
    [article.id, responses],
  );

  const sortedAnnotations = useMemo(
    () => [...article.annotations].sort((a, b) => a.start - b.start),
    [article.annotations],
  );

  const showSelectionActions = (): void => {
    if (!articleRef.current) return;
    const nextSelection = captureSelection(articleRef.current);
    if (!nextSelection) return;
    setSelection(nextSelection);
    setActionTarget({ type: 'selection', selection: nextSelection });
    setActionPosition(positionActionPopover(nextSelection.anchorRect));
  };

  const showAnnotationActions = (
    annotation: TextAnnotation,
    element: HTMLElement,
  ): void => {
    const anchorRect = snapshotRect(element.getBoundingClientRect());
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setActionTarget({
      type: 'annotation',
      annotationId: annotation.id,
      quote: annotation.quote,
      anchorRect,
    });
    setActionPosition(positionActionPopover(anchorRect));
  };

  useEffect(() => {
    let frame: number | null = null;
    const handleSelectionChange = (): void => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (!articleRef.current) return;
        const nextSelection = captureSelection(articleRef.current);
        if (!nextSelection) return;
        setSelection(nextSelection);
        setActionTarget({ type: 'selection', selection: nextSelection });
        setActionPosition(positionActionPopover(nextSelection.anchorRect));
      });
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!actionTarget) return undefined;
    let frame: number | null = null;
    const updatePosition = (): void => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        let rect: ViewportRect;
        if (actionTarget.type === 'selection') {
          const activeSelection = window.getSelection();
          if (activeSelection && !activeSelection.isCollapsed && activeSelection.rangeCount) {
            rect = snapshotRect(activeSelection.getRangeAt(0).getBoundingClientRect());
          } else {
            rect = actionTarget.selection.anchorRect;
          }
        } else {
          const element = articleRef.current?.querySelector<HTMLElement>(
            `[data-annotation="${CSS.escape(actionTarget.annotationId)}"]`,
          );
          rect = element
            ? snapshotRect(element.getBoundingClientRect())
            : actionTarget.anchorRect;
        }
        const viewportTop = window.visualViewport?.offsetTop ?? 0;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        if (rect.bottom < viewportTop || rect.top > viewportTop + viewportHeight) {
          setActionTarget(null);
          setActionPosition(null);
          return;
        }
        setActionPosition(positionActionPopover(rect));
      });
    };
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || actionPopoverRef.current?.contains(target)) return;
      setActionTarget(null);
      setActionPosition(null);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setActionTarget(null);
      setActionPosition(null);
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [actionTarget]);

  const applyAnnotation = (): void => {
    if (inputsLocked || !selection) return;
    const retained = article.annotations.filter(
      (item) => item.end <= selection.start || item.start >= selection.end,
    );
    const nextAnnotations = [
      ...retained,
      {
        id: crypto.randomUUID(),
        start: selection.start,
        end: selection.end,
        quote: selection.quote,
        kind: CHECK_KIND,
        note: '',
      },
    ];

    onUpdateArticle({
      ...article,
      annotations: nextAnnotations,
    });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setActionTarget(null);
    setActionPosition(null);
  };

  const removeAnnotation = (annotationId: string): void => {
    if (inputsLocked) return;
    onUpdateArticle({
      ...article,
      annotations: article.annotations.filter((annotation) => annotation.id !== annotationId),
    });
    setActionTarget(null);
    setActionPosition(null);
  };

  const closeDictionary = (): void => {
    setDictionaryOpen(false);
    window.requestAnimationFrame(() => {
      const returnTarget = dictionaryReturnFocusRef.current;
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    });
  };

  const openDictionary = (): void => {
    if (!actionTarget) return;
    const query = actionTarget.type === 'selection'
      ? actionTarget.selection.quote
      : actionTarget.quote;
    dictionaryReturnFocusRef.current = actionTarget.type === 'annotation'
      ? articleRef.current?.querySelector<HTMLElement>(
          `[data-annotation="${CSS.escape(actionTarget.annotationId)}"]`,
        ) ?? null
      : null;
    setDictionaryQuery(query.trim());
    setDictionaryOpen(true);
    setActionTarget(null);
    setActionPosition(null);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    window.requestAnimationFrame(() => {
      dictionaryRef.current?.querySelector('input')?.focus({ preventScroll: true });
    });
  };

  const replaceBody = (): void => {
    const normalized = importText.replace(/\r\n/g, '\n').trim();
    if (inputsLocked || !normalized) return;
    onUpdateArticle({
      ...article,
      bodyText: normalized,
      annotations: [],
      bodyRevision: article.bodyRevision + 1,
    });
    setImportText('');
    setActionTarget(null);
    setActionPosition(null);
    setSelection(null);
    setDictionaryQuery('');
    setDictionaryOpen(false);
  };

  const submitCard = (
    event: FormEvent<HTMLFormElement>,
    annotation: TextAnnotation,
  ): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const kind = data.get('kind') === 'kanji' ? 'kanji' : 'word';
    const front = annotation.quote.trim();
    const result = onCreateCard({
      kind,
      front,
      reading: String(data.get('reading') ?? '').trim(),
      meaningKo: String(data.get('meaning') ?? '').trim(),
      exampleJa: sentenceAt(article.bodyText, annotation.start, annotation.end),
      sourceArticleId: article.id,
      sourceLabel: `Day ${article.dayNo}`,
      initialKind: annotation.kind,
    });
    setCardNotice(
      result === 'added'
        ? `${front} 카드를 추가했습니다.`
        : result === 'linked'
          ? `${front} 카드에 이 기사를 연결했습니다.`
          : result === 'blocked'
            ? '한자 카드는 채점 후 사전 기반 생성기로 등록합니다.'
            : `${front} 카드는 이미 있습니다.`,
    );
    if (result === 'added' || result === 'linked') event.currentTarget.reset();
  };

  const updateAnnotationGradingInput = (
    annotationId: string,
    input: AnnotationGradingInput,
  ): void => {
    if (onUpdateAnnotationGrading) {
      onUpdateAnnotationGrading(article.id, annotationId, input);
      return;
    }
    onUpdateArticle({
      ...article,
      annotations: article.annotations.map((annotation) =>
        annotation.id === annotationId
          ? {
              ...annotation,
              grading: {
                ...(annotation.grading ?? annotationGradingDraft(annotation)),
                ...input,
              },
            }
          : annotation,
      ),
    });
  };

  const updateProposalDecision = async (
    proposalId: string,
    decision: Extract<GradingCardProposalDecision, 'accepted' | 'rejected'>,
  ): Promise<void> => {
    if (!article.grading || article.grading.status !== 'graded') return;
    await onUpdateCardProposalDecision?.(article.id, proposalId, decision);
  };

  const confirmGradingCards = async (): Promise<void> => {
    const grading = article.grading;
    if (!grading || grading.status !== 'graded') return;
    const acceptedProposalIds = grading.cardProposals
      .filter((proposal) => proposal.decision === 'accepted')
      .map((proposal) => proposal.id);
    if (!onConfirmGradingCards) return;
    await onConfirmGradingCards(article.id, acceptedProposalIds);
  };

  const requestArticleGrading = async (): Promise<void> => {
    if (!onRequestGrading) return;
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setActionTarget(null);
    setActionPosition(null);
    await onRequestGrading(article.id);
  };

  const actionPopover = actionTarget && actionPosition && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={actionPopoverRef}
          className="studySelectionPopover"
          role="toolbar"
          aria-label="선택한 표현 작업"
          data-placement={actionPosition.placement}
          style={{ left: actionPosition.left, top: actionPosition.top }}
        >
          {actionTarget.type === 'selection' && !inputsLocked ? (
            <button type="button" className="studyCheckAction" onClick={applyAnnotation}>
              <span aria-hidden="true">✓</span>
              체크
            </button>
          ) : null}
          <button type="button" onClick={openDictionary}>사전</button>
          {actionTarget.type === 'annotation' && !inputsLocked ? (
            <button
              type="button"
              className="studyDeleteAction"
              onClick={() => removeAnnotation(actionTarget.annotationId)}
            >
              삭제
            </button>
          ) : null}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="studyPage studyArticlePage">
      {actionPopover}
      <header className="studyPageLead">
        <div>
          <p className="studyKicker">DAY {String(article.dayNo).padStart(2, '0')} · ARTICLE</p>
          <h1>{article.title}</h1>
        </div>
        <dl className="studyArticleMeta">
          <div>
            <dt>학습일</dt>
            <dd>
              <select
                aria-label="학습할 Day 선택"
                value={article.id}
                onChange={(event) => {
                  setSelection(null);
                  setActionTarget(null);
                  setActionPosition(null);
                  setDictionaryQuery('');
                  setDictionaryOpen(false);
                  onSelectArticle(event.target.value);
                }}
              >
                {articleOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    Day {option.dayNo}
                  </option>
                ))}
              </select>
            </dd>
          </div>
          <div>
            <dt>출처</dt>
            <dd>{article.publisher}</dd>
          </div>
          <div>
            <dt>게시일</dt>
            <dd>{article.publishedAt}</dd>
          </div>
          <div>
            <dt>카드</dt>
            <dd>{cards.filter((card) => card.sourceArticleId === article.id).length}개</dd>
          </div>
          <div>
            <dt>채점</dt>
            <dd className={`studyMetaGrading studyMetaGrading-${gradingStatus}`}>
              {gradingStatusCopy[gradingStatus]}
            </dd>
          </div>
        </dl>
      </header>

      {isDemo ? (
        <p className="studyDemoNotice" role="status">
          현재는 개발용 미리보기입니다. 실제 기사와 답안은 공개 코드에 포함하지 않습니다.
        </p>
      ) : null}

      <div className="studyWorkbench">
        <section className="studyReadingColumn" aria-labelledby="article-heading">
          <div className="studySectionHeading">
            <span>01</span>
            <div>
              <h2 id="article-heading">기사 읽기</h2>
              <p>막힌 표현을 드래그하면 체크와 사전 메뉴가 열립니다.</p>
            </div>
            {article.sourceUrl ? (
              <a href={article.sourceUrl} target="_blank" rel="noreferrer">
                원문 열기 ↗
              </a>
            ) : null}
          </div>

          <div
            ref={articleRef}
            className={`studyArticleText ${inputsLocked ? 'studyArticleTextLocked' : ''}`}
            lang="ja"
            onMouseUp={showSelectionActions}
            onPointerUp={showSelectionActions}
            onKeyUp={showSelectionActions}
          >
            {renderAnnotatedText(
              article.bodyText,
              article.annotations,
              showAnnotationActions,
            )}
          </div>

          <DictionaryDock
            open={dictionaryOpen}
            onClose={closeDictionary}
            contentRef={dictionaryRef}
          >
            <DictionaryPanel
              key={article.id}
              workspace={{ cards, articles: articleOptions }}
              activeArticleId={article.id}
              query={dictionaryQuery}
              onQueryChange={setDictionaryQuery}
              lookup={lookupJotoba}
              floating
            />
          </DictionaryDock>

          <details className="studySourceEditor">
            <summary>본문 붙여넣기 또는 교체</summary>
            <label htmlFor="article-body-import">기사 본문</label>
            <textarea
              id="article-body-import"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder="일본어 기사 본문을 여기에 붙여 넣습니다."
              rows={8}
              disabled={inputsLocked}
            />
            <p>
              {inputsLocked
                ? '채점 요청 이후에는 본문을 교체할 수 없습니다.'
                : '본문을 교체하면 현재 체크는 초기화됩니다.'}
            </p>
            <button
              type="button"
              onClick={replaceBody}
              disabled={inputsLocked || !importText.trim()}
            >
              본문 교체
            </button>
          </details>

          <section className="studyQuestions" aria-labelledby="questions-heading">
            <div className="studySectionHeading">
              <span>02</span>
              <div>
                <h2 id="questions-heading">짧은 확인</h2>
                <p>한국어 작문이 아니라 기사에서 놓치기 쉬운 핵심만 확인합니다.</p>
              </div>
            </div>
            {articleResponses.map((response) => (
              <article className="studyQuestion" key={response.id}>
                <p className="studyQuestionPerspective">
                  Q{response.ordinal} · {response.perspective}
                </p>
                <label htmlFor={`response-${response.id}`}>{response.prompt}</label>
                <textarea
                  id={`response-${response.id}`}
                  value={response.answer}
                  onChange={(event) =>
                    onUpdateResponse({ ...response, answer: event.target.value })
                  }
                  onBlur={(event) =>
                    onUpdateResponse(
                      { ...response, answer: event.currentTarget.value },
                      true,
                    )
                  }
                  rows={2}
                  placeholder="한두 문장으로 짧게 답합니다."
                  disabled={inputsLocked}
                />
                <ResponseGradingResult response={response} />
                {!response.grading && (response.feedback || response.referenceAnswer) ? (
                  <details>
                    <summary>교정 보기</summary>
                    {response.feedback ? <p>{response.feedback}</p> : null}
                    {response.referenceAnswer ? (
                      <p className="studyReferenceAnswer">{response.referenceAnswer}</p>
                    ) : null}
                  </details>
                ) : null}
              </article>
            ))}
          </section>
        </section>

        <aside className="studyAnalysisColumn" aria-label="기사 채점과 체크 기록">
          <GradingPanel
            dayNo={article.dayNo}
            grading={article.grading}
            responses={articleResponses}
            annotations={sortedAnnotations}
            inputsLocked={inputsLocked}
            cardPipelineManaged={cardPipelineManaged}
            onRequestGrading={onRequestGrading ? requestArticleGrading : undefined}
            onRetryGrading={
              onRetryGrading ? () => onRetryGrading(article.id) : undefined
            }
            onRefreshGrading={onRefreshGrading}
            onProposalDecision={
              !cardPipelineManaged && onUpdateCardProposalDecision
                ? updateProposalDecision
                : undefined
            }
            onConfirmCards={
              !cardPipelineManaged && onConfirmGradingCards
                ? confirmGradingCards
                : undefined
            }
          />

          <section className="studyMarksSection" aria-labelledby="marks-heading">
            <div className="studySectionHeading studyAnalysisHeading">
              <span>04</span>
              <div>
                <h2 id="marks-heading">체크 기록</h2>
                <p>체크한 표현과 채점 결과를 나란히 남깁니다.</p>
              </div>
            </div>
            {cardNotice ? <p className="studyInlineNotice" role="status">{cardNotice}</p> : null}
            {sortedAnnotations.length ? (
              <ol className="studyAnnotationList">
                {sortedAnnotations.map((annotation, index) => {
                  const quote = annotation.quote.trim();
                  const annotationGrading = annotation.grading;
                  const judgement = annotationGrading?.judgement ?? 'ungraded';
                  const showGradingResult =
                    Boolean(annotationGrading)
                    && (gradingStatus === 'graded' || gradingStatus === 'cards_confirmed');
                  const relatedCards = cards.filter(
                    (card) =>
                      card.front === quote
                      || (quote.length > 1 && card.front.includes(quote)),
                  );
                  const hasExactCard = relatedCards.some((card) => card.front === quote);
                  const userReading = annotationGrading?.userReading ?? '';
                  const userMeaning = annotationGrading?.userMeaning ?? '';
                  return (
                    <li key={annotation.id}>
                      <div className="studyAnnotationHead">
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <strong lang="ja">{annotation.quote}</strong>
                        {showGradingResult ? (
                          <span className="studyAnnotationMeta">
                            <small className={`studyJudgement studyJudgement-${judgement}`}>
                              {judgementCopy[judgement]}
                            </small>
                          </span>
                        ) : null}
                      </div>

                      <div className="studyAnnotationInputs">
                        <label htmlFor={`annotation-reading-${annotation.id}`}>
                          내 읽기
                          <input
                            id={`annotation-reading-${annotation.id}`}
                            lang="ja"
                            value={userReading}
                            placeholder="모르면 비워 둠"
                            autoComplete="off"
                            disabled={inputsLocked}
                            onChange={(event) =>
                              updateAnnotationGradingInput(annotation.id, {
                                userReading: event.target.value,
                                userMeaning,
                              })
                            }
                          />
                        </label>
                        <label htmlFor={`annotation-meaning-${annotation.id}`}>
                          내 뜻
                          <input
                            id={`annotation-meaning-${annotation.id}`}
                            value={userMeaning}
                            placeholder="모르면 비워 둠"
                            autoComplete="off"
                            disabled={inputsLocked}
                            onChange={(event) =>
                              updateAnnotationGradingInput(annotation.id, {
                                userReading,
                                userMeaning: event.target.value,
                              })
                            }
                          />
                        </label>
                      </div>

                      {showGradingResult && annotationGrading ? (
                        <section
                          className="studyAnnotationGrading"
                          aria-label={`${annotation.quote} 채점 결과`}
                        >
                          <dl>
                            <div>
                              <dt>정답 읽기</dt>
                              <dd lang="ja">{annotationGrading.correctReading || '기록 없음'}</dd>
                            </div>
                            <div>
                              <dt>정답 뜻</dt>
                              <dd>{annotationGrading.correctMeaning || '기록 없음'}</dd>
                            </div>
                            {annotationGrading.reviewUnit ? (
                              <div>
                                <dt>복습 단위</dt>
                                <dd lang="ja">{annotationGrading.reviewUnit}</dd>
                              </div>
                            ) : null}
                          </dl>
                          {annotationGrading.simpleMistake ? (
                            <p>단순 실수로 분류되었습니다.</p>
                          ) : null}
                        </section>
                      ) : null}

                      {relatedCards.length || gradingStatus === 'draft' ? (
                        <details>
                          <summary>
                            {hasExactCard
                              ? '카드 등록됨'
                              : relatedCards.length
                                ? '관련 카드 등록됨'
                                : '수동 카드 추가'}
                          </summary>
                          {relatedCards.length ? (
                            <ul className="studyRelatedCards">
                              {relatedCards.map((card) => (
                                <li key={card.id}>
                                  <span>{card.kind === 'kanji' ? '한자' : '단어'}</span>
                                  <strong lang="ja">{card.front}</strong>
                                  <small lang="ja">{card.reading}</small>
                                </li>
                              ))}
                            </ul>
                          ) : cardPipelineManaged ? (
                            <p className="studyManagedCardNote">
                              카드는 채점 후 사전 기반 생성기로 등록합니다.
                            </p>
                          ) : (
                            <form onSubmit={(event) => submitCard(event, annotation)}>
                              <label>
                                카드 종류
                                <select
                                  name="kind"
                                  defaultValue={annotation.quote.trim().length === 1 ? 'kanji' : 'word'}
                                >
                                  <option value="word">단어</option>
                                  <option value="kanji" disabled={annotation.quote.trim().length !== 1}>
                                    한자 1글자
                                  </option>
                                </select>
                              </label>
                              <label>
                                읽기
                                <input name="reading" autoComplete="off" required />
                              </label>
                              <label>
                                뜻
                                <input name="meaning" autoComplete="off" required />
                              </label>
                              <button type="submit">카드 추가</button>
                            </form>
                          )}
                        </details>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="studyEmptyState">
                <p>아직 체크한 표현이 없습니다.</p>
                <span>왼쪽 본문에서 막힌 표현을 드래그해 체크해보세요.</span>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
