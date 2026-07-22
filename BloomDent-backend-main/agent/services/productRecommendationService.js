const crypto = require('crypto');
const { canonicalStringify } = require('../shared/canonicalJson');
const { CATALOG_VERSION, PRODUCTS } = require('../catalog/hygieneProductCatalog');

// 6A-1 개별 응답 기반 Product Recommendation Service. Context Snapshot v2의
// survey.answers(Allowlist 6개 question_code)와 images[].cavity_detected만
// 입력으로 쓰는 로컬 결정론적 순수 함수다. Gemini/Shopify Adapter를 전혀
// 호출하지 않는다(이 파일에는 그런 import 자체가 없다).
const RULESET_VERSION = 'oral-health-recommendation-v1';

const DISCLAIMER =
  '이 추천은 일반적인 구강 위생 관리를 돕기 위한 참고 정보이며, 특정 질환의 치료나 완치를 보장하지 않습니다. ' +
  '통증이나 출혈 등 증상이 계속되면 반드시 치과에서 진료를 받으세요.';

function getAnswerCode(answers, questionCode) {
  const found = (answers || []).find((a) => a.question_code === questionCode);
  return found ? found.answer_code : null;
}

function buildItem(productKey, reasonCode, rationale, evidence) {
  const product = PRODUCTS[productKey];
  return {
    product_key: productKey,
    display_name: product.display_name,
    quantity: product.default_quantity,
    reason_code: reasonCode,
    rationale,
    evidence,
  };
}

function computeProposalHash({ sessionId, contextHash, items }) {
  const sortedItems = [...items]
    .map((item) => ({ product_key: item.product_key, quantity: item.quantity }))
    .sort((a, b) => (a.product_key < b.product_key ? -1 : a.product_key > b.product_key ? 1 : 0));

  const hashInput = {
    session_id: sessionId,
    context_hash: contextHash,
    catalog_version: CATALOG_VERSION,
    ruleset_version: RULESET_VERSION,
    items: sortedItems,
  };
  return crypto.createHash('sha256').update(canonicalStringify(hashInput)).digest('hex');
}

/**
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.contextHash - session.context_hash(재검증 완료된 값)
 * @param {object} params.contextSnapshot - session.context_snapshot(불변)
 * @returns {{ catalog_version: string, proposal_hash: string, items: object[], disclaimer: string }}
 */
function recommendProducts({ sessionId, contextHash, contextSnapshot }) {
  const answers = contextSnapshot?.survey?.answers || [];
  const images = contextSnapshot?.images || [];
  const cavityPositions = images.filter((image) => image.cavity_detected === true).map((image) => image.position);
  const cavityDetected = cavityPositions.length > 0;

  const items = [];

  // 칫솔: 잇몸 통증/출혈(YES)이면 초미세모, 아니면 일반 부드러운 칫솔(baseline)
  const gumPain = getAnswerCode(answers, 'GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS');
  if (gumPain === 'YES') {
    items.push(
      buildItem(
        'TOOTHBRUSH_ULTRA_SOFT',
        'GENTLE_BRUSHING_SUPPORT',
        '최근 잇몸 통증·출혈이 있었다는 응답에 따라 더 부드러운 칫솔질에 도움이 되는 상품을 제안드립니다. 증상이 계속되면 치과 진료를 받아보세요.',
        [{ source: 'survey_answer', question_code: 'GUM_PAIN_OR_BLEEDING_LAST_3_MONTHS', answer_code: 'YES' }]
      )
    );
  } else {
    items.push(
      buildItem(
        'TOOTHBRUSH_SOFT',
        'GENERAL_DAILY_HYGIENE',
        '일상적인 구강 위생 관리를 위한 기본 칫솔입니다.',
        []
      )
    );
  }

  // 치약: 사진에서 확인이 필요한 소견(cavity_detected)이 우선, 아니면 불소 미사용/모름 응답
  const fluorideStatus = getAnswerCode(answers, 'FLUORIDE_TOOTHPASTE_STATUS');
  if (cavityDetected) {
    items.push(
      buildItem(
        'TOOTHPASTE_FLUORIDE',
        'CAVITY_PREVENTION_SUPPORT',
        '사진 분석에서 추가 확인이 필요한 소견이 있어 일반적인 위생 관리 차원에서 불소 치약을 제안드립니다. 정확한 진단과 치료는 치과에서 확인하세요.',
        cavityPositions.map((position) => ({ source: 'image_analysis', position }))
      )
    );
  } else if (fluorideStatus === 'NO' || fluorideStatus === 'UNKNOWN') {
    items.push(
      buildItem(
        'TOOTHPASTE_FLUORIDE',
        'FLUORIDE_HYGIENE_SUPPORT',
        '현재 사용 중인 치약에 불소가 없거나 확실하지 않다는 응답에 따라 불소 치약을 제안드립니다.',
        [{ source: 'survey_answer', question_code: 'FLUORIDE_TOOTHPASTE_STATUS', answer_code: fluorideStatus }]
      )
    );
  }

  // 치실: 치실/치간솔을 거의 안 쓰거나(NEVER) 무엇인지 모르는 경우(DOES_NOT_KNOW_TOOL)만
  const interdental = getAnswerCode(answers, 'INTERDENTAL_CLEANING_LAST_WEEK');
  if (interdental === 'NEVER' || interdental === 'DOES_NOT_KNOW_TOOL') {
    items.push(
      buildItem(
        'FLOSS_TAPE',
        'INTERDENTAL_CLEANING_SUPPORT',
        '최근 일주일간 치실·치간솔 사용이 거의 없었다는 응답에 따라 치간 관리를 시작하기 좋은 치실을 제안드립니다.',
        [{ source: 'survey_answer', question_code: 'INTERDENTAL_CLEANING_LAST_WEEK', answer_code: interdental }]
      )
    );
  }

  items.sort((a, b) => (a.product_key < b.product_key ? -1 : a.product_key > b.product_key ? 1 : 0));

  return {
    catalog_version: CATALOG_VERSION,
    proposal_hash: computeProposalHash({ sessionId, contextHash, items }),
    items,
    disclaimer: DISCLAIMER,
  };
}

module.exports = {
  RULESET_VERSION,
  DISCLAIMER,
  recommendProducts,
  computeProposalHash,
  // 테스트 노출(순수 헬퍼)
  getAnswerCode,
};
