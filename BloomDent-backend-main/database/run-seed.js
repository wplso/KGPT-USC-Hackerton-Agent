/**
 * database/run-seed.js
 * ----------------------------------------------------------------------------
 * 구강검진 문진표(oral-health-questionnaire-v1) Codebook을 survey_questions/
 * survey_question_options에 Seed하는 실행기.
 *
 * 안전 원칙:
 *   - agent/catalog/surveyCodebook.js(QUESTIONS)를 단일 출처로 사용해
 *     parameterized query로만 INSERT한다(원문 SQL 문자열을 손으로 다시
 *     옮겨 적지 않으므로 Codebook과 DB 내용이 항상 일치한다).
 *   - DELETE / TRUNCATE / DROP 을 전혀 실행하지 않는다.
 *   - survey_questions가 비어 있을 때만 최초 Seed를 진행한다.
 *   - 이미 데이터가 있으면: 동일 V1 콘텐츠(checksum 일치)면 아무 것도
 *     쓰지 않고 성공 처리(idempotent), 다른 콘텐츠면 덮어쓰거나 지우지
 *     않고 즉시 실패한다.
 *   - Seed 후 문항 15개, 문항별 옵션 개수, 전체 checksum을 재확인한다.
 *
 * 사용법:
 *   node database/run-seed.js              # 실행
 *   node database/run-seed.js --dry-run    # DB 연결 없이 현재 상태만 점검(연결 후 조회만, 쓰기 없음)
 */

require('dotenv').config();
const { pool } = require('../config/database');
const {
  CODEBOOK_VERSION,
  CODEBOOK_CHECKSUM,
  QUESTIONS,
  NON_SCORING_CATEGORY,
  buildChecksumInput,
  computeCodebookChecksum,
} = require('../agent/catalog/surveyCodebook');

/**
 * 현재 DB에 있는 survey_questions/survey_question_options 내용을
 * buildChecksumInput()과 동일한 shape으로 읽어온다. DB에 아무 것도 없으면
 * { questions: [] }를 반환한다.
 */
async function readCurrentDbContentShape(connection) {
  const [questionRows] = await connection.query(
    'SELECT question_number, question_text, max_score FROM survey_questions ORDER BY question_number'
  );
  if (questionRows.length === 0) {
    return { codebook_version: CODEBOOK_VERSION, questions: [] };
  }

  const [optionRows] = await connection.query(
    'SELECT question_number, option_number, option_text, category, score FROM survey_question_options ORDER BY question_number, option_number'
  );

  const optionsByQuestion = new Map();
  for (const row of optionRows) {
    if (!optionsByQuestion.has(row.question_number)) optionsByQuestion.set(row.question_number, []);
    optionsByQuestion.get(row.question_number).push({
      option_number: row.option_number,
      // DB에는 answer_code가 없다(Agent 전용 매핑) — checksum 비교 목적상
      // question_number/option_number로 codebook을 다시 찾아 answer_code를 채운다.
      option_text: row.option_text,
      category: row.category,
      score: Number(row.score),
    });
  }

  const questions = questionRows.map((q) => ({
    question_number: q.question_number,
    question_text: q.question_text,
    max_score: Number(q.max_score),
    options: optionsByQuestion.get(q.question_number) || [],
  }));

  return { codebook_version: CODEBOOK_VERSION, questions };
}

/**
 * readCurrentDbContentShape()의 결과에 codebook의 question_code/answer_code를
 * 채워 buildChecksumInput()과 완전히 동일한 shape으로 만든다. DB 콘텐츠가
 * codebook과 question_number/option_number 구성 자체가 다르면(문항 개수,
 * 옵션 개수 불일치 등) null을 반환해 checksum 비교 없이 즉시 불일치로 처리한다.
 */
function attachCodebookIdentifiers(dbShape) {
  const byNumber = new Map(QUESTIONS.map((q) => [q.question_number, q]));
  const attached = [];
  for (const dbQuestion of dbShape.questions) {
    const codebookQuestion = byNumber.get(dbQuestion.question_number);
    if (!codebookQuestion) return null;
    if (dbQuestion.options.length !== codebookQuestion.options.length) return null;

    const optionsByNumber = new Map(codebookQuestion.options.map((o) => [o.option_number, o]));
    const options = [];
    for (const dbOption of dbQuestion.options) {
      const codebookOption = optionsByNumber.get(dbOption.option_number);
      if (!codebookOption) return null;
      options.push({
        option_number: dbOption.option_number,
        answer_code: codebookOption.answer_code,
        option_text: dbOption.option_text,
        category: dbOption.category,
        score: dbOption.score,
      });
    }
    attached.push({
      question_number: dbQuestion.question_number,
      question_code: codebookQuestion.question_code,
      question_text: dbQuestion.question_text,
      max_score: dbQuestion.max_score,
      options,
    });
  }
  return { codebook_version: CODEBOOK_VERSION, questions: attached };
}

