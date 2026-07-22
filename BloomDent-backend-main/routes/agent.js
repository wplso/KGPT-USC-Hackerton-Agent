const express = require('express');
const router = express.Router();
const agentDemoAuth = require('../middleware/agentDemoAuth');
const sessionController = require('../agent/controllers/sessionController');

router.use(agentDemoAuth);

router.post('/sessions', sessionController.createSession);

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
