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
  loadMigrationFiles,
  EXPECTED_AGENT_TABLES,
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

console.log(`\n🎉 ${passed}개 테스트 통과`);
