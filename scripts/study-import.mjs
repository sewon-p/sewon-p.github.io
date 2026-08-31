#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const STUDY_ACCOUNT_DOMAIN = 'auth.sewon-p.github.io';
const STUDY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;
const SCHEDULER_VERSION = 'fsrs-6/ts-fsrs-5.4.1-seeded-v2';

const HELP = `일본어 학습 StudyWorkspace 가져오기

사용법:
  npm run --silent study:import -- --file /path/to/workspace.json

입력 형식:
  학습 앱이 내보내는 camelCase StudyWorkspace JSON을 사용합니다.
  최상위에 version, articles, responses, cards, reviewEvents가 필요합니다.
  snake_case RPC payload를 직접 넣지 마세요. 이 CLI가 src/study/supabase.ts와
  같은 규칙으로 변환하고, 세부 무결성은 import_study_workspace RPC가
  원자적으로 검증합니다. 같은 파일을 다시 실행해도 RPC가 중복을 병합합니다.

옵션:
  --file PATH   가져올 StudyWorkspace JSON 파일
  -h, --help    도움말 표시

환경 변수(.env.local):
  SUPABASE_SECRET_KEY              Auth 사용자 확인에만 사용
  SUPABASE_URL 또는 VITE_SUPABASE_URL
  VITE_SUPABASE_PUBLISHABLE_KEY    실제 학습 계정 로그인과 RPC 호출에 사용

보안:
  프로젝트의 Auth 사용자가 정확히 한 명이어야 하며, 그 계정의
  @${STUDY_ACCOUNT_DOMAIN} 이메일에서 현재 학습 아이디를 확인합니다.
  키, 이메일, 아이디, 비밀번호는 출력하지 않습니다.`;

class CliError extends Error {}

function parseArguments(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option !== '--file') {
      throw new CliError(`알 수 없는 옵션 '${option}'입니다. --help로 사용법을 확인해 주세요.`);
    }
    if (options.file) {
      throw new CliError('--file은 한 번만 사용할 수 있습니다.');
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new CliError('--file 뒤에 JSON 파일 경로를 입력해 주세요.');
    }
    options.file = value;
    index += 1;
  }

  if (!options.file) {
    throw new CliError('--file workspace.json이 필요합니다.');
  }
  return options;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError(`${label}가 JSON 객체가 아닙니다.`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new CliError(`${label}가 배열이 아닙니다.`);
  }
  return value;
}

async function readWorkspace(filePath) {
  let source;
  try {
    source = await readFile(resolve(filePath), 'utf8');
  } catch {
    throw new CliError('StudyWorkspace JSON 파일을 읽지 못했습니다. 경로와 권한을 확인해 주세요.');
  }

  let workspace;
  try {
    workspace = JSON.parse(source);
  } catch {
    throw new CliError('StudyWorkspace 파일이 올바른 JSON이 아닙니다.');
  }

  requireObject(workspace, 'StudyWorkspace');
  if (workspace.version !== 1) {
    throw new CliError('지원하는 StudyWorkspace version은 1입니다.');
  }
  requireArray(workspace.articles, 'StudyWorkspace.articles');
  requireArray(workspace.responses, 'StudyWorkspace.responses');
  requireArray(workspace.cards, 'StudyWorkspace.cards');
  requireArray(workspace.reviewEvents, 'StudyWorkspace.reviewEvents');
  return workspace;
}

