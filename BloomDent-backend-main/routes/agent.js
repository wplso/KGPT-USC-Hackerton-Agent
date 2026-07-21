const express = require('express');
const router = express.Router();
const agentDemoAuth = require('../middleware/agentDemoAuth');

router.use(agentDemoAuth);

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