async function insertCodebook(connection) {
  for (const question of QUESTIONS) {
    await connection.query(
      `INSERT INTO survey_questions (question_number, question_text, max_score, is_active)
       VALUES (?, ?, ?, TRUE)`,
      [question.question_number, question.question_text, question.max_score]
    );
    for (const option of question.options) {
      await connection.query(
        `INSERT INTO survey_question_options
           (question_number, option_number, option_text, next_question_number, score, category)
         VALUES (?, ?, ?, NULL, ?, ?)`,
        [question.question_number, option.option_number, option.option_text, 0, NON_SCORING_CATEGORY]
      );
    }
  }
}

async function verifySeed(connection) {
  const [countRows] = await connection.query('SELECT COUNT(*) AS c FROM survey_questions');
  const questionCount = countRows[0].c;

  const [optionCountRows] = await connection.query(
    'SELECT question_number, COUNT(*) AS c FROM survey_question_options GROUP BY question_number'
  );
  const optionCountByQuestion = new Map(optionCountRows.map((r) => [r.question_number, r.c]));

  const mismatchedOptionCounts = QUESTIONS.filter(
    (q) => (optionCountByQuestion.get(q.question_number) || 0) !== q.options.length
  ).map((q) => q.question_number);

  const dbShape = await readCurrentDbContentShape(connection);
  const attached = attachCodebookIdentifiers(dbShape);
  const actualChecksum = attached ? computeCodebookChecksum(attached.questions) : null;

  return {
    questionCount,
    expectedQuestionCount: QUESTIONS.length,
    mismatchedOptionCounts,
    actualChecksum,
    expectedChecksum: CODEBOOK_CHECKSUM,
    ok:
      questionCount === QUESTIONS.length &&
      mismatchedOptionCounts.length === 0 &&
      actualChecksum === CODEBOOK_CHECKSUM,
  };
}

async function main(argv = process.argv) {
  const dryRun = argv.includes('--dry-run');

  console.log('🦷 BloomDent 문진표 Codebook Seed 실행기');
  console.log(`   codebook_version: ${CODEBOOK_VERSION}`);
  console.log(`   expected checksum: ${CODEBOOK_CHECKSUM}\n`);

  const connection = await pool.getConnection();
  try {
    const [countRows] = await connection.query('SELECT COUNT(*) AS c FROM survey_questions');
    const existingCount = countRows[0].c;

    if (existingCount === 0) {
      if (dryRun) {
        console.log('🔎 --dry-run: survey_questions가 비어 있어 최초 Seed 대상입니다(실제 쓰기는 하지 않음).');
        return;
      }
      console.log('📥 survey_questions가 비어 있습니다 — 최초 Seed를 진행합니다.');
      await connection.beginTransaction();
      try {
        await insertCodebook(connection);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } else {
      console.log(`ℹ️  survey_questions에 이미 ${existingCount}행이 있습니다 — 기존 콘텐츠와 비교합니다.`);
      const dbShape = await readCurrentDbContentShape(connection);
      const attached = attachCodebookIdentifiers(dbShape);
      if (!attached) {
        console.error('❌ 기존 콘텐츠가 Codebook과 문항/옵션 구성 자체가 다릅니다 — 덮어쓰지 않고 중단합니다.');
        process.exit(1);
      }
      const actualChecksum = computeCodebookChecksum(attached.questions);
      if (actualChecksum !== CODEBOOK_CHECKSUM) {
        console.error('❌ AGENT_SURVEY_CODEBOOK_MISMATCH: 기존 콘텐츠의 checksum이 기대값과 다릅니다 — 덮어쓰지 않고 중단합니다.');
        console.error(`   기대: ${CODEBOOK_CHECKSUM}`);
        console.error(`   실제: ${actualChecksum}`);
        process.exit(1);
      }
      console.log('✅ 기존 콘텐츠가 동일한 V1 Codebook과 일치합니다 — idempotent 성공 처리(아무 것도 쓰지 않음).');
      if (dryRun) return;
    }

    console.log('\n📋 Seed 검증:');
    const verification = await verifySeed(connection);
    console.log(`   ${verification.questionCount === verification.expectedQuestionCount ? '✅' : '❌'} 문항 개수: ${verification.questionCount}/${verification.expectedQuestionCount}`);
    console.log(`   ${verification.mismatchedOptionCounts.length === 0 ? '✅' : '❌'} 문항별 옵션 개수 일치`);
    console.log(`   ${verification.actualChecksum === verification.expectedChecksum ? '✅' : '❌'} Codebook checksum 일치`);

    if (!verification.ok) {
      console.error('\n❌ AGENT_SURVEY_CODEBOOK_MISMATCH: Seed 검증에 실패했습니다.');
      process.exit(1);
    }

    console.log('\n🎉 Seed 적용 및 검증 완료.');
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  main()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error('\n❌ Seed 실행 중 오류:', error.message);
      await pool.end();
      process.exit(1);
    });
}

module.exports = {
  readCurrentDbContentShape,
  attachCodebookIdentifiers,
  insertCodebook,
  verifySeed,
};
