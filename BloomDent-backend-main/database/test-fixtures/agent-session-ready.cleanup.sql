-- ============================================================================
-- 로컬 개발 DB 전용 — 운영/CI에서 실행 금지
-- ----------------------------------------------------------------------------
-- agent-session-ready.insert.sql 로 추가한 더미 데이터와, 그걸로 생성됐을 수 있는
-- agent_sessions 행을 원복한다.
--   mysql -u <user> -p <db> < database/test-fixtures/agent-session-ready.cleanup.sql
-- ============================================================================

SET @agent_fixture_user_id = 1;
SET @agent_fixture_history_id = 'agent-fixture-history-001';

DELETE FROM agent_sessions WHERE user_id = @agent_fixture_user_id AND history_id = @agent_fixture_history_id;
DELETE FROM image_analysis WHERE user_id = @agent_fixture_user_id AND history_id = @agent_fixture_history_id;
DELETE FROM dental_images WHERE user_id = @agent_fixture_user_id AND history_id = @agent_fixture_history_id;