function readConfig() {
  const rawUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').trim();
  const secretKey = (process.env.SUPABASE_SECRET_KEY ?? '').trim();
  const publishableKey = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

  if (!rawUrl) {
    throw new CliError('SUPABASE_URL 또는 VITE_SUPABASE_URL이 설정되지 않았습니다.');
  }
  if (!secretKey) {
    throw new CliError('SUPABASE_SECRET_KEY가 설정되지 않았습니다. .env.local에만 저장해 주세요.');
  }
  if (!publishableKey) {
    throw new CliError('VITE_SUPABASE_PUBLISHABLE_KEY가 설정되지 않았습니다.');
  }
  if (secretKey === publishableKey) {
    throw new CliError('service-role secret과 publishable key는 서로 달라야 합니다.');
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CliError('Supabase URL 형식이 올바르지 않습니다.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new CliError('Supabase URL은 http 또는 https 주소여야 합니다.');
  }

  return {
    url: url.toString().replace(/\/$/, ''),
    secretKey,
    publishableKey,
  };
}

function createSupabaseClient(url, key) {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function listAllUsers(serviceClient) {
  const users = [];
  const perPage = 1_000;
  for (let page = 1; page <= 10_000; page += 1) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new CliError(
        'Auth 사용자를 확인하지 못했습니다. service-role secret key를 확인해 주세요.',
      );
    }
    const pageUsers = data?.users ?? [];
    users.push(...pageUsers);
    if (pageUsers.length < perPage) return users;
  }
  throw new CliError('Auth 사용자 수가 너무 많아 안전하게 자동 선택할 수 없습니다.');
}

async function resolveSingleStudyUser(serviceClient) {
  const users = await listAllUsers(serviceClient);
  if (users.length !== 1) {
    throw new CliError(
      `Auth 사용자가 ${users.length}명입니다. 안전한 자동 가져오기를 위해 정확히 한 명이어야 합니다.`,
    );
  }

  const user = users[0];
  const email = user.email?.trim().toLowerCase() ?? '';
  const suffix = `@${STUDY_ACCOUNT_DOMAIN}`;
  if (!email.endsWith(suffix)) {
    throw new CliError(`유일한 Auth 사용자가 @${STUDY_ACCOUNT_DOMAIN} 학습 계정이 아닙니다.`);
  }

  const studyId = email.slice(0, -suffix.length);
  if (!STUDY_ID_PATTERN.test(studyId)) {
    throw new CliError('학습 계정 이메일에서 유효한 학습 아이디를 확인하지 못했습니다.');
  }
  return { id: user.id, email, studyId };
}

function storedFsrsPayload(state, revision, label) {
  const source = requireObject(state, label);
  return {
    due_at: source.due,
    fsrs_state: source.state,
    stability: source.stability,
    difficulty: source.difficulty,
    elapsed_days: source.elapsed_days,
    scheduled_days: source.scheduled_days,
    learning_steps: source.learning_steps,
    reps: source.reps,
    lapses: source.lapses,
    last_review_at: source.last_review ?? null,
    revision,
  };
}

