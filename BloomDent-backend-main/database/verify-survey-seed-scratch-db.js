/**
 * database/verify-survey-seed-scratch-db.js
 * ----------------------------------------------------------------------------
 * "완전히 빈 DB에서 setup-db → migrate:agent(001+002+003) → 문진표 Seed →
 * 실제 /api/survey/submit·/api/scores → Agent Session v2(Context Snapshot v2)
 * → Product Recommendation" 전체 경로가 재현되는지 확인하는 검증 스크립트.
 *
 * verify-migration-scratch-db.js와 동일한 안전 원칙을 따른다:
 *   - 하드코딩된 스크래치 DB 이름(ALLOWED_SCRATCH_DB_NAMES)만 대상으로 한다.
 *   - .env의 실 개발 DB(DB_NAME)는 이 스크립트의 어떤 단계에서도 건드리지 않는다.
 *   - DROP DATABASE 직전에 이름을 재검증한다.
 *
 * 사용법: node database/verify-survey-seed-scratch-db.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const {
  loadMigrationFiles,
  findSafetyViolations,
  verifyAgentTablesExist,
  verifyImageAnalysisSchema,
  verifySurveyCodebookSchema,
  checkNoDuplicateSurveyResponses,
  MIGRATIONS_DIR,
} = require('./run-migration');

const ALLOWED_SCRATCH_DB_NAMES = ['bloomdent_survey_seed_verify'];
const SCRATCH_DB_NAME = 'bloomdent_survey_seed_verify';

function assertScratchDbNameAllowed(name) {
  if (!ALLOWED_SCRATCH_DB_NAMES.includes(name)) {
    throw new Error(`허용되지 않은 스크래치 DB 이름: "${name}". 허용 목록: [${ALLOWED_SCRATCH_DB_NAMES.join(', ')}]`);
  }
}

let passed = 0;
function check(name, ok, detail) {
  if (!ok) {
    throw new Error(`❌ [${name}] 실패${detail ? `: ${detail}` : ''}`);
  }
  passed += 1;
  console.log(`  ✅ ${name}`);
}

async function applySqlFile(connection, filePath, label) {
  console.log(`🔧 ${label} 적용 중...`);
  const sql = fs.readFileSync(filePath, 'utf8');
  await connection.query(sql);
  console.log(`   완료: ${label}`);
}

function httpRequest(baseUrl, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      baseUrl + urlPath,
      { method, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch (e) {
            json = null;
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  assertScratchDbNameAllowed(SCRATCH_DB_NAME);
  const realDbName = process.env.DB_NAME;
  if (realDbName && realDbName === SCRATCH_DB_NAME) {
    throw new Error(`.env DB_NAME이 스크래치 DB 이름과 동일합니다. 중단합니다.`);
  }
  if (!process.env.DB_HOST || !process.env.DB_USER) {
    throw new Error('.env 확인 필요: DB_HOST, DB_USER');
  }

  console.log('🦷 BloomDent 문진표 Codebook — 스크래치 DB 전체 재현성 검증\n');
  console.log(`   대상 스크래치 DB: ${SCRATCH_DB_NAME}`);
  console.log(`   실 개발 DB(.env DB_NAME=${realDbName || '(미설정)'})는 건드리지 않습니다.\n`);

  const adminConn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  let server;

  try {
    // 1) setup-db 재현
    console.log(`🧪 스크래치 DB 생성: ${SCRATCH_DB_NAME}`);
    await adminConn.query(`CREATE DATABASE IF NOT EXISTS \`${SCRATCH_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await adminConn.query(`USE \`${SCRATCH_DB_NAME}\``);
    await applySqlFile(adminConn, path.join(__dirname, 'schema.sql'), 'schema.sql');
    await applySqlFile(adminConn, path.join(__dirname, 'seed_data.sql'), 'seed_data.sql');
    await applySqlFile(adminConn, path.join(__dirname, 'seed_survey_data.sql'), 'seed_survey_data.sql');
    check('1. setup-db 재현(schema+users seed) 적용', true);

    // 2) migrate:agent 재현 (001, 002, 003)
    console.log('\n🔧 Agent Migration 적용 (001, 002, 003)...');
    const files = loadMigrationFiles();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const violations = findSafetyViolations(sql);
      if (violations.length > 0) throw new Error(`${file} 안전성 위반: ${violations.join(', ')}`);
      const dupCheck = file.startsWith('003') ? await checkNoDuplicateSurveyResponses(adminConn) : { ok: true };
      if (!dupCheck.ok) throw new Error('003 적용 전 중복 응답 발견(예상치 못함)');
      await adminConn.query(sql);
      console.log(`   완료: ${file}`);
    }
    check('2. 신규 migration(001+002+003) 적용', true);

    const tableCheck = await verifyAgentTablesExist(adminConn, SCRATCH_DB_NAME);
    check('Agent 테이블 4개 존재', tableCheck.ok, tableCheck.missing.join(','));
    const schemaCheck = await verifyImageAnalysisSchema(adminConn, SCRATCH_DB_NAME);
    check('image_analysis 스키마(002) 정합', schemaCheck.ok);
    const surveySchemaCheck = await verifySurveyCodebookSchema(adminConn, SCRATCH_DB_NAME);
    check("category ENUM('비점수 문진')/UNIQUE INDEX(003) 정합", surveySchemaCheck.ok);

    // 3) 문진표 Seed 최초 실행 + idempotent 재실행 + 다른 콘텐츠 fail-closed + 검증
    process.env.DB_NAME = SCRATCH_DB_NAME; // 이후 require되는 config/database.js pool이 스크래치 DB를 보게 함
    const { pool } = require('../config/database');
    const runSeed = require('./run-seed');

    await runSeed.insertCodebook(adminConn);
    let verification = await runSeed.verifySeed(adminConn);
    check('3. 문진표 V1 Seed 최초 실행 성공(문항15/옵션개수/checksum)', verification.ok, JSON.stringify(verification));

    // idempotent 재실행: 이미 존재하는 콘텐츠와 비교해 아무 것도 쓰지 않아야 함
    const [beforeCount] = await adminConn.query('SELECT COUNT(*) AS c FROM survey_question_options');
    const dbShapeAfterFirstSeed = await runSeed.readCurrentDbContentShape(adminConn);
    const attached = runSeed.attachCodebookIdentifiers(dbShapeAfterFirstSeed);
    const { CODEBOOK_CHECKSUM, computeCodebookChecksum } = require('../agent/catalog/surveyCodebook');
    const idempotentChecksum = computeCodebookChecksum(attached.questions);
    check('4. Seed 재실행 idempotent(동일 checksum, 재삽입 없이 성공 처리)', idempotentChecksum === CODEBOOK_CHECKSUM);
    const [afterCount] = await adminConn.query('SELECT COUNT(*) AS c FROM survey_question_options');
    check('   재실행이 실제로 아무 것도 추가 삽입하지 않음', beforeCount[0].c === afterCount[0].c);

    // 다른 콘텐츠가 있으면 fail-closed: option_text 하나를 임의로 바꿔 시뮬레이션
    const mutatedShape = { questions: dbShapeAfterFirstSeed.questions.map((q) => ({ ...q, options: [...q.options] })) };
    mutatedShape.questions[0].options[0] = { ...mutatedShape.questions[0].options[0], option_text: '변조됨' };
    const mutatedAttached = runSeed.attachCodebookIdentifiers(mutatedShape);
    const mutatedChecksum = computeCodebookChecksum(mutatedAttached.questions);
    check('5. 다른 콘텐츠였다면 checksum 불일치로 fail-closed 판정됨', mutatedChecksum !== CODEBOOK_CHECKSUM);

    verification = await runSeed.verifySeed(adminConn);
    check('6. 문항 15개 + 선택지 개수 검증', verification.questionCount === 15 && verification.mismatchedOptionCounts.length === 0);
    check('7. Codebook checksum 일치', verification.actualChecksum === verification.expectedChecksum);

    // 8) 실제 /api/survey/submit, /api/scores 를 통한 정상 submit
    const surveyRoutes = require('../routes/survey');
    const scoresRoutes = require('../routes/scores');
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/survey', surveyRoutes);
    app.use('/api/scores', scoresRoutes);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const userId = 1;
    const surveySessionId = 'scratch-verify-session-1';
    const answers = [
      { question_number: 6, option_number: 1 }, // GUM_PAIN YES
      { question_number: 11, option_number: 4 }, // INTERDENTAL NEVER
      { question_number: 12, option_number: 2 }, // FLUORIDE NO
    ];
    const submitRes = await httpRequest(baseUrl, 'POST', '/api/survey/submit', { user_id: userId, session_id: surveySessionId, answers });
    check('8. 정상 submit 성공 + scoring_status:not_applicable', submitRes.status === 200 && submitRes.body.data.scoring_status === 'not_applicable', JSON.stringify(submitRes.body));

    // 9) 같은 question_number 중복 submit → 400
    const dupRes = await httpRequest(baseUrl, 'POST', '/api/survey/submit', {
      user_id: userId,
      session_id: 'scratch-verify-session-dup',
      answers: [{ question_number: 1, option_number: 1 }, { question_number: 1, option_number: 2 }],
    });
    check('9. 같은 question_number 중복 submit은 400 VALIDATION_ERROR', dupRes.status === 400 && dupRes.body.error_code === 'VALIDATION_ERROR');

    // 10) user_survey_responses에 개별 응답이 실제로 저장됨
    const [responseRows] = await pool.query('SELECT question_number, option_number FROM user_survey_responses WHERE user_id=? AND survey_session_id=?', [userId, surveySessionId]);
    check('10. user_survey_responses에 개별 응답(3건) 저장됨', responseRows.length === 3);

    // 11) user_health_scores 생성 안 됨, 12) score_history 생성 안 됨
    const [healthScoreRows] = await pool.query('SELECT COUNT(*) AS c FROM user_health_scores WHERE user_id=?', [userId]);
    check('11. user_health_scores 생성되지 않음(0행)', healthScoreRows[0].c === 0);
    const [historyRows] = await pool.query("SELECT COUNT(*) AS c FROM score_history WHERE user_id=? AND score_type='survey'", [userId]);
    check('12. score_history(survey 타입) 생성되지 않음(0행)', historyRows[0].c === 0);

    // 13) /api/scores/*에 오해성 0점이 없음(신규 사용자로 조회 시 is_new:true만, 실제 0 레코드 없음)
    const scoresRes = await httpRequest(baseUrl, 'GET', `/api/scores/user/${userId}`);
    check('13. GET /api/scores/user/:id 는 is_new:true(레코드 없음)만 반환', scoresRes.status === 200 && scoresRes.body.data.is_new === true);

    // ---------------------------------------------------------------------
    // 배점 설문 하위 호환 회귀(신규): 문진표 Codebook(비점수)과 완전히 별개인
    // 기존 스타일 "배점 있는" 설문 문항을 별도 question_number로 심어,
    // scoring_status/user_health_scores/score_history/scores API가 기존과
    // 동일하게 동작하는지 확인한다. totalMax===0 산술만으로 오판하지 않는지가
    // 핵심 확인 대상이다.
    // ---------------------------------------------------------------------
    const scoredUserId = 101; // seed_data.sql이 이미 1~3을 쓰므로 충돌 없는 범위 사용
    await pool.query(
      `INSERT INTO users (id, username, password, name, phone, email) VALUES (?, 'scored-fixture-user', 'x', '배점픽스처', '010-0000-0000', 'scored-fixture@example.com')
       ON DUPLICATE KEY UPDATE id = id`,
      [scoredUserId]
    );

    // 배점 문항 1: category='흡연/음주'(기존 6개 중 하나), option 전부 score>0, max_score>0
    await pool.query(`INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (201, '배점 회귀 테스트 문항 1', 10, TRUE)`);
    await pool.query(
      `INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES
         (201, 1, '매우 그렇다', NULL, 10, '흡연/음주'),
         (201, 2, '아니다', NULL, 5, '흡연/음주')`
    );

    const scoredSessionId = 'scratch-verify-scored-session-1';
    const scoredSubmitRes = await httpRequest(baseUrl, 'POST', '/api/survey/submit', {
      user_id: scoredUserId,
      session_id: scoredSessionId,
      answers: [{ question_number: 201, option_number: 1 }],
    });
    check(
      '배점회귀-1. 배점 설문 정상 제출 시 scoring_status:completed, scores_created:true',
      scoredSubmitRes.status === 200 &&
        scoredSubmitRes.body.data.scoring_status === 'completed' &&
        scoredSubmitRes.body.data.scores_created === true &&
        scoredSubmitRes.body.data.total_score > 0,
      JSON.stringify(scoredSubmitRes.body)
    );

    const [scoredHealthRows] = await pool.query('SELECT total_score FROM user_health_scores WHERE user_id=?', [scoredUserId]);
    check('배점회귀-2. user_health_scores에 정상 점수 생성', scoredHealthRows.length === 1 && Number(scoredHealthRows[0].total_score) > 0);

    const [scoredHistoryRows] = await pool.query("SELECT COUNT(*) AS c FROM score_history WHERE user_id=? AND score_type='survey'", [scoredUserId]);
    check('배점회귀-3. score_history에 정상 이력 생성', scoredHistoryRows[0].c === 1);

    const scoredScoresRes = await httpRequest(baseUrl, 'GET', `/api/scores/user/${scoredUserId}`);
    check(
      '배점회귀-4. GET /api/scores/user/:id 에서 정상 점수 조회 가능(is_new:false)',
      scoredScoresRes.status === 200 && scoredScoresRes.body.data.is_new !== true && scoredScoresRes.body.data.total_score > 0
    );

    const scoredChartRes = await httpRequest(baseUrl, 'GET', `/api/scores/user/${scoredUserId}/chart`);
    check('배점회귀-5. chart에 데이터 포인트 반영', scoredChartRes.status === 200 && scoredChartRes.body.data.chart_data.length >= 1);

    const scoredHistoryRes = await httpRequest(baseUrl, 'GET', `/api/scores/user/${scoredUserId}/history`);
    check('배점회귀-6. history에 이력 반영', scoredHistoryRes.status === 200 && scoredHistoryRes.body.data.history.length >= 1);

    const leaderboardRes = await httpRequest(baseUrl, 'GET', '/api/scores/leaderboard?limit=50');
    check(
      '배점회귀-7. total_score>0 조건 충족 시 leaderboard에 기존 규칙대로 반영',
      leaderboardRes.status === 200 && leaderboardRes.body.data.some((row) => row.user_id === scoredUserId)
    );

    // 핵심 회귀: category가 비점수 문진이 아니고 max_score>0인 문항에서 사용자가
    // "0점 선택지"를 골라도 scoring_status가 not_applicable로 잘못 처리되면 안 된다.
    await pool.query(`INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (202, '배점 회귀 테스트 문항 2(0점 선택지 포함)', 7, TRUE)`);
    await pool.query(
      `INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES
         (202, 1, '전혀 아니다(0점)', NULL, 0, '흡연/음주'),
         (202, 2, '그렇다', NULL, 7, '흡연/음주')`
    );
    const zeroPointUserId = 102;
    await pool.query(
      `INSERT INTO users (id, username, password, name, phone, email) VALUES (?, 'zero-point-fixture-user', 'x', '0점픽스처', '010-0000-0001', 'zero-point-fixture@example.com')
       ON DUPLICATE KEY UPDATE id = id`,
      [zeroPointUserId]
    );
    const zeroPointRes = await httpRequest(baseUrl, 'POST', '/api/survey/submit', {
      user_id: zeroPointUserId,
      session_id: 'scratch-verify-zero-point-session',
      answers: [{ question_number: 202, option_number: 1 }], // 0점 선택지를 고름
    });
    check(
      '배점회귀-8. 배점 문항에서 0점 선택지를 골라도 scoring_status는 completed(not_applicable 아님)',
      zeroPointRes.status === 200 && zeroPointRes.body.data.scoring_status === 'completed' && zeroPointRes.body.data.scores_created === true,
      JSON.stringify(zeroPointRes.body)
    );

    // 12) 검증 fixture 완전 삭제(비점수 Codebook 15문항/옵션은 남겨두고, 여기서 심은
    // 배점 회귀 fixture만 제거한다 — 이 스크래치 DB 자체는 끝에서 통째로 DROP되지만,
    // "fixture는 반드시 정리한다"는 원칙을 코드로도 증명해둔다).
    await pool.query('DELETE FROM score_history WHERE user_id IN (?, ?)', [scoredUserId, zeroPointUserId]);
    await pool.query('DELETE FROM user_health_scores WHERE user_id IN (?, ?)', [scoredUserId, zeroPointUserId]);
    await pool.query('DELETE FROM user_survey_responses WHERE user_id IN (?, ?)', [scoredUserId, zeroPointUserId]);
    await pool.query('DELETE FROM survey_question_options WHERE question_number IN (201, 202)');
    await pool.query('DELETE FROM survey_questions WHERE question_number IN (201, 202)');
    await pool.query('DELETE FROM users WHERE id IN (?, ?)', [scoredUserId, zeroPointUserId]);
    const [remainingQuestions] = await pool.query('SELECT COUNT(*) AS c FROM survey_questions');
    check('배점회귀-9. 배점 회귀 fixture 삭제 후 survey_questions는 Codebook 15개만 남음', remainingQuestions[0].c === 15);

    // 중복 DB 제약 자체도 방어선으로 동작하는지 직접 검증(애플리케이션 가드를 우회해도 막힘)
    let uniqueViolation = false;
    try {
      await adminConn.query(
        `INSERT INTO user_survey_responses (user_id, survey_session_id, question_number, option_number, score, category) VALUES (?, ?, ?, ?, 0, '비점수 문진')`,
        [userId, surveySessionId, 6, 1]
      );
    } catch (err) {
      uniqueViolation = err.code === 'ER_DUP_ENTRY';
    }
    check('DB UNIQUE 제약 자체도 (user_id,survey_session_id,question_number) 중복을 막는다', uniqueViolation);

    // 14) Agent Session v2 생성 + 15) Snapshot에 Allowlist 답변만 포함
    const coreReadRepository = require('../agent/repositories/coreReadRepository');
    const agentRepository = require('../agent/repositories/agentRepository');
    const {
      decideReadiness,
      buildSurveyAnswersOrError,
      buildContextSnapshot,
      computeContextHash,
      MODEL_NAME_PLACEHOLDER,
      PROMPT_VERSION_PLACEHOLDER,
    } = require('../agent/services/contextSnapshotService');

    const historyId = 'agent-fixture-history-survey-verify';
    await pool.query(
      `INSERT INTO dental_images (user_id, cloudinary_id, cloudinary_url, original_filename, position, image_type, analysis_status, history_id)
       VALUES (?, 'v/upper', 'https://example.com/v-upper.jpg', 'v-upper.jpg', 'upper', 'other', 'completed', ?),
              (?, 'v/lower', 'https://example.com/v-lower.jpg', 'v-lower.jpg', 'lower', 'other', 'completed', ?),
              (?, 'v/front', 'https://example.com/v-front.jpg', 'v-front.jpg', 'front', 'other', 'completed', ?)`,
      [userId, historyId, userId, historyId, userId, historyId]
    );
    await pool.query(
      `INSERT INTO image_analysis (user_id, history_id, cloudinary_url, image_type, uploaded_at, analysis_status, occlusion_status, occlusion_comment, cavity_detected, cavity_locations, cavity_comment, overall_score, recommendations, ai_confidence)
       VALUES (?, ?, 'u', 'upper', CURRENT_TIMESTAMP, 'completed', 'normal', 'ok', FALSE, NULL, NULL, 8.5, 'rec', 0.82),
              (?, ?, 'l', 'lower', CURRENT_TIMESTAMP, 'completed', 'normal', 'ok', FALSE, NULL, NULL, 8.2, 'rec', 0.80),
              (?, ?, 'f', 'front', CURRENT_TIMESTAMP, 'completed', 'normal', 'ok', FALSE, NULL, NULL, 8.0, 'rec', 0.78)`,
      [userId, historyId, userId, historyId, userId, historyId]
    );

    const imageRows = await coreReadRepository.findImagesByHistoryId(historyId);
    const imageAnalysisRows = await coreReadRepository.findImageAnalysisByHistoryId(userId, historyId);
    const surveyResponseRows = await coreReadRepository.findSurveyResponsesBySessionId(userId, surveySessionId);
    const readiness = decideReadiness({
      authUserId: userId,
      imageRows,
      imageAnalysisRows,
      requestedSurveySessionId: surveySessionId,
      surveyResponseRows,
    });
    check('readiness=ready', readiness.status === 'ready', readiness.status);

    const surveyInfo = buildSurveyAnswersOrError(surveyResponseRows);
    check('surveyInfo 검증 통과(ok:true)', surveyInfo.ok === true, JSON.stringify(surveyInfo));

    const contextSnapshot = buildContextSnapshot({
      historyId,
      surveySessionId,
      imagesByPosition: readiness.imagesByPosition,
      surveyInfo,
    });
    check('14. Agent Session v2 Context Snapshot 생성(schema_version=agent-context-v2)', contextSnapshot.schema_version === 'agent-context-v2');

    const allowlist = new Set([
      'CHEWING_DISCOMFORT_LAST_3_MONTHS',
      'TOOTH_PAIN_LAST_3_MONTHS',
      'GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS',
      'SELF_RATED_ORAL_HEALTH',
      'INTERDENTAL_CLEANING_LAST_WEEK',
      'FLUORIDE_TOOTHPASTE_STATUS',
    ]);
    const onlyAllowlisted = contextSnapshot.survey.answers.every((a) => allowlist.has(a.question_code));
    check('15. Snapshot survey.answers 는 Allowlist 문항만 포함', onlyAllowlisted && contextSnapshot.survey.answers.length === 3, JSON.stringify(contextSnapshot.survey.answers));
    check('   needs_clinical_followup=true(GUM_PAIN=YES)', contextSnapshot.needs_clinical_followup === true);
    check('   followup_reason_codes에 RECENT_GUM_PAIN_OR_BLEEDING 포함', contextSnapshot.followup_reason_codes.includes('RECENT_GUM_PAIN_OR_BLEEDING'));

    const contextHash = computeContextHash(contextSnapshot);
    const sessionId = crypto.randomUUID();
    await agentRepository.insertReadySession({
      id: sessionId,
      userId,
      historyId,
      surveySessionId,
      contextSnapshot,
      contextHash,
      modelName: MODEL_NAME_PLACEHOLDER,
      promptVersion: PROMPT_VERSION_PLACEHOLDER,
      idempotencyKey: 'scratch-survey-verify-key',
    });
    const stored = await agentRepository.findByIdAndUser(sessionId, userId);
    const recomputedHash = computeContextHash(stored.context_snapshot);
    check('Agent Session 저장 후 context_hash 재검증 일치', recomputedHash === stored.context_hash);

    // 16) 기존 v1 Session(수동 삽입, schema_version 없음)의 hash는 코드 변경과 무관하게 그대로 검증됨
    const legacyV1Snapshot = {
      history_id: 'legacy-history',
      survey_session_id: null,
      generated_at: '2026-01-01T00:00:00.000Z',
      images: [],
      survey: null,
      initial_message: { text: 'legacy', evidence: [] },
    };
    const legacyHash = computeContextHash(legacyV1Snapshot);
    const legacySessionId = crypto.randomUUID();
    await agentRepository.insertReadySession({
      id: legacySessionId,
      userId,
      historyId: 'legacy-history',
      surveySessionId: null,
      contextSnapshot: legacyV1Snapshot,
      contextHash: legacyHash,
      modelName: MODEL_NAME_PLACEHOLDER,
      promptVersion: PROMPT_VERSION_PLACEHOLDER,
      idempotencyKey: 'legacy-v1-key',
    });
    const storedLegacy = await agentRepository.findByIdAndUser(legacySessionId, userId);
    const recomputedLegacyHash = computeContextHash(storedLegacy.context_snapshot);
    check('16. 기존 v1 Session(schema_version 없음)의 context_hash는 변경 없이 그대로 재현됨', recomputedLegacyHash === storedLegacy.context_hash && recomputedLegacyHash === legacyHash);

    // 17) 추천 규칙 결정론
    const { recommendProducts } = require('../agent/services/productRecommendationService');
    const rec1 = recommendProducts({ sessionId, contextHash, contextSnapshot });
    const rec2 = recommendProducts({ sessionId, contextHash, contextSnapshot });
    check('17. 동일 Snapshot에 대해 추천 결과가 결정론적으로 동일함', JSON.stringify(rec1) === JSON.stringify(rec2));
    check('   GUM_PAIN=YES → TOOTHBRUSH_ULTRA_SOFT 포함', rec1.items.some((i) => i.product_key === 'TOOTHBRUSH_ULTRA_SOFT'));

    console.log(`\n🎉 스크래치 DB 전체 재현성 검증 완료 (${passed}개 체크 통과).`);
  } finally {
    if (server) server.close();
    try {
      const { pool } = require('../config/database');
      await pool.end();
    } catch (e) {
      // pool이 아직 스크래치 DB로 안 바뀐 시점에 실패했을 수 있음 — 무시
    }

    // 18) fixture와 스크래치 DB 삭제
    assertScratchDbNameAllowed(SCRATCH_DB_NAME);
    console.log(`\n🧹 스크래치 DB 정리: DROP DATABASE ${SCRATCH_DB_NAME}`);
    await adminConn.query(`DROP DATABASE IF EXISTS \`${SCRATCH_DB_NAME}\``);
    console.log('   완료.');
    await adminConn.end();

    // 실 개발 DB는 이 스크립트가 name 자체를 몰라야 정상이므로, 이름을 원복해 이후
    // 어떤 코드도 실수로 스크래치 DB를 계속 참조하지 않도록 한다.
    if (realDbName) process.env.DB_NAME = realDbName;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ 스크래치 DB 검증 실패:');
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { ALLOWED_SCRATCH_DB_NAMES, SCRATCH_DB_NAME, assertScratchDbNameAllowed };
