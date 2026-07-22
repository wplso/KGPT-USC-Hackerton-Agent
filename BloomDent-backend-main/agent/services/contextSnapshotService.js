const crypto = require('crypto');

const POSITIONS = ['upper', 'lower', 'front'];
const PENDING_STATUSES = ['pending', 'processing'];

const MODEL_NAME_PLACEHOLDER = 'template-only';
const PROMPT_VERSION_PLACEHOLDER = 'v0';

const DIAGNOSIS_DISCLAIMER =
  '이 내용은 AI가 사진과 설문을 바탕으로 정리한 참고 정보이며 확정 진단이 아닙니다. 정확한 진단과 치료 계획은 반드시 치과에서 임상 검사를 받아 확인해야 합니다.';

// image_analysis에 같은 position(image_type)의 중복 행이 있을 때
// (analyzed_at, id) 오름차순으로 정렬한 뒤 마지막 값으로 덮어써 결정론적으로 최신 1건만 남긴다.
function pickLatestPerPosition(imageAnalysisRows) {
  const sorted = [...(imageAnalysisRows || [])].sort((a, b) => {
    const aTime = new Date(a.analyzed_at).getTime();
    const bTime = new Date(b.analyzed_at).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return a.id - b.id;
  });

  const byPosition = new Map();
  for (const row of sorted) {
    byPosition.set(row.image_type, row);
  }
  return byPosition;
}

// 3-position dental_images 조회 결과 + image_analysis 조회 결과를 바탕으로
// 이번 요청이 어떤 상태(ready/waiting/failed/not_found)인지 판정한다. DB 접근 없는 순수 함수.
function decideReadiness({
  authUserId,
  imageRows,
  imageAnalysisRows,
  requestedSurveySessionId,
  surveyResponseRows,
}) {
  if (!imageRows || imageRows.length === 0) {
    return { status: 'history_not_found' };
  }

  const ownedByOther = imageRows.some((row) => Number(row.user_id) !== Number(authUserId));
  if (ownedByOther) {
    // 존재하지만 다른 사용자 소유인 경우도 미존재와 동일하게 응답해 존재 여부를 숨긴다.
    return { status: 'history_not_found' };
  }

  const byPosition = new Map(imageRows.map((row) => [row.position, row]));

  const missingPosition = POSITIONS.some((position) => !byPosition.has(position));
  if (missingPosition) {
    return { status: 'waiting_for_analysis' };
  }

  const hasPending = POSITIONS.some((position) =>
    PENDING_STATUSES.includes(byPosition.get(position).analysis_status)
  );
  if (hasPending) {
    return { status: 'waiting_for_analysis' };
  }

  const hasFailed = POSITIONS.some((position) => byPosition.get(position).analysis_status === 'failed');
  if (hasFailed) {
    return { status: 'analysis_failed' };
  }

  const latestAnalysisByPosition = pickLatestPerPosition(imageAnalysisRows);
  const missingAnalysis = POSITIONS.some((position) => !latestAnalysisByPosition.has(position));
  if (missingAnalysis) {
    return { status: 'waiting_for_analysis' };
  }

  if (requestedSurveySessionId && (!surveyResponseRows || surveyResponseRows.length === 0)) {
    return { status: 'survey_session_not_found' };
  }

  return { status: 'ready', imagesByPosition: latestAnalysisByPosition };
}

function buildInitialMessage(images) {
  const flagged = images.filter(
    (image) => image.cavity_detected === true || (image.occlusion_status && image.occlusion_status !== 'normal')
  );

  if (flagged.length > 0) {
    return {
      text: `사진 분석 결과 추가 확인이 필요한 소견이 있어요. ${DIAGNOSIS_DISCLAIMER}`,
      evidence: flagged.map((image) => ({
        source_type: 'image_analysis',
        position: image.position,
        confidence: image.ai_confidence,
      })),
    };
  }

  return {
    text: `사진 분석 결과 특별한 소견은 발견되지 않았어요. 정기적인 검진은 계속 권장드립니다. ${DIAGNOSIS_DISCLAIMER}`,
    evidence: [],
  };
}

function buildContextSnapshot({
  historyId,
  surveySessionId,
  imagesByPosition,
  surveyResponseRows,
  generatedAt,
}) {
  const images = POSITIONS.map((position) => {
    const row = imagesByPosition.get(position);
    return {
      position,
      occlusion_status: row.occlusion_status,
      cavity_detected: !!row.cavity_detected,
      cavity_locations: row.cavity_locations ?? null,
      overall_score: row.overall_score,
      recommendations: row.recommendations,
      ai_confidence: row.ai_confidence,
      llm_summary: row.llm_summary ?? null,
    };
  });

  const survey = surveySessionId
    ? {
        survey_session_id: surveySessionId,
        responses: (surveyResponseRows || []).map((row) => ({ category: row.category, score: row.score })),
      }
    : null;

  return {
    history_id: historyId,
    survey_session_id: surveySessionId || null,
    generated_at: generatedAt || new Date().toISOString(),
    images,
    survey,
    initial_message: buildInitialMessage(images),
  };
}

// 객체 키를 재귀적으로 정렬해 삽입 순서에 무관한 canonical 표현을 만든다.
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort();
    const result = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

// generated_at을 제외한 근거 데이터만 해시해 동일한 근거 데이터는 생성 시각과 무관하게 동일 해시가 나오게 한다.
function computeContextHash(contextSnapshot) {
  const { generated_at, ...hashInput } = contextSnapshot;
  return crypto.createHash('sha256').update(canonicalStringify(hashInput)).digest('hex');
}

module.exports = {
  POSITIONS,
  MODEL_NAME_PLACEHOLDER,
  PROMPT_VERSION_PLACEHOLDER,
  pickLatestPerPosition,
  decideReadiness,
  buildInitialMessage,
  buildContextSnapshot,
  canonicalStringify,
  computeContextHash,
};
