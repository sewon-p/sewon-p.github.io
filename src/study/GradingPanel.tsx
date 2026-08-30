import { useState, type ReactElement } from 'react';
import type {
  ArticleGrading,
  GradingCardProposalDecision,
  StudyResponse,
  TextAnnotation,
} from './model';

type GradingAction = 'request' | 'retry' | 'confirm' | null;

const statusCopy: Record<
  NonNullable<ArticleGrading['status']>,
  { label: string; description: string }
> = {
  draft: {
    label: '작성 중',
    description: '답안과 최초 표시를 현재 상태로 보냅니다.',
  },
  submitted: {
    label: '채점 요청됨',
    description: '요청이 저장됐습니다. Codex 채팅에서 “이 Day를 채점해”라고 말해 주세요.',
  },
  graded: {
    label: '채점 완료',
    description: '교정 내용을 확인한 뒤 복습에 남길 카드를 고릅니다.',
  },
  cards_confirmed: {
    label: '정리 완료',
    description: '이번 기사에서 남길 학습 항목을 정리했습니다.',
  },
  failed: {
    label: '채점 실패',
    description: '요청한 기록은 그대로 보존되어 있습니다.',
  },
};

const proposalSourceCopy = {
  annotation: '표시',
  response: '답안',
  article: '기사',
} as const;

export interface GradingPanelProps {
  grading?: ArticleGrading;
  responses: StudyResponse[];
  annotations: TextAnnotation[];
  inputsLocked: boolean;
  onRequestGrading?: () => void | Promise<void>;
  onRetryGrading?: () => void | Promise<void>;
  onProposalDecision?: (
    proposalId: string,
    decision: Extract<GradingCardProposalDecision, 'accepted' | 'rejected'>,
  ) => void | Promise<void>;
  onConfirmCards?: () => void | Promise<void>;
}

