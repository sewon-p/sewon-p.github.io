import type { Card as FsrsCard } from 'ts-fsrs';

export type StudyView = 'article' | 'review' | 'library';
export type CardKind = 'word' | 'kanji';
export type AnnotationKind =
  | 'reading_unknown'
  | 'context_guess'
  | 'unknown'
  | 'misread';
export type GradingStatus = 'draft' | 'submitted' | 'graded' | 'cards_confirmed' | 'failed';
export type GradingJudgement = 'correct' | 'partial' | 'incorrect' | 'ungraded';
export type GradingCardSourceType = 'annotation' | 'response' | 'article';
export type GradingCardProposalDecision = 'proposed' | 'accepted' | 'rejected';
export type LearningState = 'active' | 'suspended' | 'excluded';
export type ExclusionReason = 'too_basic' | 'not_useful' | 'duplicate' | 'bad_card';

export interface DictionaryReference {
  source: 'jmdict' | 'kanjidic2' | 'jmnedict' | 'custom';
  entryId?: string;
  sourceVersion: string;
}

export interface WordSenseSnapshot {
  id: string;
  partsOfSpeech: string[];
  glossesEn: string[];
  meaningKo: string;
}

export interface WordLexicalData {
  kind: 'word';
  dictionaryRef: DictionaryReference;
  dictionaryForm: string;
  forms: string[];
  readings: string[];
  senses: WordSenseSnapshot[];
  selectedReading: string;
  selectedSenseIds: string[];
  meaningKoInContext: string;
}

export interface KanjiArticleTarget {
  word: string;
  wordReading: string;
  characterReading: string;
  meaningKoInContext: string;
  articleId: string | null;
  annotationId?: string;
}

export interface KanjiLexicalData {
  kind: 'kanji';
  dictionaryRef: DictionaryReference;
  literal: string;
  onReadings: string[];
  kunReadings: string[];
  nanoriReadings: string[];
  meaningsEn: string[];
  meaningsKo: string[];
  grade?: number;
  frequency?: number;
  strokeCount?: number;
  articleTargets: KanjiArticleTarget[];
}

export type CardLexicalData = WordLexicalData | KanjiLexicalData;

export interface GradingCardProposal {
  id: string;
  sourceType: GradingCardSourceType;
  sourceId: string | null;
  reviewUnit: string;
  kind: CardKind;
  front: string;
  reading: string;
  meaningKo: string;
  exampleJa: string;
  decision: GradingCardProposalDecision;
  createdCardId?: string | null;
}

export interface AnnotationGradingFeedback {
  userReading: string;
  userMeaning: string;
  correctReading: string;
  correctMeaning: string;
  judgement: GradingJudgement;
  simpleMistake: boolean;
  reviewUnit: string;
}

export interface ResponseGradingIssue {
  quote: string;
  userInterpretation: string;
  correction: string;
  type: string;
  simpleMistake: boolean;
}

export interface ResponseGradingFeedback {
  judgement: GradingJudgement;
  issues: ResponseGradingIssue[];
  correctPoints: string;
  missingEvidence: string;
  errorType: string;
  correctedAnswer: string;
}

export interface ArticleGradingDiagnosis {
  comprehensionPct: number;
  strengths: string;
  weaknesses: string;
  misreadPatterns: string;
  nextDirection: string;
}

export interface ArticleGrading {
  status: GradingStatus;
  submissionId: string | null;
  submissionSnapshot: StudyGradingPacket | null;
  submittedAt: string | null;
  completedAt: string | null;
  diagnosis: ArticleGradingDiagnosis | null;
  cardProposals: GradingCardProposal[];
  packetVersion: number;
  graderVersion: string;
  failureMessage: string | null;
}

export interface StudyGradingPacket {
  packet_version: number;
  submission_id: string;
  session_id: string;
  article: unknown;
  responses: unknown[];
  annotations: unknown[];
}

export interface StudyGradingResult {
  graderVersion: string;
  diagnosis: ArticleGradingDiagnosis;
  responses: Array<ResponseGradingFeedback & { responseId: string }>;
  annotations: Array<
    Omit<AnnotationGradingFeedback, 'userReading' | 'userMeaning'>
    & { annotationId: string }
  >;
  cardProposals: GradingCardProposal[];
}

export interface TextAnnotation {
  id: string;
  start: number;
  end: number;
  quote: string;
  kind: AnnotationKind;
  note: string;
  grading?: AnnotationGradingFeedback;
}

export interface StudyArticle {
  id: string;
  sessionId?: string;
  dayNo: number;
  title: string;
  publisher: string;
  sourceUrl: string;
  publishedAt: string;
  bodyText: string;
  annotations: TextAnnotation[];
  bodyRevision: number;
  grading?: ArticleGrading;
}

export interface StudyResponse {
  id: string;
  articleId: string;
  ordinal: number;
  perspective: string;
  prompt: string;
  answer: string;
  referenceAnswer: string;
  feedback: string;
  grading?: ResponseGradingFeedback;
}

export interface SerializableFsrsCard
  extends Omit<FsrsCard, 'due' | 'last_review'> {
  due: string;
  last_review?: string;
}

export interface LearningCard {
  id: string;
  kind: CardKind;
  canonicalKey: string;
  front: string;
  reading: string;
  meaningKo: string;
  exampleJa: string;
  sourceArticleId: string | null;
  sourceArticleIds?: string[];
  sourceLabel: string;
  initialKind: AnnotationKind | null;
  suspended: boolean;
  learningState?: LearningState;
  excludedReason?: ExclusionReason | null;
  excludedAt?: string | null;
  lexicalData?: CardLexicalData | null;
  revision: number;
  fsrs: SerializableFsrsCard;
}

export interface ReviewEvent {
  id: string;
  cardId: string;
  rating: 1 | 2 | 3 | 4;
  reviewedAt: string;
  durationMs: number;
  baseRevision: number;
  resultingRevision: number;
  beforeState: SerializableFsrsCard;
  afterState: SerializableFsrsCard;
  schedulerVersion: string;
}

export interface StudyWorkspace {
  version: 1;
  articles: StudyArticle[];
  responses: StudyResponse[];
  cards: LearningCard[];
  reviewEvents: ReviewEvent[];
  updatedAt: string;
}

export interface NewLearningCard {
  kind: CardKind;
  front: string;
  reading: string;
  meaningKo: string;
  exampleJa: string;
  sourceArticleId: string | null;
  sourceLabel: string;
  initialKind: AnnotationKind | null;
  lexicalData?: CardLexicalData | null;
}
