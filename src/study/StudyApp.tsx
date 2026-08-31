import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Grade } from 'ts-fsrs';
import { ArticleWorkbench } from './ArticleWorkbench';
import { CardLibrary } from './CardLibrary';
import { createDemoWorkspace } from './demo';
import type {
  GradingCardProposalDecision,
  LearningCard,
  NewLearningCard,
  StudyArticle,
  StudyGradingPacket,
  StudyResponse,
  StudyView,
  StudyWorkspace,
} from './model';
import { ReviewSession } from './ReviewSession';
import { createSerializableFsrsCard, reviewCard } from './scheduler';
import {
  confirmRemoteGradingCards,
  createRemoteCard,
  decideRemoteGradingCardProposal,
  getCurrentSession,
  hasSupabaseConfig,
  importRemoteWorkspace,
  linkRemoteCardSource,
  loadRemoteWorkspace,
  recordRemoteReview,
  requestRemoteGrading,
  saveRemoteAnnotationInput,
  saveRemoteArticle,
  saveRemoteResponse,
  signInWithStudyId,
  setRemoteCardSuspended,
  signOut,
  supabase,
} from './supabase';
import {
  downloadWorkspace,
  loadLocalWorkspace,
  readWorkspaceFile,
  saveLocalWorkspace,
} from './storage';

type SyncState = 'saved' | 'saving' | 'error';

const validViews: StudyView[] = ['article', 'review', 'library'];

function initialView(): StudyView {
  const hash = window.location.hash.replace('#', '') as StudyView;
  if (validViews.includes(hash)) return hash;
  return window.matchMedia('(max-width: 720px)').matches ? 'review' : 'article';
}

function navTo(view: StudyView): void {
  window.location.hash = view;
}

function statusCopy(state: SyncState, isDemo: boolean): string {
  if (state === 'error') return '저장 확인 필요';
  if (state === 'saving') return '저장 중';
  return isDemo ? '이 기기에 저장됨' : 'DB와 동기화됨';
}

function mergeLocalWorkspaces(
  current: StudyWorkspace,
  incoming: StudyWorkspace,
): StudyWorkspace {
  incoming.articles.forEach((article) => {
    const dayConflict = current.articles.find(
      (candidate) => candidate.dayNo === article.dayNo && candidate.id !== article.id,
    );
    if (dayConflict) {
      throw new Error(`Day ${article.dayNo}은 이미 등록되어 있습니다.`);
    }
  });

  const incomingArticleIds = new Set(incoming.articles.map((article) => article.id));
  const articleById = new Map(current.articles.map((article) => [article.id, article]));
  incoming.articles.forEach((article) => articleById.set(article.id, article));

  const sourceIds = (card: LearningCard): string[] => [
    ...(card.sourceArticleIds ?? []),
    ...(card.sourceArticleId ? [card.sourceArticleId] : []),
  ];
  const cardByKey = new Map(
    current.cards.map((card) => [
      `${card.kind}|${card.canonicalKey}`,
      { ...card, sourceArticleIds: [...new Set(sourceIds(card))] },
    ]),
  );
  incoming.cards.forEach((card) => {
    const key = `${card.kind}|${card.canonicalKey}`;
    const existing = cardByKey.get(key);
    if (existing) {
      cardByKey.set(key, {
        ...existing,
        sourceArticleIds: [...new Set([...sourceIds(existing), ...sourceIds(card)])],
      });
    } else {
      cardByKey.set(key, {
        ...card,
        sourceArticleIds: [...new Set(sourceIds(card))],
      });
    }
  });

  const reviewById = new Map(
    current.reviewEvents.map((event) => [event.id, event]),
  );
  incoming.reviewEvents.forEach((event) => reviewById.set(event.id, event));

  return {
    version: 1,
    articles: [...articleById.values()].sort((a, b) => a.dayNo - b.dayNo),
    responses: [
      ...current.responses.filter(
        (response) => !incomingArticleIds.has(response.articleId),
      ),
      ...incoming.responses,
    ],
    cards: [...cardByKey.values()],
    reviewEvents: [...reviewById.values()],
    updatedAt: new Date().toISOString(),
  };
}

