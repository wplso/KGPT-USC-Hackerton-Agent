/**
 * agent/services/contextSnapshotService.test.js
 * ----------------------------------------------------------------------------
 * contextSnapshotService의 순수 함수(DB 의존 없음)에 대한 오프라인 테스트.
 * 백엔드에 test runner(jest)가 없으므로 표준 node:assert로 작성.
 *
 * 실행: node agent/services/contextSnapshotService.test.js
 */

const assert = require('node:assert');
const {
  decideReadiness,
  pickLatestPerPosition,
  buildInitialMessage,
  buildContextSnapshot,
  computeContextHash,
} = require('./contextSnapshotService');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✅ ${name}`);
}

console.log('contextSnapshotService 테스트\n');

// ---------------------------------------------------------------------------
// decideReadiness
// ---------------------------------------------------------------------------

const AUTH_USER_ID = 1;

function completedImageRow(position) {
  return { position, analysis_status: 'completed', user_id: AUTH_USER_ID };
}

function completedImageAnalysisRow(position, overrides = {}) {
  return {
    id: overrides.id ?? Math.floor(Math.random() * 100000),
    image_type: position,
    analyzed_at: overrides.analyzed_at ?? '2026-07-20T00:00:00.000Z',
    occlusion_status: 'normal',
    occlusion_comment: null,
    cavity_detected: false,
    cavity_locations: null,
    overall_score: 8.5,
    recommendations: '정기검진 권장',
    ai_confidence: 0.72,
    llm_summary: null,
    ...overrides,
  };
}

test('history_id에 해당하는 이미지가 없으면 history_not_found', () => {
  const result = decideReadiness({
    authUserId: AUTH_USER_ID,
    imageRows: [],
    imageAnalysisRows: [],
    requestedSurveySessionId: null,
    surveyResponseRows: [],
  });
  assert.strictEqual(result.status, 'history_not_found');
});

test('history_id가 다른 사용자 소유면 history_not_found (존재 여부 숨김)', () => {
  const result = decideReadiness({
    authUserId: AUTH_USER_ID,
    imageRows: [
      { position: 'upper', analysis_status: 'completed', user_id: 999 },
      { position: 'lower', analysis_status: 'completed', user_id: 999 },
      { position: 'front', analysis_status: 'completed', user_id: 999 },
    ],
    imageAnalysisRows: [],
    requestedSurveySessionId: null,
    surveyResponseRows: [],
  });
  assert.strictEqual(result.status, 'history_not_found');
});

test('position 3종 중 하나라도 없으면 waiting_for_analysis', () => {
  const result = decideReadiness({
    authUserId: AUTH_USER_ID,
    imageRows: [completedImageRow('upper'), completedImageRow('lower')],
    imageAnalysisRows: [],
    requestedSurveySessionId: null,
    surveyResponseRows: [],
  });
  assert.strictEqual(result.status, 'waiting_for_analysis');
});

test('pending/processing이 섞여 있으면 waiting_for_analysis', () => {
  const result = decideReadiness({
    authUserId: AUTH_USER_ID,
    imageRows: [
      completedImageRow('upper'),
      { position: 'lower', analysis_status: 'processing', user_id: AUTH_USER_ID },
      { position: 'front', analysis_status: 'pending', user_id: AUTH_USER_ID },
    ],
    imageAnalysisRows: [],
    requestedSurveySessionId: null,
    surveyResponseRows: [],
  });
  assert.strictEqual(result.status, 'waiting_for_analysis');
});

test('failed가 하나라도 섞여 있으면 analysis_failed', () => {
  const result = decideReadiness({
    authUserId: AUTH_USER_ID,
    imageRows: [
      completedImageRow('upper'),
      completedImageRow('lower'),
      { position: 'front', analysis_status: 'failed', user_id: AUTH_USER_ID },
    ],
    imageAnalysisRows: [],
    requestedSurveySessionId: null,
    surveyResponseRows: [],
  });
  assert.strictEqual(result.status, 'analysis_failed');
});

test('3종 모두 completed지만 image_analysis에 position별 완료 레코드가 없으면 waiting_for_analysis', () => {
  const result = decideReadiness({
    authUserId: AUTH_USER_ID,
    imageRows: [completedImageRow('upper'), completedImageRow('lower'), completedImageRow('front')],
    imageAnalysisRows: [completedImageAnalysisRow('upper'), completedImageAnalysisRow('lower')],
    requestedSurveySessionId: null,
    surveyResponseRows: [],
  });
  assert.strictEqual(result.status, 'waiting_for_analysis');
});

test('survey_session_id가 요청됐는데 소유 레코드가 0건이면 survey_session_not_found', () => {
  const result = decideReadiness({
    authUserId: AUTH_USER_ID,
    imageRows: [completedImageRow('upper'), completedImageRow('lower'), completedImageRow('front')],
    imageAnalysisRows: [
      completedImageAnalysisRow('upper'),
      completedImageAnalysisRow('lower'),
      completedImageAnalysisRow('front'),
    ],
    requestedSurveySessionId: 'survey-abc',
    surveyResponseRows: [],
  });
  assert.strictEqual(result.status, 'survey_session_not_found');
});

test('3종 모두 completed + image_analysis 3건 모두 있으면 ready', () => {
  const result = decideReadiness({
    authUserId: AUTH_USER_ID,
    imageRows: [completedImageRow('upper'), completedImageRow('lower'), completedImageRow('front')],
    imageAnalysisRows: [
      completedImageAnalysisRow('upper'),
      completedImageAnalysisRow('lower'),
      completedImageAnalysisRow('front'),
    ],
    requestedSurveySessionId: null,
    surveyResponseRows: [],
  });
  assert.strictEqual(result.status, 'ready');
  assert.strictEqual(result.imagesByPosition.size, 3);
});

// ---------------------------------------------------------------------------
// pickLatestPerPosition
// ---------------------------------------------------------------------------

test('pickLatestPerPosition은 중복 position 중 (analyzed_at, id) 기준 최신 1건만 선택한다', () => {
  const older = completedImageAnalysisRow('upper', { id: 1, analyzed_at: '2026-07-01T00:00:00.000Z', overall_score: 5 });
  const newer = completedImageAnalysisRow('upper', { id: 2, analyzed_at: '2026-07-02T00:00:00.000Z', overall_score: 9 });

  const byPosition = pickLatestPerPosition([older, newer]);
  assert.strictEqual(byPosition.get('upper').overall_score, 9);

  const byPositionReversed = pickLatestPerPosition([newer, older]);
  assert.strictEqual(byPositionReversed.get('upper').overall_score, 9);
});

// ---------------------------------------------------------------------------
// buildInitialMessage
// ---------------------------------------------------------------------------

test('cavity_detected/occlusion 이상이 있으면 확인 필요 문구 + evidence를 포함한다', () => {
  const images = [
    { position: 'upper', cavity_detected: true, occlusion_status: 'normal', ai_confidence: 0.8 },
    { position: 'lower', cavity_detected: false, occlusion_status: 'normal', ai_confidence: 0.7 },
    { position: 'front', cavity_detected: false, occlusion_status: 'crossbite', ai_confidence: 0.6 },
  ];
  const message = buildInitialMessage(images);
  assert.match(message.text, /추가 확인이 필요한 소견/);
  assert.strictEqual(message.evidence.length, 2);
  assert.deepStrictEqual(
    message.evidence.map((e) => e.position),
    ['upper', 'front']
  );
});

test('특이 소견이 없으면 안전 문구를 반환하고 evidence는 비어있다', () => {
  const images = [
    { position: 'upper', cavity_detected: false, occlusion_status: 'normal', ai_confidence: 0.8 },
    { position: 'lower', cavity_detected: false, occlusion_status: 'normal', ai_confidence: 0.7 },
    { position: 'front', cavity_detected: false, occlusion_status: 'normal', ai_confidence: 0.6 },
  ];
  const message = buildInitialMessage(images);
  assert.match(message.text, /특별한 소견은 발견되지 않았어요/);
  assert.strictEqual(message.evidence.length, 0);
});

test('초기 메시지에는 CDT 코드/보험/비용 문구가 절대 섞이지 않는다', () => {
  const images = [
    { position: 'upper', cavity_detected: true, occlusion_status: 'normal', ai_confidence: 0.8 },
    { position: 'lower', cavity_detected: false, occlusion_status: 'normal', ai_confidence: 0.7 },
    { position: 'front', cavity_detected: false, occlusion_status: 'normal', ai_confidence: 0.6 },
  ];
  const message = buildInitialMessage(images);
  assert.doesNotMatch(message.text, /CDT|보험|비용|원\b/);
});

// ---------------------------------------------------------------------------
// computeContextHash
// ---------------------------------------------------------------------------

function baseSnapshotInput(overrides = {}) {
  const imagesByPosition = pickLatestPerPosition([
    completedImageAnalysisRow('upper'),
    completedImageAnalysisRow('lower'),
    completedImageAnalysisRow('front'),
  ]);
  return {
    historyId: 'history-1',
    surveySessionId: null,
    imagesByPosition,
    surveyResponseRows: [],
    generatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

test('generated_at만 다르면 context_hash는 동일하다', () => {
  const snapshotA = buildContextSnapshot(baseSnapshotInput({ generatedAt: '2026-07-20T00:00:00.000Z' }));
  const snapshotB = buildContextSnapshot(baseSnapshotInput({ generatedAt: '2026-07-21T12:34:56.000Z' }));
  assert.strictEqual(computeContextHash(snapshotA), computeContextHash(snapshotB));
});

test('근거 필드가 하나라도 다르면 context_hash도 달라진다', () => {
  const imagesByPositionChanged = pickLatestPerPosition([
    completedImageAnalysisRow('upper', { overall_score: 1 }),
    completedImageAnalysisRow('lower'),
    completedImageAnalysisRow('front'),
  ]);
  const snapshotA = buildContextSnapshot(baseSnapshotInput());
  const snapshotB = buildContextSnapshot(baseSnapshotInput({ imagesByPosition: imagesByPositionChanged }));
  assert.notStrictEqual(computeContextHash(snapshotA), computeContextHash(snapshotB));
});

test('객체 키 삽입 순서가 달라도 context_hash는 동일하다 (canonical 정렬 확인)', () => {
  const snapshotA = buildContextSnapshot(baseSnapshotInput());
  const snapshotBReordered = {
    initial_message: snapshotA.initial_message,
    images: snapshotA.images,
    survey: snapshotA.survey,
    survey_session_id: snapshotA.survey_session_id,
    history_id: snapshotA.history_id,
    generated_at: '2099-01-01T00:00:00.000Z',
  };
  assert.strictEqual(computeContextHash(snapshotA), computeContextHash(snapshotBReordered));
});

console.log(`\n🎉 ${passed}개 테스트 통과`);
