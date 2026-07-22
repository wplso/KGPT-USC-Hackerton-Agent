const crypto = require('crypto');
const { canonicalStringify } = require('../shared/canonicalJson');

// docs/설문.pdf(구강검진 문진표) 1~15번 문항의 불변 Codebook.
// question_text/option_text는 PDF 원문을 그대로 옮긴 것이며(인쇄용 점선/대시
// 리더만 레이아웃 요소로 제외, trim + 연속 공백/줄바꿈만 정규화), 축약하거나
// 의역하지 않는다. 배포 후 이 15개 question_number의 의미와 option_number
// 순서는 변경하지 않는다 — 문항/선택지를 바꿔야 하면 새 codebook_version을
// 정의한다.
const CODEBOOK_VERSION = 'oral-health-questionnaire-v1';

// routes/survey.js의 NON_SCORING_CATEGORY와 동일한 문자열이어야 한다
// (Core DB의 survey_question_options.category ENUM 값, 003 migration 참고).
const NON_SCORING_CATEGORY = '비점수 문진';

const QUESTIONS = [
  {
    question_number: 1,
    question_code: 'DENTAL_VISIT_LAST_YEAR',
    question_text: '최근 1년간 구강병 치료나 관리를 목적으로 치과(의)원에 가신 적이 있습니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'YES', option_text: '예' },
      { option_number: 2, answer_code: 'NO', option_text: '아니오' },
    ],
  },
  {
    question_number: 2,
    question_code: 'DIABETES_STATUS',
    question_text: '현재 당뇨병을 앓고 계십니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'YES', option_text: '예' },
      { option_number: 2, answer_code: 'NO', option_text: '아니오' },
      { option_number: 3, answer_code: 'UNKNOWN', option_text: '모르겠다' },
    ],
  },
  {
    question_number: 3,
    question_code: 'CARDIOVASCULAR_DISEASE_STATUS',
    question_text: '현재 심혈관질환을 앓고 계십니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'YES', option_text: '예' },
      { option_number: 2, answer_code: 'NO', option_text: '아니오' },
      { option_number: 3, answer_code: 'UNKNOWN', option_text: '모르겠다' },
    ],
  },
  {
    question_number: 4,
    question_code: 'CHEWING_DISCOMFORT_LAST_3_MONTHS',
    question_text:
      '최근 3개월 동안, 치아나 잇몸 문제로 혹은 틀니 때문에 음식을 씹는 데에 불편감을 느끼신 적이 있습니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'YES', option_text: '예' },
      { option_number: 2, answer_code: 'NO', option_text: '아니오' },
    ],
  },
  {
    question_number: 5,
    question_code: 'TOOTH_PAIN_LAST_3_MONTHS',
    question_text: '최근 3개월 동안, 치아가 쑤시거나 욱신거리거나 아픈 적이 있습니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'YES', option_text: '예' },
      { option_number: 2, answer_code: 'NO', option_text: '아니오' },
    ],
  },
  {
    question_number: 6,
    question_code: 'GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS',
    question_text: '최근 3개월 동안, 잇몸이 아프거나 피가 난 적이 있습니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'YES', option_text: '예' },
      { option_number: 2, answer_code: 'NO', option_text: '아니오' },
    ],
  },
  {
    question_number: 7,
    question_code: 'SELF_RATED_ORAL_HEALTH',
    question_text: '스스로 생각하실 때에 치아와 잇몸 등 귀하의 구강건강이 어떤 편이라고 생각하십니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'VERY_GOOD', option_text: '매우 좋음' },
      { option_number: 2, answer_code: 'GOOD', option_text: '좋음' },
      { option_number: 3, answer_code: 'FAIR', option_text: '보통' },
      { option_number: 4, answer_code: 'POOR', option_text: '나쁨' },
      { option_number: 5, answer_code: 'VERY_POOR', option_text: '매우 나쁨' },
    ],
  },
  {
    question_number: 8,
    question_code: 'BRUSHING_INSTRUCTION_RECEIVED',
    question_text: '치아 닦는 방법을 치과나 보건소에서 배운 적이 있습니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'YES', option_text: '예' },
      { option_number: 2, answer_code: 'NO', option_text: '아니오' },
    ],
  },
  {
    question_number: 9,
    question_code: 'BRUSHING_COUNT_YESTERDAY',
    question_text: '어제 하루 동안 치아를 몇 번 닦으셨습니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'ONE', option_text: '1회' },
      { option_number: 2, answer_code: 'TWO', option_text: '2회' },
      { option_number: 3, answer_code: 'THREE', option_text: '3회' },
      { option_number: 4, answer_code: 'FOUR', option_text: '4회' },
      { option_number: 5, answer_code: 'FIVE', option_text: '5회' },
    ],
  },
  {
    question_number: 10,
    question_code: 'BEDTIME_BRUSHING_LAST_WEEK',
    question_text: '최근 일주일 동안, 잠자기 직전에 칫솔질을 얼마나 자주 하였습니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'ALWAYS', option_text: '항상 했다(7회)' },
      { option_number: 2, answer_code: 'MOST_DAYS', option_text: '대부분 했다(4~6회)' },
      { option_number: 3, answer_code: 'SOMETIMES', option_text: '가끔 했다(1~3회)' },
      { option_number: 4, answer_code: 'NEVER', option_text: '전혀 하지 않았다(0회)' },
    ],
  },
  {
    question_number: 11,
    question_code: 'INTERDENTAL_CLEANING_LAST_WEEK',
    question_text: '최근 일주일 동안, 치아를 닦을 때 치실 혹은 치간솔을 얼마나 자주 이용하였습니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'ALWAYS', option_text: '항상 했다' },
      { option_number: 2, answer_code: 'MOST_DAYS', option_text: '대부분 했다' },
      { option_number: 3, answer_code: 'SOMETIMES', option_text: '가끔 했다' },
      { option_number: 4, answer_code: 'NEVER', option_text: '전혀 하지 않았다' },
      { option_number: 5, answer_code: 'DOES_NOT_KNOW_TOOL', option_text: '치실 혹은 치간솔이 무엇인지 모른다' },
    ],
  },
  {
    question_number: 12,
    question_code: 'FLUORIDE_TOOTHPASTE_STATUS',
    question_text: '현재 사용 중인 치약에 불소가 들어있습니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'YES', option_text: '예' },
      { option_number: 2, answer_code: 'NO', option_text: '아니오' },
      { option_number: 3, answer_code: 'UNKNOWN', option_text: '모르겠다' },
    ],
  },
  {
    question_number: 13,
    question_code: 'SUGARY_STICKY_SNACKS_PER_DAY',
    question_text: '하루에 과자, 사탕, 케이크 등 달거나 치아에 끈끈하게 달라붙는 간식을 얼마나 먹습니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'NONE', option_text: '먹지 않음' },
      { option_number: 2, answer_code: 'ONCE', option_text: '1번' },
      { option_number: 3, answer_code: 'TWO_TO_THREE', option_text: '2~3번' },
      { option_number: 4, answer_code: 'FOUR_OR_MORE', option_text: '4번 이상' },
      { option_number: 5, answer_code: 'UNKNOWN', option_text: '모르겠다' },
    ],
  },
  {
    question_number: 14,
    question_code: 'SUGARY_DRINKS_PER_DAY',
    question_text: '하루에 탄산 및 청량음료(스포츠 음료, 이온 음료, 과일 주스 포함)을 얼마나 마십니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'NONE', option_text: '먹지 않음' },
      { option_number: 2, answer_code: 'ONCE', option_text: '1번' },
      { option_number: 3, answer_code: 'TWO_TO_THREE', option_text: '2~3번' },
      { option_number: 4, answer_code: 'FOUR_OR_MORE', option_text: '4번 이상' },
      { option_number: 5, answer_code: 'UNKNOWN', option_text: '모르겠다' },
    ],
  },
  {
    question_number: 15,
    question_code: 'SMOKING_STATUS',
    question_text: '담배를 피우십니까?',
    max_score: 0,
    options: [
      { option_number: 1, answer_code: 'NEVER', option_text: '전혀 피운 적이 없다' },
      { option_number: 2, answer_code: 'CURRENT', option_text: '현재 피우고 있다' },
      { option_number: 3, answer_code: 'FORMER', option_text: '이전에 피웠으나 끊었다' },
    ],
  },
];

