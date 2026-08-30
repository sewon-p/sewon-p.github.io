#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const CLI_VERSION = 'local-bridge/1';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HELP = `일본어 학습 로컬 채점 브리지

사용법:
  npm run --silent study:grading -- packet --day N [--user-id UUID]
  npm run --silent study:grading -- template --day N [--user-id UUID]
  npm run --silent study:grading -- apply  --day N --file result.json [--user-id UUID]
  npm run --silent study:grading -- fail   --day N --message "실패 사유" [--user-id UUID]

명령:
  packet   제출된 Day의 채점 입력을 한 줄짜리 compact JSON으로 출력합니다.
  template packet과 ID가 맞는 편집용 result.json 초안을 출력합니다.
  apply    result.json을 기존 원자적 채점 RPC로 검증하고 적용합니다.
  fail     현재 제출을 실패 상태로 바꾸고 재제출할 수 있게 합니다.

옵션:
  --day N          Day 번호입니다. Day 0도 허용합니다.
  --user-id UUID   Auth 사용자가 여러 명일 때 반드시 지정합니다.
  --file PATH      apply에서 읽을 채점 결과 JSON 파일입니다.
  --message TEXT   fail에 기록할 사용자용 실패 사유입니다.
  -h, --help       도움말을 표시합니다.

환경 변수:
  SUPABASE_SECRET_KEY   필수. 로컬 셸 또는 .env.local에만 둡니다.
  SUPABASE_URL          권장. 없으면 VITE_SUPABASE_URL을 사용합니다.

예시:
  npm run --silent study:grading -- packet --day 1 > /tmp/day1-packet.json
  npm run --silent study:grading -- template --day 1 > /tmp/day1-result.json
  npm run --silent study:grading -- apply --day 1 --file /tmp/day1-result.json
  npm run --silent study:grading -- fail --day 1 --message "채점 응답 형식 오류"

apply 결과 JSON 계약(snake_case):
  {
    "submission_id": "packet의 UUID",
    "grader_version": "자유 문자열",
    "diagnosis": {
      "comprehension_pct": 0~100, "strengths": "...", "weaknesses": "...",
      "misread_patterns": "...", "next_direction": "..."
    },
    "responses": [{
      "response_id": "packet response.id", "judgement": "correct|partial|incorrect|ungraded",
      "issues": [], "correct_points": "...", "missing_evidence": "...",
      "error_type": "...", "corrected_answer": "..."
    }],
    "annotations": [{
      "annotation_id": "packet annotation.id", "correct_reading": "...",
      "correct_meaning": "...", "judgement": "correct|partial|incorrect|ungraded",
      "simple_mistake": false, "review_unit": "..."
    }],
    "card_proposals": [{
      "proposal_id": "새 UUID", "source_type": "annotation|response|article",
      "source_id": "소스 ID(article은 null 가능)", "review_unit": "...",
      "kind": "word|kanji", "front": "...", "reading": "...",
      "meaning_ko": "...", "example_ja": "..."
    }]
  }

