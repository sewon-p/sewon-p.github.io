import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { GradingPanel } from './GradingPanel';
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

const annotationMeta: Record<
  AnnotationKind,
  { short: string; label: string; className: string }
> = {
  reading_unknown: {
    short: '파랑',
    label: '뜻은 알지만 읽기 불확실',
    className: 'studyMarkBlue',
  },
  context_guess: {
    short: '주황',
    label: '문맥으로 뜻 추측',
    className: 'studyMarkOrange',
  },
  unknown: {
    short: '노랑',
    label: '읽기와 뜻 모두 모름',
    className: 'studyMarkOchre',
  },
  misread: {
    short: '오독',
    label: '답안에서 실제로 잘못 읽음',
    className: 'studyMarkRed',
  },
};

interface SelectionRange {
  start: number;
  end: number;
  quote: string;
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
  onSelectArticle: (articleId: string) => void;
  onUpdateArticle: (article: StudyArticle) => void;
  onUpdateResponse: (response: StudyResponse, saveImmediately?: boolean) => void;
  onCreateCard: (card: NewLearningCard) => 'added' | 'linked' | 'exists';
  gradingInputsLocked?: boolean;
  onRequestGrading?: (articleId: string) => void | Promise<void>;
  onRetryGrading?: (articleId: string) => void | Promise<void>;
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
        className={annotationMeta[annotation.kind].className}
        data-annotation={annotation.id}
        title={annotationMeta[annotation.kind].label}
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
  return { start, end, quote };
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
  onSelectArticle,
  onUpdateArticle,
  onUpdateResponse,
  onCreateCard,
  gradingInputsLocked,
  onRequestGrading,
  onRetryGrading,
  onUpdateAnnotationGrading,
  onUpdateCardProposalDecision,
  onConfirmGradingCards,
}: ArticleWorkbenchProps): ReactElement {
  const articleRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
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

  const updateSelection = (): void => {
    if (inputsLocked) return;
    if (!articleRef.current) return;
    setSelection(captureSelection(articleRef.current));
  };

  const applyAnnotation = (kind: AnnotationKind | null): void => {
    if (inputsLocked || !selection) return;
    const retained = article.annotations.filter(
      (item) => item.end <= selection.start || item.start >= selection.end,
    );
    const nextAnnotations = kind
      ? [
          ...retained,
          {
            id: crypto.randomUUID(),
            start: selection.start,
            end: selection.end,
            quote: selection.quote,
            kind,
            note: '',
          },
        ]
      : retained;

    onUpdateArticle({
      ...article,
      annotations: nextAnnotations,
    });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
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
          : `${front} 카드는 이미 있습니다.`,
    );
    if (result !== 'exists') event.currentTarget.reset();
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
    await onRequestGrading(article.id);
  };

  return (
    <div className="studyPage studyArticlePage">
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
                onChange={(event) => onSelectArticle(event.target.value)}
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
              <p>본문을 선택한 뒤 글자색으로 최초 상태를 남깁니다.</p>
            </div>
            {article.sourceUrl ? (
              <a href={article.sourceUrl} target="_blank" rel="noreferrer">
                원문 열기 ↗
              </a>
            ) : null}
          </div>

          <div className="studyLegend" aria-label="표시 색 범례">
            {(Object.keys(annotationMeta) as AnnotationKind[]).slice(0, 3).map((kind) => (
              <span key={kind} className={annotationMeta[kind].className}>
                {annotationMeta[kind].short} · {annotationMeta[kind].label}
              </span>
            ))}
          </div>

          <div className="studyMarkToolbar" aria-label="선택한 본문 표시">
            <p>
              {selection
                ? `선택: ${selection.quote.replace(/\s+/g, ' ').slice(0, 28)}`
                : '본문에서 단어나 한자를 드래그하세요.'}
            </p>
            <div>
              <button
                type="button"
                className="studyMarkBlue"
                disabled={inputsLocked || !selection}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => applyAnnotation('reading_unknown')}
              >
                파랑
              </button>
              <button
                type="button"
                className="studyMarkOrange"
                disabled={inputsLocked || !selection}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => applyAnnotation('context_guess')}
              >
                주황
              </button>
              <button
                type="button"
                className="studyMarkOchre"
                disabled={inputsLocked || !selection}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => applyAnnotation('unknown')}
              >
                노랑
              </button>
              <button
                type="button"
                disabled={inputsLocked || !selection}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => applyAnnotation(null)}
              >
                표시 지우기
              </button>
            </div>
          </div>

          <div
            ref={articleRef}
            className={`studyArticleText ${inputsLocked ? 'studyArticleTextLocked' : ''}`}
            lang="ja"
            aria-disabled={inputsLocked}
            onMouseUp={updateSelection}
            onKeyUp={updateSelection}
          >
            {renderAnnotatedText(article.bodyText, article.annotations)}
          </div>

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
                : '본문을 교체하면 현재 글자색 표시는 초기화됩니다.'}
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
                <h2 id="questions-heading">내용 이해</h2>
                <p>원문을 다시 보지 않고 핵심만 답합니다.</p>
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
                  rows={4}
                  placeholder="내 답을 적습니다."
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

        <aside className="studyAnalysisColumn" aria-label="기사 채점과 표시 기록">
          <GradingPanel
            grading={article.grading}
            responses={articleResponses}
            annotations={sortedAnnotations}
            inputsLocked={inputsLocked}
            onRequestGrading={onRequestGrading ? requestArticleGrading : undefined}
            onRetryGrading={
              onRetryGrading ? () => onRetryGrading(article.id) : undefined
            }
            onProposalDecision={
              onUpdateCardProposalDecision ? updateProposalDecision : undefined
            }
            onConfirmCards={
              onConfirmGradingCards ? confirmGradingCards : undefined
            }
          />

          <section className="studyMarksSection" aria-labelledby="marks-heading">
            <div className="studySectionHeading studyAnalysisHeading">
              <span>04</span>
              <div>
                <h2 id="marks-heading">표시 기록</h2>
                <p>최초 상태와 채점 결과를 나란히 남깁니다.</p>
              </div>
            </div>
            {cardNotice ? <p className="studyInlineNotice" role="status">{cardNotice}</p> : null}
            {sortedAnnotations.length ? (
              <ol className="studyAnnotationList">
                {sortedAnnotations.map((annotation, index) => {
                  const meta = annotationMeta[annotation.kind];
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
                        <strong lang="ja" className={meta.className}>
                          {annotation.quote}
                        </strong>
                        <span className="studyAnnotationMeta">
                          <small>{meta.short}</small>
                          {showGradingResult ? (
                            <small className={`studyJudgement studyJudgement-${judgement}`}>
                              {judgementCopy[judgement]}
                            </small>
                          ) : null}
                        </span>
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
                <p>아직 표시한 부분이 없습니다.</p>
                <span>왼쪽 본문에서 막힌 표현을 선택해 최초 상태를 남겨보세요.</span>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