// Context Snapshot v2에 포함할 question_code Allowlist(상품 추천용 3개 +
// 진료 권고용 4개, GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS는 양쪽에 겹침).
const SNAPSHOT_ALLOWLIST_QUESTION_CODES = [
  'CHEWING_DISCOMFORT_LAST_3_MONTHS',
  'TOOTH_PAIN_LAST_3_MONTHS',
  'GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS',
  'SELF_RATED_ORAL_HEALTH',
  'INTERDENTAL_CLEANING_LAST_WEEK',
  'FLUORIDE_TOOTHPASTE_STATUS',
];

const QUESTIONS_BY_NUMBER = new Map(QUESTIONS.map((q) => [q.question_number, q]));
const QUESTION_CODE_BY_NUMBER = new Map(QUESTIONS.map((q) => [q.question_number, q.question_code]));
const VALID_QUESTION_NUMBERS = new Set(QUESTIONS.map((q) => q.question_number));

/**
 * DB에서 읽은 원시 응답 행([{question_number, option_number, category?, score?}, ...])을
 * Codebook 기준으로 검증하고 {question_code, answer_code} 배열로 변환한다.
 * DB/Express에 의존하지 않는 순수 함수.
 *
 * row에 category/score가 포함돼 있으면(user_survey_responses가 실제로 갖고
 * 있는 값), 코드북이 기대하는 값('비점수 문진'/0)과 다를 때 DB 콘텐츠가
 * Codebook과 어긋난 것으로 보고 AGENT_SURVEY_CODEBOOK_MISMATCH로 실패한다
 * (예: Seed 이후 누군가 옵션을 수동으로 편집한 경우).
 *
 * 반환: { ok: true, answers: [...] }
 *     | { ok: false, code: 'AGENT_SURVEY_RESPONSE_DUPLICATE' | 'AGENT_SURVEY_MAPPING_UNSUPPORTED' | 'AGENT_SURVEY_CODEBOOK_MISMATCH' }
 */
