-- ============================================================================
-- BloomDent -- oral-health-questionnaire-v1 Seed (참고용 정적 스냅샷)
-- ----------------------------------------------------------------------------
-- 이 파일은 agent/catalog/surveyCodebook.js(QUESTIONS)로부터 자동 생성된
-- 감사용/참고용 스냅샷이다. 실제 Seed 실행은 이 파일을 직접 실행하는 것이
-- 아니라 `node database/run-seed.js`(parameterized query, 동일한
-- surveyCodebook.js를 단일 출처로 사용)를 통해서만 수행한다 -- 이 파일과
-- run-seed.js 사이에 내용이 어긋날 가능성 자체를 원천 차단하기 위함이다.
--
-- codebook_version: oral-health-questionnaire-v1
-- codebook_checksum: 52789b5dcfbbb358f90d090f6c2f1e471013d0f7f2f66e25961e39d520fa6c3a
--
-- 안전 원칙: DROP / TRUNCATE / DELETE 없음. survey_questions가 비어있을
-- 때만 INSERT가 유효하며, 이미 다른 콘텐츠가 있으면 run-seed.js가 실행
-- 자체를 거부한다(이 .sql 파일에는 그 가드 로직이 없으므로 직접 실행하지
-- 말 것).
-- ============================================================================

START TRANSACTION;

INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (1, '최근 1년간 구강병 치료나 관리를 목적으로 치과(의)원에 가신 적이 있습니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (2, '현재 당뇨병을 앓고 계십니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (3, '현재 심혈관질환을 앓고 계십니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (4, '최근 3개월 동안, 치아나 잇몸 문제로 혹은 틀니 때문에 음식을 씹는 데에 불편감을 느끼신 적이 있습니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (5, '최근 3개월 동안, 치아가 쑤시거나 욱신거리거나 아픈 적이 있습니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (6, '최근 3개월 동안, 잇몸이 아프거나 피가 난 적이 있습니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (7, '스스로 생각하실 때에 치아와 잇몸 등 귀하의 구강건강이 어떤 편이라고 생각하십니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (8, '치아 닦는 방법을 치과나 보건소에서 배운 적이 있습니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (9, '어제 하루 동안 치아를 몇 번 닦으셨습니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (10, '최근 일주일 동안, 잠자기 직전에 칫솔질을 얼마나 자주 하였습니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (11, '최근 일주일 동안, 치아를 닦을 때 치실 혹은 치간솔을 얼마나 자주 이용하였습니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (12, '현재 사용 중인 치약에 불소가 들어있습니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (13, '하루에 과자, 사탕, 케이크 등 달거나 치아에 끈끈하게 달라붙는 간식을 얼마나 먹습니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (14, '하루에 탄산 및 청량음료(스포츠 음료, 이온 음료, 과일 주스 포함)을 얼마나 마십니까?', 0, TRUE);
INSERT INTO survey_questions (question_number, question_text, max_score, is_active) VALUES (15, '담배를 피우십니까?', 0, TRUE);

INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (1, 1, '예', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (1, 2, '아니오', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (2, 1, '예', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (2, 2, '아니오', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (2, 3, '모르겠다', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (3, 1, '예', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (3, 2, '아니오', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (3, 3, '모르겠다', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (4, 1, '예', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (4, 2, '아니오', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (5, 1, '예', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (5, 2, '아니오', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (6, 1, '예', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (6, 2, '아니오', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (7, 1, '매우 좋음', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (7, 2, '좋음', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (7, 3, '보통', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (7, 4, '나쁨', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (7, 5, '매우 나쁨', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (8, 1, '예', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (8, 2, '아니오', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (9, 1, '1회', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (9, 2, '2회', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (9, 3, '3회', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (9, 4, '4회', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (9, 5, '5회', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (10, 1, '항상 했다(7회)', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (10, 2, '대부분 했다(4~6회)', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (10, 3, '가끔 했다(1~3회)', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (10, 4, '전혀 하지 않았다(0회)', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (11, 1, '항상 했다', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (11, 2, '대부분 했다', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (11, 3, '가끔 했다', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (11, 4, '전혀 하지 않았다', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (11, 5, '치실 혹은 치간솔이 무엇인지 모른다', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (12, 1, '예', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (12, 2, '아니오', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (12, 3, '모르겠다', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (13, 1, '먹지 않음', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (13, 2, '1번', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (13, 3, '2~3번', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (13, 4, '4번 이상', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (13, 5, '모르겠다', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (14, 1, '먹지 않음', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (14, 2, '1번', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (14, 3, '2~3번', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (14, 4, '4번 이상', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (14, 5, '모르겠다', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (15, 1, '전혀 피운 적이 없다', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (15, 2, '현재 피우고 있다', NULL, 0, '비점수 문진');
INSERT INTO survey_question_options (question_number, option_number, option_text, next_question_number, score, category) VALUES (15, 3, '이전에 피웠으나 끊었다', NULL, 0, '비점수 문진');

COMMIT;
