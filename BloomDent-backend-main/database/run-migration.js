/**
 * database/run-migration.js
 * ----------------------------------------------------------------------------
 * BloomDent Agent 전용 비파괴 Migration 실행기.
 *
 * 설계 근거: docs/BloomDent_Agentic_Copilot_Architecture_Revised_Updated.md §6.1
 * 안전 원칙 (CLAUDE.md "Database safety"):
 *   - setup-database.js(파괴적 전체 초기화)를 절대 사용하지 않는다.
 *   - database/migrations/*.sql 을 파일명 오름차순으로 실행한다.
 *   - 각 파일에 DROP / TRUNCATE / 기존 Core 테이블 ALTER 등 파괴적 구문이
 *     있으면 실행 자체를 거부한다(Fail-safe).
 *   - 실행 후 기대 Agent 테이블 존재 여부를 검증해 출력한다.
 *
 * 사용법:
 *   node database/run-migration.js            # 실행
 *   node database/run-migration.js --dry-run  # 검증만(실행 안 함)
 *   npm run migrate:agent                     # package.json script
 *
 * 필수 환경 변수(config/database.js 와 동일): DB_HOST, DB_PORT, DB_USER,
 *   DB_PASSWORD, DB_NAME
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// 이 Migration 실행기가 존재를 보장하려는 Agent 테이블 목록
const EXPECTED_AGENT_TABLES = [
  'agent_sessions',
  'agent_chat_history',
  'agent_tool_runs',
  'dental_passes',
];

// 절대 허용하지 않는 파괴적 구문 패턴 (대소문자 무시, 주석 제거 후 검사)
const FORBIDDEN_PATTERNS = [
  { re: /\bDROP\s+TABLE\b/i, label: 'DROP TABLE' },
  { re: /\bDROP\s+DATABASE\b/i, label: 'DROP DATABASE' },
  { re: /\bDROP\s+SCHEMA\b/i, label: 'DROP SCHEMA' },
  { re: /\bTRUNCATE\b/i, label: 'TRUNCATE' },
  { re: /\bDELETE\s+FROM\b/i, label: 'DELETE FROM' },
  { re: /\bSET\s+FOREIGN_KEY_CHECKS\b/i, label: 'SET FOREIGN_KEY_CHECKS' },
];

// 기존 Core 테이블: 이 파일들은 새 Agent 테이블만 만들어야 하므로,
// 아래 Core 테이블에 대한 CREATE/ALTER/DROP 은 모두 차단한다.
const CORE_TABLES = [
  'users',
  'dental_clinics',
  'appointment_slots',
  'reservation_survey_questions',
  'appointments',
  'appointment_surveys',
  'dental_images',
  'image_analysis',
  'survey_questions',
  'survey_question_options',
  'user_survey_responses',
  'user_health_scores',
  'score_history',
  'detail_survey',
];

/**
 * SQL 문자열에서 줄/블록 주석을 제거해 구문 검사 오탐을 줄인다.
 */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // /* ... */
    .replace(/--.*$/gm, ' '); // -- ...
}

/**
 * 하나의 Migration SQL 이 안전한지 검사한다.
 * 위반 시 사유 배열을 반환(빈 배열이면 안전).
 */
function findSafetyViolations(rawSql) {
  const sql = stripSqlComments(rawSql);
  const violations = [];

  for (const { re, label } of FORBIDDEN_PATTERNS) {
    if (re.test(sql)) {
      violations.push(`금지된 구문 발견: ${label}`);
    }
  }

  // 기존 Core 테이블을 대상으로 하는 ALTER / DROP / CREATE 차단
  for (const table of CORE_TABLES) {
    const alter = new RegExp(`\\bALTER\\s+TABLE\\s+\`?${table}\`?\\b`, 'i');
    const drop = new RegExp(`\\bDROP\\s+TABLE\\s+(IF\\s+EXISTS\\s+)?\`?${table}\`?\\b`, 'i');
    const create = new RegExp(`\\bCREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?\`?${table}\`?\\b`, 'i');
    if (alter.test(sql)) violations.push(`Core 테이블 변경 시도(ALTER): ${table}`);
    if (drop.test(sql)) violations.push(`Core 테이블 삭제 시도(DROP): ${table}`);
    if (create.test(sql)) violations.push(`Core 테이블 재정의 시도(CREATE): ${table}`);
  }

  return violations;
}

function loadMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migration 디렉터리를 찾을 수 없습니다: ${MIGRATIONS_DIR}`);
  }
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort(); // 001_, 002_ ... 오름차순

  if (files.length === 0) {
    throw new Error('실행할 .sql Migration 파일이 없습니다.');
  }
  return files;
}

async function main(argv = process.argv) {
  const dryRun = argv.includes('--dry-run');

  console.log('🦷 BloomDent Agent Migration 실행기');
  console.log(dryRun ? '   모드: --dry-run (검증만 수행)\n' : '   모드: 실제 적용\n');

  // 1) Migration 파일 로드 + 안전성 검사 (DB 연결 없이 오프라인 검증)
  const files = loadMigrationFiles();
  const loaded = [];
  let hasViolation = false;

  for (const file of files) {
    const full = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(full, 'utf8');
    const violations = findSafetyViolations(sql);
    loaded.push({ file, sql, violations });

    if (violations.length > 0) {
      hasViolation = true;
      console.error(`🚫 ${file} — 안전성 위반:`);
      violations.forEach((v) => console.error(`     - ${v}`));
    } else {
      console.log(`✅ ${file} — 안전성 통과`);
    }
  }
  console.log('');

  if (hasViolation) {
    console.error('❌ 파괴적/Core 변경 구문이 감지되어 Migration을 중단합니다.');
    process.exit(1);
  }

  if (dryRun) {
    console.log('🔎 --dry-run: SQL을 실행하지 않고 검증만 완료했습니다.');
    return;
  }

  // 2) 실제 적용 전 환경 변수 확인
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
    console.error('❌ .env 확인 필요: DB_HOST, DB_USER, DB_NAME 가 필요합니다.');
    process.exit(1);
  }
  console.log('📊 대상 DB:');
  console.log(`   Host: ${process.env.DB_HOST}`);
  console.log(`   Port: ${process.env.DB_PORT || 3306}`);
  console.log(`   Database: ${process.env.DB_NAME}`);
  console.log(`   User: ${process.env.DB_USER}\n`);

  // 3) 실제 적용
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME,
      multipleStatements: true, // 한 파일에 여러 CREATE 문
    });
    console.log('✅ DB 연결 성공\n');

    for (const { file, sql } of loaded) {
      console.log(`🔧 적용 중: ${file}`);
      await connection.query(sql);
      console.log(`   완료: ${file}\n`);
    }

    // 4) 검증: 기대 Agent 테이블 존재 확인
    console.log('📋 Agent 테이블 검증:');
    const [rows] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
      [process.env.DB_NAME, EXPECTED_AGENT_TABLES]
    );
    const present = new Set(rows.map((r) => r.TABLE_NAME));
    let allOk = true;
    for (const t of EXPECTED_AGENT_TABLES) {
      const ok = present.has(t);
      if (!ok) allOk = false;
      console.log(`   ${ok ? '✅' : '❌'} ${t}`);
    }
    console.log('');

    if (!allOk) {
      console.error('❌ 일부 Agent 테이블이 생성되지 않았습니다.');
      process.exit(1);
    }
    console.log('🎉 Agent Migration 적용 및 검증 완료.');
  } catch (error) {
    console.error('\n❌ Migration 실행 중 오류:');
    console.error(error.message);
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('💡 DB_USER / DB_PASSWORD 를 확인하세요.');
    } else if (error.code === 'ENOTFOUND') {
      console.error('💡 DB_HOST 를 확인하세요.');
    }
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

// 직접 실행할 때만 main() 을 호출한다. (require 시에는 순수 함수만 노출)
if (require.main === module) {
  main();
}

module.exports = {
  stripSqlComments,
  findSafetyViolations,
  loadMigrationFiles,
  EXPECTED_AGENT_TABLES,
  CORE_TABLES,
  MIGRATIONS_DIR,
};