function validateAndMapResponses(rawResponses) {
  const seenQuestionNumbers = new Set();
  for (const row of rawResponses || []) {
    if (seenQuestionNumbers.has(row.question_number)) {
      return { ok: false, code: 'AGENT_SURVEY_RESPONSE_DUPLICATE' };
    }
    seenQuestionNumbers.add(row.question_number);
  }

  const answers = [];
  for (const row of rawResponses || []) {
    const question = QUESTIONS_BY_NUMBER.get(row.question_number);
    if (!question) {
      return { ok: false, code: 'AGENT_SURVEY_MAPPING_UNSUPPORTED' };
    }
    const option = question.options.find((o) => o.option_number === row.option_number);
    if (!option) {
      return { ok: false, code: 'AGENT_SURVEY_MAPPING_UNSUPPORTED' };
    }
    if (row.category !== undefined && row.category !== NON_SCORING_CATEGORY) {
      return { ok: false, code: 'AGENT_SURVEY_CODEBOOK_MISMATCH' };
    }
    if (row.score !== undefined && Number(row.score) !== 0) {
      return { ok: false, code: 'AGENT_SURVEY_CODEBOOK_MISMATCH' };
    }
    answers.push({ question_code: question.question_code, answer_code: option.answer_code });
  }

  answers.sort((a, b) => (a.question_code < b.question_code ? -1 : a.question_code > b.question_code ? 1 : 0));

  return { ok: true, answers };
}

/**
 * Context Snapshot v2에 포함할 답변만 Allowlist로 걸러낸다(question_code
 * 오름차순은 validateAndMapResponses가 이미 보장하므로 순서는 그대로 유지됨).
 */
function filterAllowlistedAnswers(answers) {
  const allowlist = new Set(SNAPSHOT_ALLOWLIST_QUESTION_CODES);
  return answers.filter((a) => allowlist.has(a.question_code));
}

/**
 * Codebook 무결성 checksum 대상 shape을 구성한다(question_number/option_number
 * 오름차순, canonicalStringify가 key는 정렬하지만 배열 순서는 그대로 두므로
 * 배열 자체를 미리 정렬된 상태로 만든다).
 */
function buildChecksumInput(questions) {
  return {
    codebook_version: CODEBOOK_VERSION,
    questions: [...questions]
      .sort((a, b) => a.question_number - b.question_number)
      .map((q) => ({
        question_number: q.question_number,
        question_code: q.question_code,
        question_text: q.question_text,
        max_score: q.max_score,
        options: [...q.options]
          .sort((a, b) => a.option_number - b.option_number)
          .map((o) => ({
            option_number: o.option_number,
            answer_code: o.answer_code,
            option_text: o.option_text,
            category: NON_SCORING_CATEGORY,
            score: 0,
          })),
      })),
  };
}

function computeCodebookChecksum(questions) {
  return crypto.createHash('sha256').update(canonicalStringify(buildChecksumInput(questions))).digest('hex');
}

const CODEBOOK_CHECKSUM = computeCodebookChecksum(QUESTIONS);

module.exports = {
  CODEBOOK_VERSION,
  NON_SCORING_CATEGORY,
  QUESTIONS,
  SNAPSHOT_ALLOWLIST_QUESTION_CODES,
  QUESTION_CODE_BY_NUMBER,
  VALID_QUESTION_NUMBERS,
  CODEBOOK_CHECKSUM,
  validateAndMapResponses,
  filterAllowlistedAnswers,
  buildChecksumInput,
  computeCodebookChecksum,
};
