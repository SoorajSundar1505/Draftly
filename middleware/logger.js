const pool = require('../config/database');

/**
 * Middleware to log API requests
 */
async function logRequest(req, res, next) {
  const startTime = Date.now();
  
  // Override res.json to capture response
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    const duration = Date.now() - startTime;
    logToDatabase(req, res.statusCode, duration, null);
    return originalJson(data);
  };
  
  // Override res.status to capture error status
  const originalStatus = res.status.bind(res);
  res.status = function(code) {
    res.statusCode = code;
    return originalStatus(code);
  };
  
  next();
}

/**
 * Log request to database
 */
async function logToDatabase(req, statusCode, duration, errorMessage) {
  try {
    const userId = req.user?.id || null;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent') || '';
    
    await pool.query(
      `INSERT INTO logs (user_id, action, endpoint, method, status_code, ip_address, user_agent, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        req.route?.path || req.path,
        req.path,
        req.method,
        statusCode,
        ipAddress,
        userAgent,
        errorMessage
      ]
    );
  } catch (error) {
    // Don't fail the request if logging fails
    console.error('Failed to log request:', error);
  }
}

/**
 * Error logging middleware
 */
function logError(err, req, res, next) {
  const startTime = req.startTime || Date.now();
  const duration = Date.now() - startTime;
  
  logToDatabase(req, res.statusCode || 500, duration, err.message);
  next(err);
}

module.exports = {
  logRequest,
  logError
};