function formatSubmittedAt(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function GradingDiagnosis({ grading }: { grading: ArticleGrading }): ReactElement | null {
  if (!grading.diagnosis) return null;
  return (
    <div className="studyGradingDiagnosis">
      <p className="studyGradingScore">
        <span>핵심 이해</span>
        <strong>{grading.diagnosis.comprehensionPct}%</strong>
      </p>
      <dl>
        <div>
          <dt>잘한 점</dt>
          <dd>{grading.diagnosis.strengths || '기록된 내용이 없습니다.'}</dd>
        </div>
        <div>
          <dt>놓친 점</dt>
          <dd>{grading.diagnosis.weaknesses || '기록된 내용이 없습니다.'}</dd>
        </div>
        <div>
          <dt>오독 패턴</dt>
          <dd>{grading.diagnosis.misreadPatterns || '뚜렷한 오독 패턴이 없습니다.'}</dd>
        </div>
        <div>
          <dt>다음 방향</dt>
          <dd>{grading.diagnosis.nextDirection || '현재 방식으로 다음 기사를 진행합니다.'}</dd>
        </div>
      </dl>
    </div>
  );
}

export function GradingPanel({
  grading,
  responses,
  annotations,
  inputsLocked,
  onRequestGrading,
  onRetryGrading,
  onProposalDecision,
  onConfirmCards,
}: GradingPanelProps): ReactElement {
  const [activeAction, setActiveAction] = useState<GradingAction>(null);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const status = grading?.status ?? 'draft';
  const meta = statusCopy[status];
  const answeredCount = responses.filter((response) => response.answer.trim()).length;
  const blankCount = responses.length - answeredCount;
  const proposals = grading?.cardProposals ?? [];
  const acceptedCount = proposals.filter((proposal) => proposal.decision === 'accepted').length;
  const rejectedCount = proposals.filter((proposal) => proposal.decision === 'rejected').length;
  const pendingCount = proposals.length - acceptedCount - rejectedCount;
  const submittedAt = formatSubmittedAt(grading?.submittedAt);

  const runAction = async (
    action: Exclude<GradingAction, null>,
    callback: (() => void | Promise<void>) | undefined,
  ): Promise<void> => {
    if (!callback || activeAction) return;
    setActionError('');
    setActiveAction(action);
    try {
      await callback();
    } catch {
      setActionError(
        action === 'confirm'
          ? '카드 정리를 완료하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.'
          : '채점을 요청하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.',
      );
    } finally {
      setActiveAction(null);
    }
  };

  const runProposalDecision = async (
    proposalId: string,
    decision: Extract<GradingCardProposalDecision, 'accepted' | 'rejected'>,
  ): Promise<void> => {
    if (!onProposalDecision || activeProposalId) return;
    setActionError('');
    setActiveProposalId(proposalId);
    try {
      await onProposalDecision(proposalId, decision);
    } catch {
      setActionError('카드 결정을 저장하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.');
    } finally {
      setActiveProposalId(null);
    }
  };

  return (
    <section className="studyGradingPanel" aria-labelledby="grading-heading">
      <div className="studySectionHeading studyGradingHeading">
        <span>03</span>
        <div>
          <h2 id="grading-heading">채점</h2>
          <p>{meta.description}</p>
        </div>
        <span className={`studyGradingStatus studyGradingStatus-${status}`}>
          {meta.label}
        </span>
      </div>

      <div className="studyGradingBody">
        {status === 'draft' ? (
          <div className="studyGradingDraft">
            {responses.length ? (
              <>
                <p className="studyGradingCount">
                  답안 {answeredCount}/{responses.length} · 표시 {annotations.length}개
                </p>
                {blankCount ? (
                  <p className="studyGradingHint">빈 답안 {blankCount}개도 현재 상태로 포함됩니다.</p>
                ) : null}
                {!annotations.length ? (
                  <p className="studyGradingHint">표시가 없어도 답안만 채점할 수 있습니다.</p>
                ) : null}
                <button
                  type="button"
                  className="studyPrimaryButton studyGradingPrimary"
                  disabled={!answeredCount || !onRequestGrading || inputsLocked || Boolean(activeAction)}
                  onClick={() => void runAction('request', onRequestGrading)}
                >
                  {activeAction === 'request' ? '채점 요청 중' : '채점 요청'}
                </button>
              </>
            ) : (
              <div className="studyGradingEmpty">
                <p>아직 채점할 답안이 없습니다.</p>
                <span>내용 이해에 답을 적으면 여기서 요청할 수 있습니다.</span>
              </div>
            )}
          </div>
        ) : null}

        {status === 'submitted' ? (
          <div className="studyGradingPending" role="status" aria-live="polite">
            <span className="studyGradingPulse" aria-hidden="true" />
            <div>
              <strong>채점 요청이 저장됐습니다.</strong>
              <p>Codex 채팅에서 “이 Day를 채점해”라고 말해 주세요.</p>
              <small>요청한 답안과 표시는 잠겨 있습니다.</small>
              {submittedAt ? <small>요청 {submittedAt}</small> : null}
            </div>
          </div>
        ) : null}

        {status === 'failed' ? (
          <div className="studyGradingFailure" role="alert">
            <strong>채점하지 못했습니다.</strong>
            <p>{grading?.failureMessage || '연결을 확인한 뒤 같은 기록으로 다시 요청해 주세요.'}</p>
            <button
              type="button"
              className="studySecondaryButton studyGradingRetry"
              disabled={!onRetryGrading || Boolean(activeAction)}
              onClick={() => void runAction('retry', onRetryGrading)}
            >
              {activeAction === 'retry' ? '다시 요청 중' : '다시 요청'}
            </button>
          </div>
        ) : null}

        {status === 'graded' ? (
          <>
            {grading?.diagnosis ? (
              <GradingDiagnosis grading={grading} />
            ) : (
              <div className="studyGradingEmpty" role="status">
                <p>채점 결과를 불러오지 못했습니다.</p>
                <span>저장 상태를 확인한 뒤 다시 열어 주세요.</span>
              </div>
            )}

            <section className="studyProposalSection" aria-labelledby="proposal-heading">
              <header>
                <div>
                  <h3 id="proposal-heading">카드 후보</h3>
                  <p>복습에 남길 항목만 승인합니다.</p>
                </div>
                <span>{pendingCount ? `미결정 ${pendingCount}` : `승인 ${acceptedCount}`}</span>
              </header>

              {proposals.length ? (
                <ol className="studyProposalList">
                  {proposals.map((proposal, index) => (
                    <li
                      key={proposal.id}
                      className={`studyProposal studyProposal-${proposal.decision}`}
                    >
                      <div className="studyProposalHead">
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <strong lang="ja">{proposal.front}</strong>
                        <small>
                          {proposal.kind === 'kanji' ? '한자' : '단어'} ·{' '}
                          {proposalSourceCopy[proposal.sourceType]}
                        </small>
                      </div>
                      <div className="studyProposalAnswer">
                        <span lang="ja">{proposal.reading || '읽기 없음'}</span>
                        <p>{proposal.meaningKo || '뜻 없음'}</p>
                        {proposal.reviewUnit ? <small>{proposal.reviewUnit}</small> : null}
                      </div>
                      <div className="studyProposalActions" aria-label={`${proposal.front} 카드 결정`}>
                        <button
                          type="button"
                          aria-pressed={proposal.decision === 'accepted'}
                          className={proposal.decision === 'accepted' ? 'studyProposalActionActive' : ''}
                          disabled={
                            !onProposalDecision
                            || proposal.decision !== 'proposed'
                            || Boolean(activeProposalId)
                          }
                          onClick={() => void runProposalDecision(proposal.id, 'accepted')}
                        >
                          {activeProposalId === proposal.id
                            ? '저장 중'
                            : proposal.decision === 'accepted'
                              ? '추가됨'
                              : '카드 추가'}
                        </button>
                        <button
                          type="button"
                          aria-pressed={proposal.decision === 'rejected'}
                          className={proposal.decision === 'rejected' ? 'studyProposalActionRejected' : ''}
                          disabled={
                            !onProposalDecision
                            || proposal.decision !== 'proposed'
                            || Boolean(activeProposalId)
                          }
                          onClick={() => void runProposalDecision(proposal.id, 'rejected')}
                        >
                          {activeProposalId === proposal.id
                            ? '저장 중'
                            : proposal.decision === 'rejected'
                              ? '제외됨'
                              : '제외'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="studyGradingEmpty">
                  <p>이번 기사에는 새 카드 후보가 없습니다.</p>
                  <span>피드백만 확인하고 정리를 마칠 수 있습니다.</span>
                </div>
              )}

              <button
                type="button"
                className="studyPrimaryButton studyGradingPrimary"
                disabled={!onConfirmCards || Boolean(pendingCount) || Boolean(activeAction)}
                onClick={() => void runAction('confirm', onConfirmCards)}
              >
                {activeAction === 'confirm' ? '카드 정리 중' : '카드 정리 완료'}
              </button>
              {pendingCount ? (
                <p className="studyGradingHint">모든 후보를 추가하거나 제외해 주세요.</p>
              ) : null}
            </section>
          </>
        ) : null}

        {status === 'cards_confirmed' ? (
          <>
            {grading ? <GradingDiagnosis grading={grading} /> : null}
            <div className="studyGradingComplete" role="status">
              <strong>정리 완료</strong>
              <p>
                {acceptedCount
                  ? `카드 ${acceptedCount}개를 복습 항목으로 확정했습니다.`
                  : '이번 기사에서는 새 카드를 남기지 않았습니다.'}
              </p>
              {proposals.length ? (
                <details>
                  <summary>카드 결정 내역 보기</summary>
                  <ul className="studyConfirmedProposalList">
                    {proposals.map((proposal) => (
                      <li key={proposal.id}>
                        <strong lang="ja">{proposal.front}</strong>
                        <span>{proposal.decision === 'accepted' ? '추가' : '제외'}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </>
        ) : null}

        {actionError ? <p className="studyGradingActionError" role="alert">{actionError}</p> : null}
      </div>
    </section>
  );
}
