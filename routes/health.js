const express = require('express');
const router = express.Router();
const pool = require('../config/database');

/**
 * GET /health
 * Health check endpoint
 */
router.get('/', async (req, res) => {
  try {
    // Check database connection
    await pool.query('SELECT 1');
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      service: 'Draftly API'
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      service: 'Draftly API',
      error: error.message
    });
  }
});

module.exports = router;

