const express = require('express');
const router = express.Router();
const agentDemoAuth = require('../middleware/agentDemoAuth');
const noStoreCache = require('../middleware/noStoreCache');
const sessionController = require('../agent/controllers/sessionController');
const messageController = require('../agent/controllers/messageController');
const dentalPassController = require('../agent/controllers/dentalPassController');

router.use(agentDemoAuth);

router.post('/sessions', sessionController.createSession);
router.post('/sessions/:sessionId/messages', messageController.createMessage);
router.post('/sessions/:sessionId/dental-pass', noStoreCache, dentalPassController.createDentalPass);
router.delete('/dental-passes/:passId', noStoreCache, dentalPassController.revokeDentalPass);
// 공개 Dental Pass 조회(Share Token만, Demo Auth 없음)는 이 라우터에 없다.
// routes/dentalPassPublic.js 를 참고 — server.js가 /api/dental-pass 로 별도 마운트한다.

router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'agent',
    user_id: req.agentUser.id,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