function createLocalGradingPacket(
  article: StudyArticle,
  responses: StudyResponse[],
): StudyGradingPacket {
  const submissionId = crypto.randomUUID();
  const sessionId = article.sessionId ?? crypto.randomUUID();
  return {
    packet_version: 1,
    submission_id: submissionId,
    session_id: sessionId,
    article: {
      id: article.id,
      title: article.title,
      publisher: article.publisher,
      source_url: article.sourceUrl,
      published_at: article.publishedAt,
      body_text: article.bodyText,
      body_revision: article.bodyRevision,
    },
    responses: responses.map((response) => ({
      id: response.id,
      ordinal: response.ordinal,
      perspective: response.perspective,
      prompt: response.prompt,
      answer: response.answer,
    })),
    annotations: article.annotations.map((annotation) => ({
      id: annotation.id,
      kind: annotation.kind,
      start_offset: annotation.start,
      end_offset: annotation.end,
      quote: annotation.quote,
      note: annotation.note,
      user_reading: annotation.grading?.userReading ?? '',
      user_meaning: annotation.grading?.userMeaning ?? '',
    })),
  };
}

function LoginPage(): ReactElement {
  const [studyId, setStudyId] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setMessage('');
    try {
      await signInWithStudyId(studyId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '학습실에 들어가지 못했습니다.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="studyPage studySetupPage">
      <section className="studySetupCopy">
        <p className="studyKicker">PRIVATE · JAPANESE STUDY</p>
        <h1>신문은 컴퓨터에서, 복습은 손안에서.</h1>
        <p>
          같은 계정으로 로그인하면 기사에서 만든 단어와 한자 카드가 모바일에 바로 이어집니다.
        </p>
      </section>
      <section className="studySetupPanel" aria-labelledby="login-heading">
        <h2 id="login-heading">학습실 들어가기</h2>
        <p className="studyLoginIntro">메일이나 비밀번호 없이 등록한 아이디만 입력합니다.</p>
        <form className="studyLoginForm" onSubmit={submit}>
          <label htmlFor="study-id">아이디</label>
          <input
            id="study-id"
            type="text"
            value={studyId}
            onChange={(event) => setStudyId(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="아이디 입력"
            required
          />
          <button type="submit" disabled={pending}>
            {pending ? '불러오는 중' : '들어가기'}
          </button>
        </form>
        {message ? <p className="studyLoginMessage" role="status">{message}</p> : null}
      </section>
    </div>
  );
}

function ConfigurationPage(): ReactElement {
  return (
    <div className="studyPage studySetupPage">
      <section className="studySetupCopy">
        <p className="studyKicker">SETUP · SUPABASE</p>
        <h1>학습 화면은 준비됐고, 개인 DB 연결만 남았습니다.</h1>
        <p>
          공개 저장소에는 기사 전문과 개인 답안을 넣지 않습니다. DB 연결 전에는
          이 기기 전용으로 먼저 써보고, 연결 후에는 모바일과 동기화할 수 있습니다.
        </p>
      </section>
      <section className="studySetupPanel">
        <h2>연결 순서</h2>
        <ol>
          <li>Supabase 무료 프로젝트를 만듭니다.</li>
          <li>저장소의 migration SQL을 실행합니다.</li>
          <li>Authentication의 Users에서 내 로그인 계정을 먼저 만듭니다.</li>
          <li>GitHub Pages 빌드에 URL과 publishable key를 넣습니다.</li>
        </ol>
        <div className="studySetupActions">
          <a className="studyFileButton" href="/study/?local=1#article">
            이 기기에서 먼저 시작
          </a>
          <a className="studySecondaryButton" href="/study/?demo=1#article">
            개발용 화면 보기
          </a>
        </div>
      </section>
    </div>
  );
}

interface RemoteLoadErrorPageProps {
  onRetry: () => void;
}

function RemoteLoadErrorPage({ onRetry }: RemoteLoadErrorPageProps): ReactElement {
  return (
    <div className="studyPage studySetupPage">
      <section className="studySetupCopy">
        <p className="studyKicker">SYNC · PAUSED</p>
        <h1>학습 기록을 불러오지 못했습니다.</h1>
        <p>
          기기 안의 화면을 빈 기록으로 덮지 않았습니다. 연결을 확인한 뒤 다시 시도해 주세요.
        </p>
      </section>
      <section className="studySetupPanel">
        <h2>기록은 그대로 보존됩니다</h2>
        <p>일시적인 연결 문제라면 아래 버튼으로 이어서 불러올 수 있습니다.</p>
        <button type="button" className="studyFileButton" onClick={onRetry}>
          다시 불러오기
        </button>
      </section>
    </div>
  );
}

interface ImportPageProps {
  remote: boolean;
  onImport: (workspace: StudyWorkspace) => Promise<void>;
}

function ImportPage({ remote, onImport }: ImportPageProps): ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const selectFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPending(true);
    setError('');
    try {
      await onImport(await readWorkspaceFile(file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '학습 데이터를 가져오지 못했습니다.');
    } finally {
      setPending(false);
      event.target.value = '';
    }
  };

  return (
    <div className="studyPage studySetupPage">
      <section className="studySetupCopy">
        <p className="studyKicker">FIRST IMPORT · DAY 01</p>
        <h1>Codex와 고른 기사를 첫 학습 데이터로 가져옵니다.</h1>
        <p>
          기사 본문과 질문이 담긴 Day JSON을 넣으면 바로 읽기와 표시를 시작할 수 있습니다.
        </p>
      </section>
      <section className="studySetupPanel">
        <h2>{remote ? '개인 DB로 가져오기' : '이 기기로 가져오기'}</h2>
        <ol>
          <li>채팅에서 함께 만든 Day JSON 파일을 선택합니다.</li>
          <li>사이트에서 표시와 답안을 작성한 뒤 채점을 요청합니다.</li>
          <li>채점 뒤 승인한 단어와 한자만 FSRS 복습에 들어갑니다.</li>
        </ol>
        <label className="studyFileButton">
          {pending ? '가져오는 중' : '학습 데이터 선택'}
          <input type="file" accept="application/json,.json" onChange={selectFile} disabled={pending} />
        </label>
        {error ? <p className="studyError" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}

interface CompactImportButtonProps {
  onImport: (workspace: StudyWorkspace) => Promise<void>;
}

function CompactImportButton({ onImport }: CompactImportButtonProps): ReactElement {
  const [state, setState] = useState<'idle' | 'pending' | 'error'>('idle');

  const selectFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    setState('pending');
    try {
      await onImport(await readWorkspaceFile(file));
      setState('idle');
    } catch {
      setState('error');
    } finally {
      event.target.value = '';
    }
  };

  const label = state === 'pending' ? '가져오는 중' : state === 'error' ? '가져오기 실패' : 'Day 추가';
  return (
    <label className="studyUtilityButton studyCompactImport">
      {label}
      <input
        type="file"
        accept="application/json,.json"
        onChange={selectFile}
        disabled={state === 'pending'}
      />
    </label>
  );
}

export default function StudyApp(): ReactElement {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const privateLocalEnabled = !hasSupabaseConfig && query.get('local') === '1';
  const demoEnabled = query.get('demo') === '1'
    || (!hasSupabaseConfig && !privateLocalEnabled && import.meta.env.DEV);
  const remoteEnabled = hasSupabaseConfig && !demoEnabled;
  const fallback = useMemo(() => createDemoWorkspace(), []);
  const [view, setView] = useState<StudyView>(initialView);
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(remoteEnabled);
  const [workspaceOwner, setWorkspaceOwner] = useState<string | null>(null);
  const [remoteLoadError, setRemoteLoadError] = useState(false);
  const [remoteLoadAttempt, setRemoteLoadAttempt] = useState(0);
  const [workspace, setWorkspace] = useState<StudyWorkspace>(() => {
    const emptyWorkspace: StudyWorkspace = {
      version: 1,
      articles: [],
      responses: [],
      cards: [],
      reviewEvents: [],
      updatedAt: new Date().toISOString(),
    };
    if (privateLocalEnabled) return loadLocalWorkspace(emptyWorkspace, 'private');
    if (demoEnabled) return loadLocalWorkspace(fallback, 'demo');
    return emptyWorkspace;
  });
  const [syncState, setSyncState] = useState<SyncState>('saved');
  const responseTimers = useRef(new Map<string, number>());
  const articleTimers = useRef(new Map<string, number>());
  const annotationTimers = useRef(new Map<string, number>());
  const responseSaveChains = useRef(new Map<string, Promise<void>>());
  const articleSaveChains = useRef(new Map<string, Promise<void>>());
  const annotationSaveChains = useRef(new Map<string, Promise<void>>());
  const isDemo = demoEnabled;
  const localStorageSlot = privateLocalEnabled ? 'private' : isDemo ? 'demo' : null;

  useEffect(() => {
    const onHashChange = (): void => setView(initialView());
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) navTo(initialView());
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!remoteEnabled || !supabase) return;
    let mounted = true;
    getCurrentSession()
      .then((current) => {
        if (mounted) {
          setRemoteLoadError(false);
          setSession(current);
        }
      })
      .catch(() => setSyncState('error'))
      .finally(() => {
        if (mounted) setAuthLoading(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setRemoteLoadError(false);
      setSession(nextSession);
      setAuthLoading(false);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [remoteEnabled]);

  useEffect(() => {
    if (!remoteEnabled || !session) return;
    let active = true;
    loadRemoteWorkspace()
      .then((remoteWorkspace) => {
        if (!active) return;
        setWorkspace(remoteWorkspace);
        setWorkspaceOwner(session.user.id);
      })
      .catch(() => {
        if (!active) return;
        setSyncState('error');
        setRemoteLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [remoteEnabled, session, remoteLoadAttempt]);

  useEffect(() => {
    if (localStorageSlot) saveLocalWorkspace(workspace, localStorageSlot);
  }, [localStorageSlot, workspace]);

  useEffect(
    () => () => {
      responseTimers.current.forEach((timer) => window.clearTimeout(timer));
      articleTimers.current.forEach((timer) => window.clearTimeout(timer));
      annotationTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const saveArticleNow = (
    nextArticle: StudyArticle,
    userId: string,
  ): Promise<void> => {
    const prior = articleSaveChains.current.get(nextArticle.id) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(() => saveRemoteArticle(nextArticle, userId));
    articleSaveChains.current.set(nextArticle.id, next);
    return next;
  };

  const saveResponseNow = (response: StudyResponse): Promise<void> => {
    const prior = responseSaveChains.current.get(response.id) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(() => saveRemoteResponse(response));
    responseSaveChains.current.set(response.id, next);
    return next;
  };

  const saveAnnotationInputNow = (
    annotationId: string,
    userReading: string,
    userMeaning: string,
    userId: string,
  ): Promise<void> => {
    const prior = annotationSaveChains.current.get(annotationId) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(() => saveRemoteAnnotationInput(
        annotationId,
        userReading,
        userMeaning,
        userId,
      ));
    annotationSaveChains.current.set(annotationId, next);
    return next;
  };

  const updateArticle = (article: StudyArticle): void => {
    setWorkspace((current) => ({
      ...current,
      articles: current.articles.map((item) => (item.id === article.id ? article : item)),
      updatedAt: new Date().toISOString(),
    }));
    if (!session) return;
    setSyncState('saving');
    const existing = articleTimers.current.get(article.id);
    if (existing) window.clearTimeout(existing);
    articleTimers.current.set(
      article.id,
      window.setTimeout(() => {
        const next = saveArticleNow(article, session.user.id);
        next
          .then(() => {
            if (articleSaveChains.current.get(article.id) === next) setSyncState('saved');
          })
          .catch(() => {
            if (articleSaveChains.current.get(article.id) === next) setSyncState('error');
          });
      }, 650),
    );
  };

  const updateResponse = (response: StudyResponse, saveImmediately = false): void => {
    setWorkspace((current) => ({
      ...current,
      responses: current.responses.map((item) =>
        item.id === response.id ? response : item,
      ),
      updatedAt: new Date().toISOString(),
    }));
    if (!session) return;
    setSyncState('saving');
    const existing = responseTimers.current.get(response.id);
    if (existing) window.clearTimeout(existing);
    responseTimers.current.set(
      response.id,
      window.setTimeout(() => {
        const next = saveResponseNow(response);
        next
          .then(() => {
            if (responseSaveChains.current.get(response.id) === next) setSyncState('saved');
          })
          .catch(() => {
            if (responseSaveChains.current.get(response.id) === next) setSyncState('error');
          });
      }, saveImmediately ? 0 : 650),
    );
  };

  const createCard = (input: NewLearningCard): 'added' | 'linked' | 'exists' => {
    const canonicalKey = input.kind === 'kanji' ? input.front : `${input.front}|${input.reading}`;
    const existingCard = workspace.cards.find(
      (card) => card.kind === input.kind && card.canonicalKey === canonicalKey,
    );
    if (existingCard) {
      const existingSources = new Set([
        ...(existingCard.sourceArticleIds ?? []),
        ...(existingCard.sourceArticleId ? [existingCard.sourceArticleId] : []),
      ]);
      if (!input.sourceArticleId || existingSources.has(input.sourceArticleId)) {
        return 'exists';
      }
      setWorkspace((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.id === existingCard.id
            ? {
                ...card,
                sourceArticleIds: [
                  ...new Set([
                    ...(card.sourceArticleIds ?? []),
                    ...(card.sourceArticleId ? [card.sourceArticleId] : []),
                    input.sourceArticleId!,
                  ]),
                ],
              }
            : card,
        ),
        updatedAt: new Date().toISOString(),
      }));
      if (session) {
        setSyncState('saving');
        linkRemoteCardSource(
          existingCard.id,
          input.sourceArticleId,
          input.exampleJa,
          session.user.id,
        )
          .then(() => setSyncState('saved'))
          .catch(() => setSyncState('error'));
      }
      return 'linked';
    }
    if (!input.front.trim()) {
      return 'exists';
    }
    const card: LearningCard = {
      ...input,
      id: crypto.randomUUID(),
      canonicalKey,
      sourceArticleIds: input.sourceArticleId ? [input.sourceArticleId] : [],
      suspended: false,
      revision: 0,
      fsrs: createSerializableFsrsCard(),
    };
    setWorkspace((current) => ({
      ...current,
      cards: [...current.cards, card],
      updatedAt: new Date().toISOString(),
    }));
    if (session) {
      setSyncState('saving');
      createRemoteCard(card, session.user.id)
        .then(() => setSyncState('saved'))
        .catch(() => setSyncState('error'));
    }
    return 'added';
  };

  const updateAnnotationGrading = (
    articleId: string,
    annotationId: string,
    input: { userReading: string; userMeaning: string },
  ): void => {
    const targetArticle = workspace.articles.find((item) => item.id === articleId);
    const targetAnnotation = targetArticle?.annotations.find(
      (annotation) => annotation.id === annotationId,
    );
    if (!targetArticle || !targetAnnotation) return;
    const status = targetArticle.grading?.status ?? 'draft';
    if (status !== 'draft' && status !== 'failed') return;

    setWorkspace((current) => ({
      ...current,
      articles: current.articles.map((item) =>
        item.id === articleId
          ? {
              ...item,
              annotations: item.annotations.map((annotation) =>
                annotation.id === annotationId
                  ? {
                      ...annotation,
                      grading: {
                        userReading: input.userReading,
                        userMeaning: input.userMeaning,
                        correctReading: annotation.grading?.correctReading ?? '',
                        correctMeaning: annotation.grading?.correctMeaning ?? '',
                        judgement: annotation.grading?.judgement ?? 'ungraded',
                        simpleMistake: annotation.grading?.simpleMistake ?? false,
                        reviewUnit: annotation.grading?.reviewUnit || annotation.quote.trim(),
                      },
                    }
                  : annotation,
              ),
            }
          : item,
      ),
      updatedAt: new Date().toISOString(),
    }));

    if (!session) return;
    setSyncState('saving');
    const existing = annotationTimers.current.get(annotationId);
    if (existing) window.clearTimeout(existing);
    annotationTimers.current.set(
      annotationId,
      window.setTimeout(() => {
        const next = saveAnnotationInputNow(
          annotationId,
          input.userReading,
          input.userMeaning,
          session.user.id,
        );
        next
          .then(() => {
            if (annotationSaveChains.current.get(annotationId) === next) {
              setSyncState('saved');
            }
          })
          .catch(() => {
            if (annotationSaveChains.current.get(annotationId) === next) {
              setSyncState('error');
            }
          });
      }, 650),
    );
  };

  const reloadRemoteWorkspace = async (): Promise<void> => {
    if (!session) return;
    const remoteWorkspace = await loadRemoteWorkspace();
    setWorkspace(remoteWorkspace);
    setWorkspaceOwner(session.user.id);
  };

  const requestArticleGrading = async (articleId: string): Promise<void> => {
    const targetArticle = workspace.articles.find((item) => item.id === articleId);
    if (!targetArticle) throw new Error('채점할 기사를 찾지 못했습니다.');
    const targetResponses = workspace.responses.filter(
      (response) => response.articleId === articleId,
    );

    if (!session) {
      const packet = createLocalGradingPacket(targetArticle, targetResponses);
      setWorkspace((current) => ({
        ...current,
        articles: current.articles.map((item) =>
          item.id === articleId
            ? {
                ...item,
                sessionId: packet.session_id,
                grading: {
                  status: 'submitted',
                  submissionId: packet.submission_id,
                  submissionSnapshot: packet,
                  submittedAt: new Date().toISOString(),
                  completedAt: null,
                  diagnosis: null,
                  cardProposals: [],
                  packetVersion: packet.packet_version,
                  graderVersion: '',
                  failureMessage: null,
                },
              }
            : item,
        ),
        updatedAt: new Date().toISOString(),
      }));
      return;
    }

    if (!targetArticle.sessionId) {
      throw new Error('기사의 학습 세션을 찾지 못했습니다.');
    }

    setSyncState('saving');
    const articleTimer = articleTimers.current.get(articleId);
    if (articleTimer) window.clearTimeout(articleTimer);
    targetResponses.forEach((response) => {
      const timer = responseTimers.current.get(response.id);
      if (timer) window.clearTimeout(timer);
    });
    targetArticle.annotations.forEach((annotation) => {
      const timer = annotationTimers.current.get(annotation.id);
      if (timer) window.clearTimeout(timer);
    });

    try {
      await saveArticleNow(targetArticle, session.user.id);
      await Promise.all(targetResponses.map((response) => saveResponseNow(response)));
      await Promise.all(
        targetArticle.annotations.flatMap((annotation) =>
          annotation.grading
            ? [saveAnnotationInputNow(
                annotation.id,
                annotation.grading.userReading,
                annotation.grading.userMeaning,
                session.user.id,
              )]
            : []),
      );
      await requestRemoteGrading(targetArticle.sessionId, session.user.id);
      await reloadRemoteWorkspace();
      setSyncState('saved');
    } catch (error) {
      setSyncState('error');
      throw error;
    }
  };

  const updateCardProposalDecision = async (
    articleId: string,
    proposalId: string,
    decision: Extract<GradingCardProposalDecision, 'accepted' | 'rejected'>,
  ): Promise<void> => {
    const targetArticle = workspace.articles.find((item) => item.id === articleId);
    const proposal = targetArticle?.grading?.cardProposals.find(
      (item) => item.id === proposalId,
    );
    if (!targetArticle || !proposal || proposal.decision !== 'proposed') return;

    setWorkspace((current) => ({
      ...current,
      articles: current.articles.map((item) =>
        item.id === articleId && item.grading
          ? {
              ...item,
              grading: {
                ...item.grading,
                cardProposals: item.grading.cardProposals.map((candidate) =>
                  candidate.id === proposalId ? { ...candidate, decision } : candidate,
                ),
              },
            }
          : item,
      ),
      updatedAt: new Date().toISOString(),
    }));

    if (!session) {
      if (decision === 'accepted') {
        createCard({
          kind: proposal.kind,
          front: proposal.front,
          reading: proposal.reading,
          meaningKo: proposal.meaningKo,
          exampleJa: proposal.exampleJa,
          sourceArticleId: articleId,
          sourceLabel: `Day ${targetArticle.dayNo}`,
          initialKind: null,
        });
      }
      return;
    }

    setSyncState('saving');
    try {
      await decideRemoteGradingCardProposal(proposalId, decision, session.user.id);
      await reloadRemoteWorkspace();
      setSyncState('saved');
    } catch (error) {
      setSyncState('error');
      await reloadRemoteWorkspace().catch(() => undefined);
      throw error;
    }
  };

  const confirmGradingCards = async (articleId: string): Promise<void> => {
    const targetArticle = workspace.articles.find((item) => item.id === articleId);
    if (!targetArticle?.grading || targetArticle.grading.status !== 'graded') return;
    if (!session) {
      setWorkspace((current) => ({
        ...current,
        articles: current.articles.map((item) =>
          item.id === articleId && item.grading
            ? { ...item, grading: { ...item.grading, status: 'cards_confirmed' } }
            : item,
        ),
        updatedAt: new Date().toISOString(),
      }));
      return;
    }
    if (!targetArticle.sessionId) throw new Error('기사의 학습 세션을 찾지 못했습니다.');
    setSyncState('saving');
    try {
      await confirmRemoteGradingCards(targetArticle.sessionId, session.user.id);
      await reloadRemoteWorkspace();
      setSyncState('saved');
    } catch (error) {
      setSyncState('error');
      throw error;
    }
  };

  const rateCard = (cardId: string, rating: Grade, startedAt: number): void => {
    const target = workspace.cards.find((card) => card.id === cardId);
    if (!target) return;
    const { card, event } = reviewCard(target, rating, startedAt);
    setWorkspace((current) => ({
      ...current,
      cards: current.cards.map((item) => (item.id === cardId ? card : item)),
      reviewEvents: [...current.reviewEvents, event],
      updatedAt: new Date().toISOString(),
    }));
    if (session) {
      setSyncState('saving');
      recordRemoteReview(event)
        .then(() => setSyncState('saved'))
        .catch(async () => {
          setSyncState('error');
          try {
            setWorkspace(await loadRemoteWorkspace());
          } catch {
            // Keep the optimistic local state visible until the connection returns.
          }
        });
    }
  };

  const toggleSuspend = (cardId: string): void => {
    const target = workspace.cards.find((card) => card.id === cardId);
    if (!target) return;
    const suspended = !target.suspended;
    setWorkspace((current) => ({
      ...current,
      cards: current.cards.map((card) =>
        card.id === cardId ? { ...card, suspended } : card,
      ),
    }));
    if (session) {
      setSyncState('saving');
      setRemoteCardSuspended(cardId, suspended)
        .then(() => setSyncState('saved'))
        .catch(() => setSyncState('error'));
    }
  };

  const importWorkspace = async (incoming: StudyWorkspace): Promise<void> => {
    if (session) {
      setSyncState('saving');
      await importRemoteWorkspace(incoming, session.user.id);
      setWorkspace(await loadRemoteWorkspace());
      setSyncState('saved');
    } else {
      setWorkspace(mergeLocalWorkspaces(workspace, incoming));
    }
    const latestIncoming = [...incoming.articles].sort((a, b) => b.dayNo - a.dayNo)[0];
    if (latestIncoming) setActiveArticleId(latestIncoming.id);
    navTo('article');
  };

  if (!hasSupabaseConfig && !demoEnabled && !privateLocalEnabled) {
    return (
      <StudyShell
        view={view}
        syncState={syncState}
        isDemo
        statusLabel="DB 연결 전"
        onNavigate={navTo}
      >
        <ConfigurationPage />
      </StudyShell>
    );
  }

  const workspaceLoading = Boolean(
    session && workspaceOwner !== session.user.id && !remoteLoadError,
  );
  if (authLoading || workspaceLoading) {
    return (
      <StudyShell view={view} syncState="saving" isDemo={isDemo} onNavigate={navTo}>
        <div className="studyLoading" role="status">학습 기록을 불러오는 중입니다.</div>
      </StudyShell>
    );
  }

  if (remoteEnabled && !session) {
    return <StudyShell view={view} syncState={syncState} isDemo={false} onNavigate={navTo}><LoginPage /></StudyShell>;
  }

  if (session && remoteLoadError) {
    return (
      <StudyShell view={view} syncState="error" isDemo={false} onNavigate={navTo}>
        <RemoteLoadErrorPage
          onRetry={() => {
            setSyncState('saving');
            setRemoteLoadError(false);
            setRemoteLoadAttempt((attempt) => attempt + 1);
          }}
        />
      </StudyShell>
    );
  }

  if (workspace.articles.length === 0 && workspace.cards.length === 0) {
    return (
      <StudyShell
        view={view}
        syncState={syncState}
        isDemo={isDemo || privateLocalEnabled}
        onNavigate={navTo}
        onSignOut={session ? () => void signOut() : undefined}
      >
        <ImportPage remote={Boolean(session)} onImport={importWorkspace} />
      </StudyShell>
    );
  }

  const articleOptions = [...workspace.articles].sort((a, b) => b.dayNo - a.dayNo);
  const article =
    articleOptions.find((candidate) => candidate.id === activeArticleId)
    ?? articleOptions[0];
  let content: ReactElement;
  if (view === 'review') {
    content = (
      <ReviewSession
        cards={workspace.cards}
        onRate={rateCard}
        onOpenLibrary={() => navTo('library')}
      />
    );
  } else if (view === 'library') {
    content = (
      <CardLibrary
        cards={workspace.cards}
        onToggleSuspend={toggleSuspend}
        onStartReview={() => navTo('review')}
      />
    );
  } else if (article) {
    content = (
      <ArticleWorkbench
        article={article}
        articleOptions={articleOptions}
        responses={workspace.responses}
        cards={workspace.cards}
        isDemo={isDemo}
        onSelectArticle={setActiveArticleId}
        onUpdateArticle={updateArticle}
        onUpdateResponse={updateResponse}
        onCreateCard={createCard}
        gradingInputsLocked={
          article.grading?.status !== undefined
          && article.grading.status !== 'draft'
          && article.grading.status !== 'failed'
        }
        onRequestGrading={requestArticleGrading}
        onRetryGrading={requestArticleGrading}
        onUpdateAnnotationGrading={updateAnnotationGrading}
        onUpdateCardProposalDecision={updateCardProposalDecision}
        onConfirmGradingCards={confirmGradingCards}
      />
    );
  } else {
    content = <ImportPage remote={Boolean(session)} onImport={importWorkspace} />;
  }

  return (
    <StudyShell
      view={view}
      syncState={syncState}
      isDemo={isDemo || privateLocalEnabled}
      onNavigate={navTo}
      onImport={!isDemo ? importWorkspace : undefined}
      onExport={() => downloadWorkspace(workspace)}
      onSignOut={session ? () => void signOut() : undefined}
    >
      {content}
    </StudyShell>
  );
}

interface StudyShellProps {
  view: StudyView;
  syncState: SyncState;
  isDemo: boolean;
  children: ReactElement;
  onNavigate: (view: StudyView) => void;
  statusLabel?: string;
  onImport?: (workspace: StudyWorkspace) => Promise<void>;
  onExport?: () => void;
  onSignOut?: () => void;
}

function StudyShell({
  view,
  syncState,
  isDemo,
  children,
  onNavigate,
  statusLabel,
  onImport,
  onExport,
  onSignOut,
}: StudyShellProps): ReactElement {
  return (
    <div className="studyApp">
      <a href="#study-main" className="studySkipLink">본문으로 이동</a>
      <header className="studyTopbar">
        <a href="/" className="studyBrand" aria-label="Sewon Park 포트폴리오로 돌아가기">
          sewon park.<span>/ 日本語 study</span>
        </a>
        <nav className="studyNav" aria-label="학습 화면">
          {([
            ['article', '기사'],
            ['review', '오늘 복습'],
            ['library', '카드'],
          ] as const).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={view === value ? 'studyNavActive' : ''}
              aria-current={view === value ? 'page' : undefined}
              onClick={() => onNavigate(value)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="studyTopbarStatus">
          <span className={`studyStatusDot ${isDemo ? 'studyStatusDotDemo' : ''}`} aria-hidden="true" />
          <span>{statusLabel ?? statusCopy(syncState, isDemo)}</span>
          {onImport ? <CompactImportButton onImport={onImport} /> : null}
          {onExport ? (
            <button type="button" className="studyUtilityButton" onClick={onExport}>내보내기</button>
          ) : null}
          {onSignOut ? (
            <button type="button" className="studyUtilityButton" onClick={onSignOut}>로그아웃</button>
          ) : null}
        </div>
      </header>
      <main id="study-main" className="studyMain">{children}</main>
    </div>
  );
}
