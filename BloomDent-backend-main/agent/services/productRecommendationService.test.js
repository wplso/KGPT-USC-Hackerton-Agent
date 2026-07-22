/**
 * agent/services/productRecommendationService.test.js
 * 실행: node agent/services/productRecommendationService.test.js
 */

const assert = require('node:assert');
const { recommendProducts } = require('./productRecommendationService');
const { PRODUCTS } = require('../catalog/hygieneProductCatalog');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✅ ${name}`);
}

console.log('productRecommendationService 테스트\n');

function baseSnapshot(overrides = {}) {
  return {
    schema_version: 'agent-context-v2',
    images: [
      { position: 'upper', cavity_detected: false, occlusion_status: 'normal' },
      { position: 'lower', cavity_detected: false, occlusion_status: 'normal' },
      { position: 'front', cavity_detected: false, occlusion_status: 'normal' },
    ],
    survey: { codebook_version: 'oral-health-questionnaire-v1', codebook_checksum: 'x', answers: [] },
    ...overrides,
  };
}

function withAnswers(answers) {
  return baseSnapshot({ survey: { codebook_version: 'oral-health-questionnaire-v1', codebook_checksum: 'x', answers } });
}

function findItem(items, productKey) {
  return items.find((i) => i.product_key === productKey);
}

// -------------------- 결정론 --------------------

test('동일 입력이면 동일 추천 결과(items/proposal_hash)를 반환한다', () => {
  const snapshot = withAnswers([{ question_code: 'GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS', answer_code: 'YES' }]);
  const r1 = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  const r2 = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  assert.deepStrictEqual(r1, r2);
});

test('items는 product_key 오름차순으로 결정론적으로 정렬된다', () => {
  const snapshot = withAnswers([
    { question_code: 'INTERDENTAL_CLEANING_LAST_WEEK', answer_code: 'NEVER' },
    { question_code: 'FLUORIDE_TOOTHPASTE_STATUS', answer_code: 'NO' },
  ]);
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  const keys = result.items.map((i) => i.product_key);
  assert.deepStrictEqual(keys, [...keys].sort());
});

test('proposal_hash는 64자 hex이고 session_id/context_hash가 다르면 값이 달라진다', () => {
  const snapshot = baseSnapshot();
  const r1 = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  const r2 = recommendProducts({ sessionId: 's2', contextHash: 'h1', contextSnapshot: snapshot });
  const r3 = recommendProducts({ sessionId: 's1', contextHash: 'h2', contextSnapshot: snapshot });
  assert.match(r1.proposal_hash, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(r1.proposal_hash, r2.proposal_hash);
  assert.notStrictEqual(r1.proposal_hash, r3.proposal_hash);
});

// -------------------- 칫솔(Q6) --------------------

test('Q6=YES 이면 TOOTHBRUSH_ULTRA_SOFT를 GENTLE_BRUSHING_SUPPORT로 추천하고 치과 진료 권고 문구가 포함된다', () => {
  const snapshot = withAnswers([{ question_code: 'GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS', answer_code: 'YES' }]);
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  const item = findItem(result.items, 'TOOTHBRUSH_ULTRA_SOFT');
  assert.ok(item);
  assert.strictEqual(item.reason_code, 'GENTLE_BRUSHING_SUPPORT');
  assert.match(item.rationale, /치과/);
  assert.strictEqual(findItem(result.items, 'TOOTHBRUSH_SOFT'), undefined); // 동시에 두 개 다 추천 안 함
});

test('Q6=NO 또는 응답 없음이면 TOOTHBRUSH_SOFT(baseline)만 추천된다', () => {
  const withNo = recommendProducts({
    sessionId: 's1',
    contextHash: 'h1',
    contextSnapshot: withAnswers([{ question_code: 'GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS', answer_code: 'NO' }]),
  });
  const withNothing = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: baseSnapshot() });
  for (const result of [withNo, withNothing]) {
    assert.ok(findItem(result.items, 'TOOTHBRUSH_SOFT'));
    assert.strictEqual(findItem(result.items, 'TOOTHBRUSH_ULTRA_SOFT'), undefined);
  }
});

test('잇몸 민감성(ULTRA_SOFT)은 이미지 소견만으로는 절대 추론되지 않는다(survey 응답 필요)', () => {
  const snapshot = baseSnapshot({ images: [{ position: 'upper', cavity_detected: true }] });
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  assert.strictEqual(findItem(result.items, 'TOOTHBRUSH_ULTRA_SOFT'), undefined);
});

// -------------------- 치약(Q12 + cavity) --------------------

test('Q12=NO 이면 TOOTHPASTE_FLUORIDE를 FLUORIDE_HYGIENE_SUPPORT로 추천한다', () => {
  const snapshot = withAnswers([{ question_code: 'FLUORIDE_TOOTHPASTE_STATUS', answer_code: 'NO' }]);
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  assert.strictEqual(findItem(result.items, 'TOOTHPASTE_FLUORIDE').reason_code, 'FLUORIDE_HYGIENE_SUPPORT');
});

test('Q12=UNKNOWN 이어도 TOOTHPASTE_FLUORIDE를 추천한다', () => {
  const snapshot = withAnswers([{ question_code: 'FLUORIDE_TOOTHPASTE_STATUS', answer_code: 'UNKNOWN' }]);
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  assert.ok(findItem(result.items, 'TOOTHPASTE_FLUORIDE'));
});

test('Q12=YES 이고 cavity 근거도 없으면 TOOTHPASTE_FLUORIDE를 추천하지 않는다(중복 추천 억제)', () => {
  const snapshot = withAnswers([{ question_code: 'FLUORIDE_TOOTHPASTE_STATUS', answer_code: 'YES' }]);
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  assert.strictEqual(findItem(result.items, 'TOOTHPASTE_FLUORIDE'), undefined);
});

test('cavity_detected=true 이면 Q12=YES 여도 CAVITY_PREVENTION_SUPPORT로 추천한다(cavity가 우선)', () => {
  const snapshot = baseSnapshot({
    images: [
      { position: 'upper', cavity_detected: true },
      { position: 'lower', cavity_detected: false },
      { position: 'front', cavity_detected: false },
    ],
    survey: { codebook_version: 'v', codebook_checksum: 'x', answers: [{ question_code: 'FLUORIDE_TOOTHPASTE_STATUS', answer_code: 'YES' }] },
  });
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  const item = findItem(result.items, 'TOOTHPASTE_FLUORIDE');
  assert.strictEqual(item.reason_code, 'CAVITY_PREVENTION_SUPPORT');
  assert.deepStrictEqual(item.evidence, [{ source: 'image_analysis', position: 'upper' }]);
  // "정확한 진단/치료는 치과에서"처럼 전문 진료로 안내하는 문구는 안전한 관용구이므로
  // 허용하고, "이 상품이 치료/완치한다"는 식의 제품 효능 주장만 금지 표현으로 본다.
  assert.doesNotMatch(item.rationale, /치료합니다|치료해|완치|치료 효과/);
});

// -------------------- 치실(Q11) --------------------

test('Q11=NEVER 이면 FLOSS_TAPE를 추천한다', () => {
  const snapshot = withAnswers([{ question_code: 'INTERDENTAL_CLEANING_LAST_WEEK', answer_code: 'NEVER' }]);
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  assert.ok(findItem(result.items, 'FLOSS_TAPE'));
});

test('Q11=DOES_NOT_KNOW_TOOL 이면 FLOSS_TAPE를 추천한다(특정 사이즈 치간칫솔은 추천하지 않음)', () => {
  const snapshot = withAnswers([{ question_code: 'INTERDENTAL_CLEANING_LAST_WEEK', answer_code: 'DOES_NOT_KNOW_TOOL' }]);
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  assert.ok(findItem(result.items, 'FLOSS_TAPE'));
  assert.strictEqual(findItem(result.items, 'INTERDENTAL_STARTER'), undefined);
});

test('Q11=SOMETIMES/ALWAYS/MOST_DAYS 이면 FLOSS_TAPE를 추천하지 않는다', () => {
  for (const answer of ['SOMETIMES', 'ALWAYS', 'MOST_DAYS']) {
    const snapshot = withAnswers([{ question_code: 'INTERDENTAL_CLEANING_LAST_WEEK', answer_code: answer }]);
    const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
    assert.strictEqual(findItem(result.items, 'FLOSS_TAPE'), undefined, answer);
  }
});

// -------------------- 자동 추천 금지 상품 --------------------

test('TOOTHPASTE_SENSITIVE는 어떤 입력에도 자동 추천되지 않는다(Q5=YES 포함)', () => {
  const snapshot = withAnswers([{ question_code: 'TOOTH_PAIN_LAST_3_MONTHS', answer_code: 'YES' }]);
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  assert.strictEqual(findItem(result.items, 'TOOTHPASTE_SENSITIVE'), undefined);
  assert.strictEqual(PRODUCTS.TOOTHPASTE_SENSITIVE.allowed_reason_codes.length, 0);
});

test('INTERDENTAL_STARTER/TONGUE_CLEANER는 어떤 입력에도 자동 추천되지 않는다', () => {
  const snapshot = withAnswers([
    { question_code: 'INTERDENTAL_CLEANING_LAST_WEEK', answer_code: 'NEVER' },
    { question_code: 'GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS', answer_code: 'YES' },
    { question_code: 'FLUORIDE_TOOTHPASTE_STATUS', answer_code: 'NO' },
  ]);
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  assert.strictEqual(findItem(result.items, 'INTERDENTAL_STARTER'), undefined);
  assert.strictEqual(findItem(result.items, 'TONGUE_CLEANER'), undefined);
});

// -------------------- 추천 대상이 아닌 문항(Q13/14/15)의 무관성 --------------------

test('Q13(간식)/Q14(음료)/Q15(흡연) 응답은 상품 추천에 전혀 영향을 주지 않는다', () => {
  const withoutThem = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: baseSnapshot() });
  const withThem = recommendProducts({
    sessionId: 's1',
    contextHash: 'h1',
    contextSnapshot: baseSnapshot({
      survey: {
        codebook_version: 'v',
        codebook_checksum: 'x',
        answers: [
          { question_code: 'SUGARY_STICKY_SNACKS_PER_DAY', answer_code: 'FOUR_OR_MORE' },
          { question_code: 'SUGARY_DRINKS_PER_DAY', answer_code: 'FOUR_OR_MORE' },
          { question_code: 'SMOKING_STATUS', answer_code: 'CURRENT' },
        ],
      },
    }),
  });
  assert.deepStrictEqual(withoutThem.items, withThem.items);
});

// -------------------- 빈 추천 허용 / mutate 없음 / evidence 최소화 --------------------

test('설문·이미지 근거가 전혀 없으면 baseline 칫솔 1개만 반환한다(억지 추천 없음)', () => {
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: baseSnapshot() });
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].product_key, 'TOOTHBRUSH_SOFT');
});

test('추천 과정에서 contextSnapshot 입력 객체를 mutate하지 않는다', () => {
  const snapshot = withAnswers([
    { question_code: 'INTERDENTAL_CLEANING_LAST_WEEK', answer_code: 'NEVER' },
    { question_code: 'GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS', answer_code: 'YES' },
  ]);
  const before = JSON.parse(JSON.stringify(snapshot));
  recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  assert.deepStrictEqual(snapshot, before);
});

test('evidence에는 question_code/answer_code/source/position 외 개인정보가 없다', () => {
  const snapshot = withAnswers([
    { question_code: 'GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS', answer_code: 'YES' },
    { question_code: 'INTERDENTAL_CLEANING_LAST_WEEK', answer_code: 'NEVER' },
    { question_code: 'FLUORIDE_TOOTHPASTE_STATUS', answer_code: 'NO' },
  ]);
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: snapshot });
  const serialized = JSON.stringify(result);
  for (const forbidden of ['user_id', 'session_id', 'history_id', 'survey_session_id']) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

test('disclaimer는 치료/완치를 보장하지 않는다고 명시하고, 단정적인 효능 주장은 없다', () => {
  const result = recommendProducts({ sessionId: 's1', contextHash: 'h1', contextSnapshot: baseSnapshot() });
  assert.match(result.disclaimer, /보장하지 않습니다/);
  assert.doesNotMatch(result.disclaimer, /치료됩니다|완치됩니다|치료해 드립니다/);
});

console.log(`\n🎉 ${passed}개 테스트 통과`);