responses와 annotations는 packet의 모든 ID를 중복 없이 한 번씩 포함해야 합니다.
card_proposals가 없으면 []를 사용하세요. 브리지는 비밀키나 원문을 오류 로그에
출력하지 않습니다.`;

class CliError extends Error {}

function requireOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError(`${option} 뒤에 값을 입력해 주세요.`);
  }
  return value;
}

function parseArguments(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const [command, ...rest] = argv;
  if (!['packet', 'template', 'apply', 'fail'].includes(command)) {
    throw new CliError(`알 수 없는 명령 '${command}'입니다. --help로 사용법을 확인해 주세요.`);
  }

  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    if (!['--day', '--user-id', '--file', '--message'].includes(option)) {
      throw new CliError(`알 수 없는 옵션 '${option}'입니다.`);
    }
    const key = option.slice(2).replace('-id', 'Id');
    if (options[key] !== undefined) {
      throw new CliError(`${option}은 한 번만 사용할 수 있습니다.`);
    }
    options[key] = requireOptionValue(rest, index, option);
    index += 1;
  }

  if (options.day === undefined || !/^(0|[1-9]\d*)$/.test(options.day)) {
    throw new CliError('--day에는 0 이상의 정수를 입력해 주세요.');
  }
  options.day = Number(options.day);
  if (!Number.isSafeInteger(options.day) || options.day > 2_147_483_647) {
    throw new CliError('--day 값이 허용 범위를 벗어났습니다.');
  }
  if (options.userId !== undefined && !UUID_PATTERN.test(options.userId)) {
    throw new CliError('--user-id에는 올바른 UUID를 입력해 주세요.');
  }

  if (command === 'apply' && !options.file) {
    throw new CliError('apply에는 --file result.json이 필요합니다.');
  }
  if (command !== 'apply' && options.file) {
    throw new CliError('--file은 apply 명령에서만 사용할 수 있습니다.');
  }
  if (command === 'fail' && !options.message?.trim()) {
    throw new CliError('fail에는 비어 있지 않은 --message가 필요합니다.');
  }
  if (command !== 'fail' && options.message) {
    throw new CliError('--message는 fail 명령에서만 사용할 수 있습니다.');
  }
  if (options.message?.length > 2_000) {
    throw new CliError('--message는 2,000자 이내로 입력해 주세요.');
  }

  return options;
}

function createServiceClient() {
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').trim();
  const secretKey = (process.env.SUPABASE_SECRET_KEY ?? '').trim();
  if (!url) {
    throw new CliError('SUPABASE_URL 또는 VITE_SUPABASE_URL이 설정되지 않았습니다.');
  }
  if (!secretKey) {
    throw new CliError('SUPABASE_SECRET_KEY가 설정되지 않았습니다. .env.local에만 저장해 주세요.');
  }
  if (secretKey === (process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()) {
    throw new CliError('SUPABASE_SECRET_KEY에 publishable key를 사용할 수 없습니다.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new CliError('Supabase URL 형식이 올바르지 않습니다.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new CliError('Supabase URL은 http 또는 https 주소여야 합니다.');
  }

  return createClient(parsedUrl.toString().replace(/\/$/, ''), secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function listAllUserIds(client) {
  const userIds = [];
  const perPage = 1_000;
  for (let page = 1; page <= 10_000; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new CliError(
        'SUPABASE_SECRET_KEY로 Auth 사용자를 읽지 못했습니다. service-role secret key인지 확인해 주세요.',
      );
    }
    const users = data?.users ?? [];
    userIds.push(...users.map((user) => user.id));
    if (users.length < perPage) return userIds;
  }
  throw new CliError('Auth 사용자 수가 너무 많아 자동 선택을 중단했습니다. --user-id를 지정해 주세요.');
}

async function resolveUserId(client, requestedUserId) {
  if (requestedUserId) {
    const { data, error } = await client.auth.admin.getUserById(requestedUserId);
    if (error) {
      throw new CliError(
        '대상 Auth 사용자를 확인하지 못했습니다. user ID와 service-role secret key를 확인해 주세요.',
      );
    }
    if (!data?.user) {
      throw new CliError('지정한 --user-id에 해당하는 Auth 사용자가 없습니다.');
    }
    return data.user.id;
  }
  const userIds = await listAllUserIds(client);
  if (userIds.length === 0) {
    throw new CliError('Supabase Auth에 등록된 사용자가 없습니다.');
  }
  if (userIds.length > 1) {
    throw new CliError(
      `Supabase Auth 사용자가 ${userIds.length}명입니다. 대상 사용자의 --user-id UUID를 지정해 주세요.`,
    );
  }
  return userIds[0];
}

async function findSession(client, userId, day, allowedStatuses) {
  const { data, error } = await client
    .from('study_sessions')
    .select('id, user_id, day_no, grading_status, grading_submission_id')
    .eq('user_id', userId)
    .eq('day_no', day)
    .maybeSingle();
  if (error) {
    throw new CliError(`Day ${day} 학습 세션을 읽지 못했습니다: ${error.message}`);
  }
  if (!data) {
    throw new CliError(`선택한 사용자에게 Day ${day} 학습 세션이 없습니다.`);
  }
  if (!allowedStatuses.includes(data.grading_status)) {
    throw new CliError(
      `Day ${day}의 채점 상태는 '${data.grading_status}'입니다. 필요한 상태: ${allowedStatuses.join(', ')}.`,
    );
  }
  if (!data.grading_submission_id) {
    throw new CliError(`Day ${day}에 활성 submission_id가 없습니다.`);
  }
  return data;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError(`${label}가 JSON 객체가 아닙니다.`);
  }
  return value;
}

function compactPacket(packet) {
  const source = requireObject(packet, '채점 packet');
  const article = requireObject(source.article, '채점 packet의 article');
  if (!Array.isArray(source.responses) || !Array.isArray(source.annotations)) {
    throw new CliError('채점 packet의 responses 또는 annotations가 배열이 아닙니다.');
  }
  if (!UUID_PATTERN.test(String(source.submission_id ?? ''))) {
    throw new CliError('채점 packet의 submission_id가 올바르지 않습니다.');
  }

  return {
    packet_version: source.packet_version ?? 1,
    submission_id: source.submission_id,
    article: {
      title: article.title ?? '',
      body_revision: article.body_revision,
      body_text: article.body_text ?? '',
    },
    responses: source.responses.map((response) => {
      const item = requireObject(response, '채점 packet의 response');
      return {
        id: item.id,
        prompt: item.prompt ?? '',
        answer: item.answer ?? '',
      };
    }),
    annotations: source.annotations.map((annotation) => {
      const item = requireObject(annotation, '채점 packet의 annotation');
      return {
        id: item.id,
        quote: item.quote ?? '',
        kind: item.kind,
        user_reading: item.user_reading ?? '',
        user_meaning: item.user_meaning ?? '',
      };
    }),
  };
}

async function readResultFile(filePath) {
  let text;
  try {
    text = await readFile(resolve(process.cwd(), filePath), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 파일 오류';
    throw new CliError(`채점 결과 파일을 읽지 못했습니다: ${message}`);
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new CliError('채점 결과 파일이 올바른 JSON이 아닙니다.');
  }
  return requireObject(result, '채점 결과');
}

async function runPacket(client, userId, day) {
  const packet = await getPacket(client, userId, day);
  process.stdout.write(`${JSON.stringify(packet)}\n`);
}

async function getPacket(client, userId, day) {
  const session = await findSession(client, userId, day, ['submitted']);
  const { data, error } = await client.rpc('get_study_grading_packet', {
    p_user_id: userId,
    p_session_id: session.id,
  });
  if (error) {
    throw new CliError(`Day ${day} 채점 packet을 가져오지 못했습니다: ${error.message}`);
  }
  return compactPacket(data);
}

async function runTemplate(client, userId, day) {
  const packet = await getPacket(client, userId, day);
  const result = {
    submission_id: packet.submission_id,
    grader_version: CLI_VERSION,
    diagnosis: {
      comprehension_pct: 0,
      strengths: '',
      weaknesses: '',
      misread_patterns: '',
      next_direction: '',
    },
    responses: packet.responses.map((response) => ({
      response_id: response.id,
      judgement: 'ungraded',
      issues: [],
      correct_points: '',
      missing_evidence: '',
      error_type: '',
      corrected_answer: '',
    })),
    annotations: packet.annotations.map((annotation) => ({
      annotation_id: annotation.id,
      correct_reading: '',
      correct_meaning: '',
      judgement: 'ungraded',
      simple_mistake: false,
      review_unit: '',
    })),
    card_proposals: [],
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runApply(client, userId, day, filePath) {
  const result = await readResultFile(filePath);
  const resultSubmissionId = result.submission_id ?? result.submissionId;
  if (!UUID_PATTERN.test(String(resultSubmissionId ?? ''))) {
    throw new CliError('채점 결과 최상위에 올바른 submission_id가 필요합니다.');
  }
  const session = await findSession(client, userId, day, [
    'submitted',
    'graded',
    'cards_confirmed',
  ]);
  if (
    String(resultSubmissionId).toLowerCase()
    !== String(session.grading_submission_id).toLowerCase()
  ) {
    throw new CliError(
      '채점 결과의 submission_id가 현재 Day 제출과 다릅니다. packet을 다시 받아 채점해 주세요.',
    );
  }

  const { data, error } = await client.rpc('apply_study_grading_result', {
    p_user_id: userId,
    p_session_id: session.id,
    p_submission_id: resultSubmissionId,
    p_result: result,
  });
  if (error) {
    throw new CliError(`Day ${day} 채점 결과를 적용하지 못했습니다: ${error.message}`);
  }
  process.stdout.write(`${JSON.stringify(data ?? { status: 'graded' })}\n`);
}

async function runFail(client, userId, day, message) {
  const session = await findSession(client, userId, day, ['submitted']);
  const { error } = await client.rpc('mark_study_grading_failed', {
    p_user_id: userId,
    p_session_id: session.id,
    p_submission_id: session.grading_submission_id,
    p_message: message.trim(),
    p_grader_version: CLI_VERSION,
  });
  if (error) {
    throw new CliError(`Day ${day} 채점 실패 상태를 기록하지 못했습니다: ${error.message}`);
  }
  process.stdout.write(`${JSON.stringify({ status: 'failed', day })}\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const client = createServiceClient();
  const userId = await resolveUserId(client, options.userId);
  if (options.command === 'packet') {
    await runPacket(client, userId, options.day);
  } else if (options.command === 'template') {
    await runTemplate(client, userId, options.day);
  } else if (options.command === 'apply') {
    await runApply(client, userId, options.day, options.file);
  } else {
    await runFail(client, userId, options.day, options.message);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
  process.stderr.write(`오류: ${message}\n`);
  process.exitCode = 1;
});
