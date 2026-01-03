const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const healthRoutes = require('./routes/health');
const gmailRoutes = require('./routes/gmail');
const draftsRoutes = require('./routes/drafts');
const { apiLimiter } = require('./middleware/rateLimit');
const { logRequest, logError } = require('./middleware/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Request logging
app.use(logRequest);

// Rate limiting
app.use('/api', apiLimiter);

// Routes
app.use('/auth', authRoutes);
app.use('/health', healthRoutes);
app.use('/gmail', gmailRoutes);
app.use('/drafts', draftsRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Draftly API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: {
        gmail: 'POST /auth/gmail',
        callback: 'GET /auth/callback'
      },
      gmail: {
        sync: 'POST /gmail/sync'
      },
      drafts: {
        generate: 'POST /drafts/generate',
        send: 'POST /drafts/send'
      }
    }
  });
});

// Error handling middleware
app.use(logError);
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Draftly API server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;

