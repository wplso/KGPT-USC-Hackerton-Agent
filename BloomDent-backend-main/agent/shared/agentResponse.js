function agentError(res, statusCode, errorCode, message) {
  return res.status(statusCode).json({ success: false, error_code: errorCode, message });
}

module.exports = { agentError };
