-- ============================================================================
-- 로컬 개발 DB 전용 — 운영/CI에서 실행 금지
-- ----------------------------------------------------------------------------
-- POST /api/agent/sessions 의 "ready" 경로를 수동(curl)으로 검증하기 위한
-- 더미 데이터. 데모 사용자(AGENT_DEMO_USER_ID=1, .env.example 기준)에게
-- upper/lower/front 3장이 모두 completed + image_analysis 3건이 있는
-- history_id를 만든다.
--
-- 이 파일은 npm run setup-db / migrate:agent 등 정규 스크립트에서 참조되지 않으며
-- 수동으로만 적용한다:
--   mysql -u <user> -p <db> < database/test-fixtures/agent-session-ready.insert.sql
-- 검증이 끝나면 반드시 agent-session-ready.cleanup.sql 로 원복할 것.
-- ============================================================================

SET @agent_fixture_user_id = 1;
SET @agent_fixture_history_id = 'agent-fixture-history-001';

INSERT INTO dental_images
  (user_id, cloudinary_id, cloudinary_url, original_filename, position, image_type, analysis_status, history_id)
VALUES
  (@agent_fixture_user_id, 'agent-fixture/upper', 'https://example.com/agent-fixture-upper.jpg', 'agent-fixture-upper.jpg', 'upper', 'other', 'completed', @agent_fixture_history_id),
  (@agent_fixture_user_id, 'agent-fixture/lower', 'https://example.com/agent-fixture-lower.jpg', 'agent-fixture-lower.jpg', 'lower', 'other', 'completed', @agent_fixture_history_id),
  (@agent_fixture_user_id, 'agent-fixture/front', 'https://example.com/agent-fixture-front.jpg', 'agent-fixture-front.jpg', 'front', 'other', 'completed', @agent_fixture_history_id);

INSERT INTO image_analysis
  (user_id, history_id, cloudinary_url, image_type, uploaded_at, analysis_status,
   occlusion_status, occlusion_comment, cavity_detected,
   cavity_locations, cavity_comment, overall_score, recommendations, ai_confidence)
VALUES
  (@agent_fixture_user_id, @agent_fixture_history_id, 'https://example.com/agent-fixture-upper.jpg', 'upper', CURRENT_TIMESTAMP, 'completed',
   'normal', '교합 상태 양호', FALSE, NULL, NULL, 8.5, '정기검진을 권장합니다.', 0.82),
  (@agent_fixture_user_id, @agent_fixture_history_id, 'https://example.com/agent-fixture-lower.jpg', 'lower', CURRENT_TIMESTAMP, 'completed',
   'normal', '교합 상태 양호', FALSE, NULL, NULL, 8.2, '정기검진을 권장합니다.', 0.80),
  (@agent_fixture_user_id, @agent_fixture_history_id, 'https://example.com/agent-fixture-front.jpg', 'front', CURRENT_TIMESTAMP, 'completed',
   'normal', '교합 상태 양호', FALSE, NULL, NULL, 8.0, '정기검진을 권장합니다.', 0.78);
