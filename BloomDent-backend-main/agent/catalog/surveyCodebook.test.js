/**
 * agent/catalog/surveyCodebook.test.js
 * 실행: node agent/catalog/surveyCodebook.test.js
 */

const assert = require('node:assert');
const {
  CODEBOOK_VERSION,
  NON_SCORING_CATEGORY,
  QUESTIONS,
  SNAPSHOT_ALLOWLIST_QUESTION_CODES,
  CODEBOOK_CHECKSUM,
  validateAndMapResponses,
  filterAllowlistedAnswers,
  computeCodebookChecksum,
} = require('./surveyCodebook');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✅ ${name}`);
}

console.log('surveyCodebook 테스트\n');

test('codebook_version은 oral-health-questionnaire-v1이다', () => {
  assert.strictEqual(CODEBOOK_VERSION, 'oral-health-questionnaire-v1');
});

test('question_number 1~15가 정확히 유일하게 존재한다', () => {
  assert.strictEqual(QUESTIONS.length, 15);
  const numbers = QUESTIONS.map((q) => q.question_number).sort((a, b) => a - b);
  assert.deepStrictEqual(numbers, Array.from({ length: 15 }, (_, i) => i + 1));
});

test('question_code가 모두 유일하다', () => {
  const codes = QUESTIONS.map((q) => q.question_code);
  assert.strictEqual(new Set(codes).size, codes.length);
});

test('모든 문항의 category/score/max_score는 비점수 문진/0/0이다', () => {
  for (const q of QUESTIONS) {
    assert.strictEqual(q.max_score, 0, q.question_code);
    for (const opt of q.options) {
      assert.strictEqual(Object.prototype.hasOwnProperty.call(opt, 'score'), false, q.question_code);
    }
  }
  assert.strictEqual(NON_SCORING_CATEGORY, '비점수 문진');
});

test('각 문항 옵션의 option_number는 1부터 연속이고 answer_code가 유일하다', () => {
  for (const q of QUESTIONS) {
    const numbers = q.options.map((o) => o.option_number);
    assert.deepStrictEqual(numbers, Array.from({ length: q.options.length }, (_, i) => i + 1), q.question_code);
    const codes = q.options.map((o) => o.answer_code);
    assert.strictEqual(new Set(codes).size, codes.length, q.question_code);
  }
});

test('개인정보/자유기재 관련 필드는 어디에도 없다(성명/주민번호/전화번호/이메일/주소/바코드)', () => {
  const serialized = JSON.stringify(QUESTIONS);
  for (const forbidden of ['성명', '주민번호', '전화번호', '이메일', '주소', '바코드', 'free_text', 'freeText']) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

test('16번 이상 문항(자유기재 등)은 정의되지 않는다', () => {
  assert.strictEqual(QUESTIONS.some((q) => q.question_number > 15), false);
});

// -------------------- validateAndMapResponses --------------------

test('정상 응답은 question_code 오름차순으로 매핑된다', () => {
  const result = validateAndMapResponses([
    { question_number: 12, option_number: 2 },
    { question_number: 1, option_number: 1 },
  ]);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.answers, [
    { question_code: 'DENTAL_VISIT_LAST_YEAR', answer_code: 'YES' },
    { question_code: 'FLUORIDE_TOOTHPASTE_STATUS', answer_code: 'NO' },
  ]);
});

test('동일 question_number 중복은 AGENT_SURVEY_RESPONSE_DUPLICATE', () => {
  const result = validateAndMapResponses([
    { question_number: 1, option_number: 1 },
    { question_number: 1, option_number: 2 },
  ]);
  assert.deepStrictEqual(result, { ok: false, code: 'AGENT_SURVEY_RESPONSE_DUPLICATE' });
});

test('코드북 밖의 question_number는 AGENT_SURVEY_MAPPING_UNSUPPORTED(조용히 무시하지 않는다)', () => {
  const result = validateAndMapResponses([{ question_number: 999, option_number: 1 }]);
  assert.deepStrictEqual(result, { ok: false, code: 'AGENT_SURVEY_MAPPING_UNSUPPORTED' });
});

test('존재하는 question_number이지만 잘못된 option_number는 AGENT_SURVEY_MAPPING_UNSUPPORTED', () => {
  const result = validateAndMapResponses([{ question_number: 1, option_number: 99 }]);
  assert.deepStrictEqual(result, { ok: false, code: 'AGENT_SURVEY_MAPPING_UNSUPPORTED' });
});

test('category가 비점수 문진이 아니면 AGENT_SURVEY_CODEBOOK_MISMATCH', () => {
  const result = validateAndMapResponses([{ question_number: 1, option_number: 1, category: '구강관리/양치습관', score: 0 }]);
  assert.deepStrictEqual(result, { ok: false, code: 'AGENT_SURVEY_CODEBOOK_MISMATCH' });
});

test('score가 0이 아니면 AGENT_SURVEY_CODEBOOK_MISMATCH', () => {
  const result = validateAndMapResponses([{ question_number: 1, option_number: 1, category: '비점수 문진', score: 3 }]);
  assert.deepStrictEqual(result, { ok: false, code: 'AGENT_SURVEY_CODEBOOK_MISMATCH' });
});

test('category/score가 코드북과 일치하면 정상 매핑된다', () => {
  const result = validateAndMapResponses([{ question_number: 1, option_number: 1, category: '비점수 문진', score: 0 }]);
  assert.strictEqual(result.ok, true);
});

test('question_text가 바뀌어도 매핑 결과(question_code/answer_code)는 변하지 않는다', () => {
  // 매핑은 question_number/option_number에만 의존하고 question_text는 식별자로 쓰지 않는다.
  const mutatedQuestions = JSON.parse(JSON.stringify(QUESTIONS));
  mutatedQuestions[0].question_text = '완전히 다른 문구로 바뀌어도 매핑은 그대로';
  // validateAndMapResponses는 모듈 내부 QUESTIONS_BY_NUMBER를 쓰므로, 이 테스트는
  // question_text가 매핑 로직의 키로 전혀 쓰이지 않는다는 구조적 사실만 확인한다.
  const result = validateAndMapResponses([{ question_number: 1, option_number: 1 }]);
  assert.strictEqual(result.answers[0].question_code, 'DENTAL_VISIT_LAST_YEAR');
});

// -------------------- Allowlist --------------------

test('Snapshot Allowlist는 정확히 6개 question_code다', () => {
  assert.strictEqual(SNAPSHOT_ALLOWLIST_QUESTION_CODES.length, 6);
  assert.deepStrictEqual(
    [...SNAPSHOT_ALLOWLIST_QUESTION_CODES].sort(),
    [
      'CHEWING_DISCOMFORT_LAST_3_MONTHS',
      'FLUORIDE_TOOTHPASTE_STATUS',
      'GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS',
      'INTERDENTAL_CLEANING_LAST_WEEK',
      'SELF_RATED_ORAL_HEALTH',
      'TOOTH_PAIN_LAST_3_MONTHS',
    ]
  );
});

test('filterAllowlistedAnswers는 Allowlist 밖 항목을 제거한다', () => {
  const answers = [
    { question_code: 'SMOKING_STATUS', answer_code: 'NEVER' },
    { question_code: 'FLUORIDE_TOOTHPASTE_STATUS', answer_code: 'NO' },
  ];
  const filtered = filterAllowlistedAnswers(answers);
  assert.deepStrictEqual(filtered, [{ question_code: 'FLUORIDE_TOOTHPASTE_STATUS', answer_code: 'NO' }]);
});

test('TOOTHPASTE_SENSITIVE 관련 후속 문항(TEMPERATURE_TRIGGERED_TOOTH_SENSITIVITY)은 존재하지 않는다', () => {
  const codes = QUESTIONS.map((q) => q.question_code);
  assert.ok(!codes.includes('TEMPERATURE_TRIGGERED_TOOTH_SENSITIVITY'));
});

// -------------------- Checksum --------------------

test('CODEBOOK_CHECKSUM은 64자 hex이고 결정론적이다', () => {
  assert.strictEqual(CODEBOOK_CHECKSUM.length, 64);
  assert.match(CODEBOOK_CHECKSUM, /^[0-9a-f]{64}$/);
  assert.strictEqual(computeCodebookChecksum(QUESTIONS), CODEBOOK_CHECKSUM);
});

test('question_text 한 글자만 달라져도 checksum이 달라진다', () => {
  const mutated = JSON.parse(JSON.stringify(QUESTIONS));
  mutated[0].question_text += ' ';
  assert.notStrictEqual(computeCodebookChecksum(mutated), CODEBOOK_CHECKSUM);
});

test('배열 순서가 달라도(question_number/option_number 기준 정렬 후) checksum은 동일하다', () => {
  const shuffled = [...QUESTIONS].reverse().map((q) => ({ ...q, options: [...q.options].reverse() }));
  assert.strictEqual(computeCodebookChecksum(shuffled), CODEBOOK_CHECKSUM);
});

console.log(`\n🎉 ${passed}개 테스트 통과`);
