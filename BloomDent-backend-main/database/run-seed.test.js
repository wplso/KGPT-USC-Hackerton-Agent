/**
 * database/run-seed.test.js
 * DB 연결 없이 fake connection으로 Seed 로직을 검증한다.
 *
 * 실행: node database/run-seed.test.js
 */

const assert = require('node:assert');
const {
  readCurrentDbContentShape,
  attachCodebookIdentifiers,
  insertCodebook,
  verifySeed,
} = require('./run-seed');
const { QUESTIONS, CODEBOOK_CHECKSUM, computeCodebookChecksum } = require('../agent/catalog/surveyCodebook');

let passed = 0;
function asyncTest(name, fn) {
  return fn().then(() => {
    passed += 1;
    console.log(`  ✅ ${name}`);
  });
}
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✅ ${name}`);
}

// QUESTIONS 데이터를 그대로 "DB에서 읽어온 것처럼" 흉내내는 헬퍼(question_code는
// 빼고 나머지는 그대로 — 실제 DB에는 question_code 컬럼이 없으므로).
function fakeDbShapeFromCodebook() {
  return {
    questions: QUESTIONS.map((q) => ({
      question_number: q.question_number,
      question_text: q.question_text,
      max_score: q.max_score,
      options: q.options.map((o) => ({
        option_number: o.option_number,
        option_text: o.option_text,
        category: '비점수 문진',
        score: 0,
      })),
    })),
  };
}

async function run() {
  console.log('run-seed 로직 테스트\n');

  test('빈 DB shape(questions: [])는 attachCodebookIdentifiers가 questions:[]를 반환한다', () => {
    const attached = attachCodebookIdentifiers({ questions: [] });
    assert.deepStrictEqual(attached.questions, []);
  });

  test('Codebook과 완전히 동일한 DB 콘텐츠는 checksum이 CODEBOOK_CHECKSUM과 일치한다', () => {
    const attached = attachCodebookIdentifiers(fakeDbShapeFromCodebook());
    assert.ok(attached);
    assert.strictEqual(computeCodebookChecksum(attached.questions), CODEBOOK_CHECKSUM);
  });

  test('옵션 개수가 다르면 attachCodebookIdentifiers는 null을 반환한다', () => {
    const shape = fakeDbShapeFromCodebook();
    shape.questions[0].options.pop(); // 옵션 하나 제거
    const attached = attachCodebookIdentifiers(shape);
    assert.strictEqual(attached, null);
  });

  test('코드북에 없는 question_number가 섞여 있으면 null을 반환한다', () => {
    const shape = fakeDbShapeFromCodebook();
    shape.questions.push({ question_number: 999, question_text: 'x', max_score: 0, options: [] });
    const attached = attachCodebookIdentifiers(shape);
    assert.strictEqual(attached, null);
  });

  test('question_text가 하나라도 다르면 checksum이 달라진다(내용 변조 감지)', () => {
    const shape = fakeDbShapeFromCodebook();
    shape.questions[3].question_text = '변조된 문구';
    const attached = attachCodebookIdentifiers(shape);
    assert.notStrictEqual(computeCodebookChecksum(attached.questions), CODEBOOK_CHECKSUM);
  });

  await asyncTest('insertCodebook은 문항 15개 + 전체 옵션 개수만큼 INSERT를 호출한다(DELETE/TRUNCATE/DROP 없음)', async () => {
    const calls = [];
    const fakeConnection = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return [{}];
      },
    };
    await insertCodebook(fakeConnection);

    const questionInserts = calls.filter((c) => c.sql.includes('INSERT INTO survey_questions'));
    const optionInserts = calls.filter((c) => c.sql.includes('INSERT INTO survey_question_options'));
    const totalOptions = QUESTIONS.reduce((sum, q) => sum + q.options.length, 0);

    assert.strictEqual(questionInserts.length, 15);
    assert.strictEqual(optionInserts.length, totalOptions);
    assert.ok(!calls.some((c) => /DELETE|TRUNCATE|DROP/i.test(c.sql)));
  });

  await asyncTest('readCurrentDbContentShape: 빈 테이블이면 questions: []를 반환한다', async () => {
    const fakeConnection = { query: async () => [[]] };
    const shape = await readCurrentDbContentShape(fakeConnection);
    assert.deepStrictEqual(shape.questions, []);
  });

  await asyncTest('verifySeed: 문항 15개 + 옵션 개수 일치 + checksum 일치면 ok:true', async () => {
    const dbShape = fakeDbShapeFromCodebook();
    let call = 0;
    const fakeConnection = {
      query: async (sql) => {
        call += 1;
        if (sql.includes('COUNT(*) AS c FROM survey_questions')) {
          return [[{ c: 15 }]];
        }
        if (sql.includes('GROUP BY question_number')) {
          return [QUESTIONS.map((q) => ({ question_number: q.question_number, c: q.options.length }))];
        }
        if (sql.startsWith('SELECT question_number, question_text, max_score')) {
          return [dbShape.questions.map((q) => ({ question_number: q.question_number, question_text: q.question_text, max_score: q.max_score }))];
        }
        if (sql.startsWith('SELECT question_number, option_number, option_text, category, score')) {
          const rows = [];
          dbShape.questions.forEach((q) => q.options.forEach((o) => rows.push({ question_number: q.question_number, ...o })));
          return [rows];
        }
        return [[]];
      },
    };
    const result = await verifySeed(fakeConnection);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.questionCount, 15);
    assert.strictEqual(result.mismatchedOptionCounts.length, 0);
    assert.strictEqual(result.actualChecksum, CODEBOOK_CHECKSUM);
  });

  await asyncTest('verifySeed: 문항 개수가 부족하면 ok:false', async () => {
    const fakeConnection = {
      query: async (sql) => {
        if (sql.includes('COUNT(*) AS c FROM survey_questions')) return [[{ c: 10 }]];
        if (sql.includes('GROUP BY question_number')) return [[]];
        return [[]];
      },
    };
    const result = await verifySeed(fakeConnection);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.questionCount, 10);
  });

  console.log(`\n🎉 ${passed}개 테스트 통과`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