function workspaceRpcPayload(workspace) {
  return {
    version: workspace.version,
    scheduler_version: SCHEDULER_VERSION,
    articles: workspace.articles.map((article, articleIndex) => {
      const source = requireObject(article, `articles[${articleIndex}]`);
      return {
        import_key: source.id,
        day_no: source.dayNo,
        title: source.title,
        publisher: source.publisher || null,
        source_url: source.sourceUrl || null,
        published_at: source.publishedAt || null,
        body_text: source.bodyText,
        body_revision: source.bodyRevision,
        annotations: requireArray(
          source.annotations,
          `articles[${articleIndex}].annotations`,
        ).map((annotation, annotationIndex) => {
          const item = requireObject(
            annotation,
            `articles[${articleIndex}].annotations[${annotationIndex}]`,
          );
          return {
            import_key: item.id,
            kind: item.kind,
            start_offset: item.start,
            end_offset: item.end,
            quote: item.quote,
            note: item.note || null,
          };
        }),
      };
    }),
    responses: workspace.responses.map((response, responseIndex) => {
      const source = requireObject(response, `responses[${responseIndex}]`);
      return {
        import_key: source.id,
        article_import_key: source.articleId,
        ordinal: source.ordinal,
        perspective: source.perspective,
        prompt: source.prompt,
        answer: source.answer,
        reference_answer: source.referenceAnswer || null,
        feedback: source.feedback || null,
      };
    }),
    cards: workspace.cards.map((card, cardIndex) => {
      const source = requireObject(card, `cards[${cardIndex}]`);
      const learningState = source.learningState
        ?? (source.suspended ? 'suspended' : 'active');
      const sourceArticleIds = [
        ...requireArray(source.sourceArticleIds ?? [], `cards[${cardIndex}].sourceArticleIds`),
        ...(source.sourceArticleId ? [source.sourceArticleId] : []),
      ].filter((articleId, index, all) => all.indexOf(articleId) === index);
      return {
        import_key: source.id,
        kind: source.kind,
        canonical_key: source.canonicalKey,
        front: source.front,
        reading: source.reading || null,
        meaning_ko: source.meaningKo || null,
        example_ja: source.exampleJa || null,
        source_article_keys: sourceArticleIds,
        initial_kind: source.initialKind,
        suspended: learningState !== 'active',
        learning_state: learningState,
        excluded_reason: source.excludedReason ?? null,
        excluded_at: source.excludedAt ?? null,
        lexical_data: source.lexicalData ?? null,
        current_state: storedFsrsPayload(source.fsrs, source.revision, `cards[${cardIndex}].fsrs`),
      };
    }),
    review_events: workspace.reviewEvents.map((event, eventIndex) => {
      const source = requireObject(event, `reviewEvents[${eventIndex}]`);
      return {
        event_id: source.id,
        card_import_key: source.cardId,
        rating: source.rating,
        reviewed_at: source.reviewedAt,
        duration_ms: source.durationMs,
        base_revision: source.baseRevision,
        resulting_revision: source.resultingRevision,
        before_state: storedFsrsPayload(
          source.beforeState,
          source.baseRevision,
          `reviewEvents[${eventIndex}].beforeState`,
        ),
        after_state: storedFsrsPayload(
          source.afterState,
          source.resultingRevision,
          `reviewEvents[${eventIndex}].afterState`,
        ),
        scheduler_version: source.schedulerVersion,
      };
    }),
    grading_sessions: workspace.articles.flatMap((article) =>
      article.grading
        ? [{ article_import_key: article.id, ...article.grading }]
        : []),
    response_grading_feedback: workspace.responses.flatMap((response) =>
      response.grading
        ? [{
            article_import_key: response.articleId,
            response_import_key: response.id,
            ...response.grading,
          }]
        : []),
    annotation_grading_feedback: workspace.articles.flatMap((article) =>
      article.annotations.flatMap((annotation) =>
        annotation.grading
          ? [{
              article_import_key: article.id,
              annotation_import_key: annotation.id,
              ...annotation.grading,
            }]
          : [])),
  };
}

async function importWorkspace(config, workspace) {
  const serviceClient = createSupabaseClient(config.url, config.secretKey);
  const studyUser = await resolveSingleStudyUser(serviceClient);
  const client = createSupabaseClient(config.url, config.publishableKey);

  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email: studyUser.email,
    password: studyUser.studyId,
  });
  if (signInError || signInData.user?.id !== studyUser.id) {
    throw new CliError('유일한 학습 계정으로 로그인하지 못했습니다. 계정 설정을 확인해 주세요.');
  }

  const { data, error } = await client.rpc('import_study_workspace', {
    p_user_id: studyUser.id,
    p_workspace: workspaceRpcPayload(workspace),
  });
  if (error) {
    throw new CliError(`StudyWorkspace를 가져오지 못했습니다: ${error.message}`);
  }
  return data;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const workspace = await readWorkspace(options.file);
  const result = await importWorkspace(readConfig(), workspace);
  process.stdout.write(`${JSON.stringify({ status: 'imported', ...(result ?? {}) })}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
  process.stderr.write(`오류: ${message}\n`);
  process.exitCode = 1;
});
