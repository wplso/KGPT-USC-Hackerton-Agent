/**
 * database/run-migration.test.js
 * ----------------------------------------------------------------------------
 * Agent Migration 실행기의 안전 가드에 대한 오프라인 테스트.
 * 백엔드에 test runner(jest)가 없으므로 표준 node:assert 로 작성.
 *
 * 실행: node database/run-migration.test.js
 *   (DB 연결 없이 순수 함수만 검증)
 */

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  findSafetyViolations,
  isSafeImageAnalysisAlterStatement,
  loadMigrationFiles,
  checkNoDuplicateSurveyResponses,
  verifySurveyCodebookSchema,
  EXPECTED_AGENT_TABLES,
  IMAGE_ANALYSIS_EXPECTED_COLUMNS,
  IMAGE_ANALYSIS_EXPECTED_INDEXES,
  SURVEY_QUESTION_OPTIONS_ALLOWED_ALTER_STATEMENT,
  USER_SURVEY_RESPONSES_ALLOWED_ALTER_STATEMENT,
  SURVEY_CATEGORY_EXPECTED_ENUM_VALUES,
  USER_SURVEY_RESPONSE_EXPECTED_UNIQUE_INDEX,
  MIGRATIONS_DIR,
} = require('./run-migration');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✅ ${name}`);
}

console.log('run-migration 안전 가드 테스트\n');

// 1) 실제 001 Migration 은 안전성 통과해야 한다.
test('실제 001_create_agent_tables.sql 은 위반이 없다', () => {
  const sql = fs.readFileSync(
    path.join(MIGRATIONS_DIR, '001_create_agent_tables.sql'),
    'utf8'
  );
  assert.deepStrictEqual(findSafetyViolations(sql), []);
});

// 2) DROP TABLE 은 차단된다.
test('DROP TABLE 은 위반으로 감지된다', () => {
  const v = findSafetyViolations('DROP TABLE agent_sessions;');
  assert.ok(v.some((x) => x.includes('DROP TABLE')), v.join(','));
});

// 3) TRUNCATE 은 차단된다.
test('TRUNCATE 은 위반으로 감지된다', () => {
  const v = findSafetyViolations('TRUNCATE users;');
  assert.ok(v.some((x) => x.includes('TRUNCATE')), v.join(','));
});

// 4) Core 테이블(users) 에 대한 ALTER 는 차단된다.
test('Core 테이블 ALTER 는 위반으로 감지된다', () => {
  const v = findSafetyViolations('ALTER TABLE users ADD COLUMN foo INT;');
  assert.ok(v.some((x) => x.includes('users')), v.join(','));
});

// 5) Core 테이블(image_analysis) 재정의(CREATE) 는 차단된다.
test('Core 테이블 CREATE 는 위반으로 감지된다', () => {
  const v = findSafetyViolations(
    'CREATE TABLE IF NOT EXISTS image_analysis (id INT);'
  );
  assert.ok(v.some((x) => x.includes('image_analysis')), v.join(','));
});

// 6) 주석 안에 있는 금지 키워드는 오탐하지 않는다.
test('주석 안의 DROP TABLE 은 오탐하지 않는다', () => {
  const sql = `
    -- 이 파일은 DROP TABLE 을 절대 포함하지 않는다
    /* TRUNCATE 도 금지 */
    CREATE TABLE IF NOT EXISTS agent_sessions (id CHAR(36) PRIMARY KEY);
  `;
  assert.deepStrictEqual(findSafetyViolations(sql), []);
});

// 7) 신규 Agent 테이블 CREATE 는 허용된다.
test('신규 Agent 테이블 CREATE 는 허용된다', () => {
  const sql =
    'CREATE TABLE IF NOT EXISTS agent_tool_runs (id CHAR(36) PRIMARY KEY);';
  assert.deepStrictEqual(findSafetyViolations(sql), []);
});

// 8) Migration 파일 로더는 001 파일을 오름차순으로 인식한다.
test('loadMigrationFiles 는 001 파일을 포함한다', () => {
  const files = loadMigrationFiles();
  assert.ok(files.includes('001_create_agent_tables.sql'));
  const sorted = [...files].sort();
  assert.deepStrictEqual(files, sorted);
});

// 9) 기대 Agent 테이블 목록이 4개인지 확인.
test('EXPECTED_AGENT_TABLES 는 4개의 Agent 테이블', () => {
  assert.deepStrictEqual(EXPECTED_AGENT_TABLES, [
    'agent_sessions',
    'agent_chat_history',
    'agent_tool_runs',
    'dental_passes',
  ]);
});

// 10) 실제 002 Migration 은 안전성 통과해야 한다.
test('실제 002_align_image_analysis_schema.sql 은 위반이 없다', () => {
  const sql = fs.readFileSync(
    path.join(MIGRATIONS_DIR, '002_align_image_analysis_schema.sql'),
    'utf8'
  );
  assert.deepStrictEqual(findSafetyViolations(sql), []);
});

// 11) loadMigrationFiles 는 001, 002 를 이 순서로 포함한다.
test('loadMigrationFiles 는 002를 001 다음 순서로 포함한다', () => {
  const files = loadMigrationFiles();
  assert.ok(files.includes('002_align_image_analysis_schema.sql'));
  const indexOf001 = files.indexOf('001_create_agent_tables.sql');
  const indexOf002 = files.indexOf('002_align_image_analysis_schema.sql');
  assert.ok(indexOf001 < indexOf002);
});

// 12) image_analysis: 002가 실제로 쓰는 정확한 컬럼 추가 7개 문장만 허용된다.
test('002가 사용하는 정확한 ADD COLUMN 문장 7개는 모두 허용된다', () => {
  const exactStatements = [
    "ALTER TABLE image_analysis ADD COLUMN IF NOT EXISTS user_id INT NULL AFTER image_id;",
    "ALTER TABLE image_analysis ADD COLUMN IF NOT EXISTS history_id VARCHAR(100) NULL AFTER user_id;",
    "ALTER TABLE image_analysis ADD COLUMN IF NOT EXISTS cloudinary_url TEXT NULL AFTER history_id;",
    "ALTER TABLE image_analysis ADD COLUMN IF NOT EXISTS image_type VARCHAR(50) NULL AFTER cloudinary_url;",
    "ALTER TABLE image_analysis ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP AFTER image_type;",
    "ALTER TABLE image_analysis ADD COLUMN IF NOT EXISTS analysis_status ENUM('pending','processing','completed','failed') NULL DEFAULT 'pending' AFTER uploaded_at;",
    "ALTER TABLE image_analysis ADD COLUMN IF NOT EXISTS llm_summary TEXT NULL;",
  ];
  for (const sql of exactStatements) {
    assert.deepStrictEqual(findSafetyViolations(sql), [], sql);
    assert.strictEqual(isSafeImageAnalysisAlterStatement(sql.replace(/;$/, '')), true, sql);
  }
});

// 13) image_analysis: NOT NULL 을 강제하는 컬럼 추가는 차단된다.
test('image_analysis ADD COLUMN ... NOT NULL 은 차단된다', () => {
  const sql = "ALTER TABLE image_analysis ADD COLUMN IF NOT EXISTS user_id INT NOT NULL AFTER image_id;";
  const v = findSafetyViolations(sql);
  assert.ok(v.some((x) => x.includes('image_analysis')), v.join(','));
});

// 13-1) image_analysis: allowlist에 없는 임의의 nullable 컬럼 추가는 차단된다
//       (조건: "임의의 nullable 컬럼 추가를 전부 허용하지 말 것").
test('image_analysis ADD COLUMN IF NOT EXISTS foo ... NULL(목록에 없는 컬럼명) 은 차단된다', () => {
  const sql = 'ALTER TABLE image_analysis ADD COLUMN IF NOT EXISTS foo INT NULL;';
  const v = findSafetyViolations(sql);
  assert.ok(v.some((x) => x.includes('image_analysis')), v.join(','));
});

// 13-2) image_analysis: 컬럼명은 맞지만 타입이 002와 다르면 차단된다.
test('image_analysis ADD COLUMN history_id ... 타입이 VARCHAR(100)이 아니면 차단된다', () => {
  const sql = 'ALTER TABLE image_analysis ADD COLUMN IF NOT EXISTS history_id VARCHAR(255) NULL AFTER user_id;';
  const v = findSafetyViolations(sql);
  assert.ok(v.some((x) => x.includes('image_analysis')), v.join(','));
});

// 14) image_analysis: 002가 실제로 쓰는 정확한 인덱스 추가 2개 문장만 허용된다.
test('002가 사용하는 정확한 ADD INDEX 문장 2개는 모두 허용된다', () => {
  const exactStatements = [
    'ALTER TABLE image_analysis ADD INDEX IF NOT EXISTS idx_image_analysis_history (history_id, image_type);',
    'ALTER TABLE image_analysis ADD INDEX IF NOT EXISTS idx_image_analysis_user (user_id, history_id);',
  ];
  for (const sql of exactStatements) {
    assert.deepStrictEqual(findSafetyViolations(sql), [], sql);
  }
});

// 14-1) image_analysis: allowlist에 없는 임의의 인덱스 추가는 차단된다.
test('image_analysis ADD INDEX IF NOT EXISTS(목록에 없는 인덱스명/컬럼) 는 차단된다', () => {
  const sql = 'ALTER TABLE image_analysis ADD INDEX IF NOT EXISTS idx_something_else (overall_score);';
  const v = findSafetyViolations(sql);
  assert.ok(v.some((x) => x.includes('image_analysis')), v.join(','));
});

// 14-2) image_analysis: 인덱스명은 맞지만 대상 컬럼 순서/구성이 다르면 차단된다.
test('image_analysis ADD INDEX idx_image_analysis_history 인데 컬럼 구성이 다르면 차단된다', () => {
  const sql = 'ALTER TABLE image_analysis ADD INDEX IF NOT EXISTS idx_image_analysis_history (image_type, history_id);';
  const v = findSafetyViolations(sql);
  assert.ok(v.some((x) => x.includes('image_analysis')), v.join(','));
});

// 15) image_analysis: image_id 를 NULL 허용으로 완화하는 것만 허용된다.
test('image_analysis MODIFY COLUMN image_id INT NULL 은 허용된다', () => {
  const sql = 'ALTER TABLE image_analysis MODIFY COLUMN image_id INT NULL;';
  assert.deepStrictEqual(findSafetyViolations(sql), []);
});

// 16) image_analysis: image_id 를 다시 NOT NULL 로 강화하는 것은 차단된다.
test('image_analysis MODIFY COLUMN image_id INT NOT NULL 은 차단된다', () => {
  const sql = 'ALTER TABLE image_analysis MODIFY COLUMN image_id INT NOT NULL;';
  const v = findSafetyViolations(sql);
  assert.ok(v.some((x) => x.includes('image_analysis')), v.join(','));
});

// 17) image_analysis: image_id 이외의 컬럼에 대한 MODIFY 는 allowlist 밖이라 차단된다.
test('image_analysis MODIFY COLUMN(image_id 이외) 는 차단된다', () => {
  const sql = 'ALTER TABLE image_analysis MODIFY COLUMN overall_score INT NULL;';
  const v = findSafetyViolations(sql);
  assert.ok(v.some((x) => x.includes('image_analysis')), v.join(','));
});

// 18) image_analysis: DROP COLUMN 은 allowlist 밖이라 차단된다.
test('image_analysis DROP COLUMN 은 차단된다', () => {
  const sql = 'ALTER TABLE image_analysis DROP COLUMN raw_response;';
  const v = findSafetyViolations(sql);
  assert.ok(v.some((x) => x.includes('image_analysis')), v.join(','));
});

// 19) 회귀 확인: image_analysis 이외의 Core 테이블 ALTER 는 여전히 전부 차단된다.
test('image_analysis 이외 Core 테이블(dental_images) ALTER 는 여전히 차단된다', () => {
  const sql = 'ALTER TABLE dental_images ADD COLUMN IF NOT EXISTS foo INT NULL;';
  const v = findSafetyViolations(sql);
  assert.ok(v.some((x) => x.includes('dental_images')), v.join(','));
});

// 20) drift-guard: information_schema 검증에 쓰는 컬럼/인덱스 이름 목록이
//     실제 002 파일에 문자 그대로 존재하는지 확인한다. 둘 중 하나만 바뀌고
//     다른 하나를 깜빡 안 고치는 실수를 여기서 잡는다.
test('IMAGE_ANALYSIS_EXPECTED_COLUMNS/INDEXES 는 실제 002 파일 텍스트와 일치한다', () => {
  const sql = fs.readFileSync(
    path.join(MIGRATIONS_DIR, '002_align_image_analysis_schema.sql'),
    'utf8'
  );
  for (const column of IMAGE_ANALYSIS_EXPECTED_COLUMNS) {
    assert.ok(sql.includes(column), `002 파일에 컬럼명 ${column} 이 없습니다`);
  }
  for (const index of IMAGE_ANALYSIS_EXPECTED_INDEXES) {
    assert.ok(sql.includes(index), `002 파일에 인덱스명 ${index} 이 없습니다`);
  }
});

// ---------------------------------------------------------------------------
// 003_extend_survey_for_agent_codebook.sql 전용 테스트
// ---------------------------------------------------------------------------

test('실제 003_extend_survey_for_agent_codebook.sql 은 위반이 없다', () => {
  const sql = fs.readFileSync(
    path.join(MIGRATIONS_DIR, '003_extend_survey_for_agent_codebook.sql'),
    'utf8'
  );
  assert.deepStrictEqual(findSafetyViolations(sql), []);
});

test('loadMigrationFiles 는 003을 002 다음 순서로 포함한다', () => {
  const files = loadMigrationFiles();
  assert.ok(files.includes('003_extend_survey_for_agent_codebook.sql'));
  const indexOf002 = files.indexOf('002_align_image_analysis_schema.sql');
  const indexOf003 = files.indexOf('003_extend_survey_for_agent_codebook.sql');
  assert.ok(indexOf002 < indexOf003);
});

test('003이 실제로 쓰는 category MODIFY COLUMN 문장은 허용된다', () => {
  const sql =
    "ALTER TABLE survey_question_options MODIFY COLUMN category ENUM('구강관리/양치습관','구치/구강건조','흡연/음주','우식성 식품 섭취','지각과민/불소','구강악습관','비점수 문진') NOT NULL COMMENT '카테고리(비점수 문진: 임상 배점 없는 문진, 건강 점수 계산에서 제외)';";
  assert.deepStrictEqual(findSafetyViolations(sql), []);
  assert.strictEqual(SURVEY_QUESTION_OPTIONS_ALLOWED_ALTER_STATEMENT.test(sql.replace(/;$/, '')), true);
});

test('003이 실제로 쓰는 UNIQUE INDEX 문장은 허용된다', () => {
  const sql =
    'ALTER TABLE user_survey_responses ADD UNIQUE INDEX IF NOT EXISTS uq_user_survey_response_question (user_id, survey_session_id, question_number);';
  assert.deepStrictEqual(findSafetyViolations(sql), []);
  assert.strictEqual(USER_SURVEY_RESPONSES_ALLOWED_ALTER_STATEMENT.test(sql.replace(/;$/, '')), true);
});

test('category ENUM 값 순서를 바꾸거나 기존 값을 제거하는 MODIFY는 차단된다', () => {
  const sql =
    "ALTER TABLE survey_question_options MODIFY COLUMN category ENUM('비점수 문진','구강관리/양치습관','구치/구강건조','흡연/음주','우식성 식품 섭취','지각과민/불소','구강악습관') NOT NULL;";
  const v = findSafetyViolations(sql);
  assert.ok(v.some((x) => x.includes('survey_question_options')), v.join(','));
});

test('허용된 이름/컬럼 구성이 아닌 UNIQUE INDEX 추가는 차단된다', () => {
  const sql =
    'ALTER TABLE user_survey_responses ADD UNIQUE INDEX IF NOT EXISTS uq_something_else (user_id, question_number);';
  const v = findSafetyViolations(sql);
  assert.ok(v.some((x) => x.includes('user_survey_responses')), v.join(','));
});

test('survey_question_options/user_survey_responses 에 대한 그 외 임의 ALTER는 여전히 차단된다', () => {
  const v1 = findSafetyViolations('ALTER TABLE survey_question_options ADD COLUMN foo INT;');
  assert.ok(v1.some((x) => x.includes('survey_question_options')), v1.join(','));
  const v2 = findSafetyViolations('ALTER TABLE user_survey_responses DROP COLUMN score;');
  assert.ok(v2.some((x) => x.includes('user_survey_responses')), v2.join(','));
});

test('SURVEY_CATEGORY_EXPECTED_ENUM_VALUES는 실제 003 파일 텍스트와 일치한다', () => {
  const sql = fs.readFileSync(
    path.join(MIGRATIONS_DIR, '003_extend_survey_for_agent_codebook.sql'),
    'utf8'
  );
  for (const value of SURVEY_CATEGORY_EXPECTED_ENUM_VALUES) {
    assert.ok(sql.includes(value), `003 파일에 category 값 ${value} 이 없습니다`);
  }
  assert.ok(sql.includes(USER_SURVEY_RESPONSE_EXPECTED_UNIQUE_INDEX));
});

function asyncTest(name, fn) {
  return fn().then(() => {
    passed += 1;
    console.log(`  ✅ ${name}`);
  });
}

async function runAsyncTests() {
  console.log('');
  console.log('run-migration 비동기(DB mock) 가드 테스트\n');

  await asyncTest('checkNoDuplicateSurveyResponses: 중복 없으면 ok:true', async () => {
    const fakeConnection = { query: async () => [[]] };
    const result = await checkNoDuplicateSurveyResponses(fakeConnection);
    assert.deepStrictEqual(result, { duplicates: [], ok: true });
  });

  await asyncTest('checkNoDuplicateSurveyResponses: 중복 있으면 ok:false + 목록 반환', async () => {
    const fakeRows = [{ user_id: 1, survey_session_id: 's1', question_number: 5, c: 2 }];
    const fakeConnection = { query: async () => [fakeRows] };
    const result = await checkNoDuplicateSurveyResponses(fakeConnection);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.duplicates, fakeRows);
  });

  await asyncTest('verifySurveyCodebookSchema: ENUM/INDEX 둘 다 있으면 ok:true', async () => {
    let call = 0;
    const fakeConnection = {
      query: async () => {
        call += 1;
        if (call === 1) {
          return [[{ COLUMN_TYPE: "enum('구강관리/양치습관','구치/구강건조','흡연/음주','우식성 식품 섭취','지각과민/불소','구강악습관','비점수 문진')" }]];
        }
        return [[{ INDEX_NAME: 'uq_user_survey_response_question' }]];
      },
    };
    const result = await verifySurveyCodebookSchema(fakeConnection, 'bloomdent_test');
    assert.deepStrictEqual(result, { enumOk: true, indexOk: true, ok: true });
  });

  await asyncTest('verifySurveyCodebookSchema: 인덱스가 없으면 ok:false', async () => {
    let call = 0;
    const fakeConnection = {
      query: async () => {
        call += 1;
        if (call === 1) {
          return [[{ COLUMN_TYPE: "enum('구강관리/양치습관','구치/구강건조','흡연/음주','우식성 식품 섭취','지각과민/불소','구강악습관','비점수 문진')" }]];
        }
        return [[]];
      },
    };
    const result = await verifySurveyCodebookSchema(fakeConnection, 'bloomdent_test');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.indexOk, false);
  });

  console.log(`\n🎉 ${passed}개 테스트 통과`);
}

runAsyncTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
