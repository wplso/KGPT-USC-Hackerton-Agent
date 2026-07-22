-- ============================================================================
-- BloomDent — 문진표 Codebook용 Core 설문 스키마 제한적 확장 (비파괴적 Migration)
-- ----------------------------------------------------------------------------
-- 배경: Agent가 구강검진 문진표(docs/설문.pdf, Codebook 버전
--   oral-health-questionnaire-v1) 1~15번을 기존 Core survey_questions/
--   survey_question_options/user_survey_responses에 그대로 저장한다. 이
--   문진표는 임상 배점이 없으므로 기존 6개 category ENUM 중 어디에도 억지로
--   배정하지 않고, 스코어링 대상이 아님을 명시하는 전용 category 값을
--   추가한다. 또한 user_survey_responses에 문항당 응답 1건만 허용하는
--   무결성 제약을 추가한다.
--
-- 안전 원칙 (CLAUDE.md "Database safety"):
--   * DROP / TRUNCATE / DELETE 없음. 기존 데이터(적용 시점 0행 확인됨)는
--     그대로 보존된다.
--   * category ENUM은 기존 6개 값의 선언 순서를 바꾸지 않고 끝에 1개만
--     추가한다(기존 값의 내부 순번이 바뀌지 않으므로 기존 데이터 의미 불변).
--   * UNIQUE INDEX 추가는 IF NOT EXISTS로 재실행 안전하게 하며, 적용 전
--     database/run-migration.js가 (user_id, survey_session_id,
--     question_number) 중복 여부를 애플리케이션 레벨에서 먼저 조회해
--     하나라도 있으면 이 문장을 실행하지 않고 전체 migration을 중단한다
--     (checkNoDuplicateSurveyResponses). 삭제·자동 병합은 하지 않는다.
--   * 이 파일이 건드리는 컬럼/제약은 정확히 이 2개뿐이며, 그 외 Core
--     테이블/컬럼/라우트는 전혀 변경하지 않는다.
--   * database/run-migration.js의 안전 가드는 이 두 문장과 문자 그대로
--     일치하는 경우만 허용하는 하드코딩된 allowlist를 쓴다(그 외 모든
--     survey_question_options/user_survey_responses ALTER는 계속 차단됨).
-- ============================================================================

ALTER TABLE survey_question_options
  MODIFY COLUMN category
    ENUM('구강관리/양치습관','구치/구강건조','흡연/음주','우식성 식품 섭취','지각과민/불소','구강악습관','비점수 문진')
    NOT NULL COMMENT '카테고리(비점수 문진: 임상 배점 없는 문진, 건강 점수 계산에서 제외)';

ALTER TABLE user_survey_responses
  ADD UNIQUE INDEX IF NOT EXISTS uq_user_survey_response_question
    (user_id, survey_session_id, question_number);
