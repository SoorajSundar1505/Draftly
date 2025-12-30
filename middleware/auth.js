const pool = require('../config/database');
const { encrypt, decrypt } = require('../config/encryption');
const { refreshAccessToken, createOAuth2Client } = require('../config/gmail');
const jwt = require('jsonwebtoken');

/**
 * Middleware to authenticate requests using JWT and attach a Gmail OAuth2 client.
 * Expects Authorization header: Bearer <jwt>
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header'
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();

    let payload;
    try {
      payload = jwt.verify(token, process.env.SESSION_SECRET);
    } catch (err) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired session token'
      });
    }

    const userId = payload.userId;

    // Load user and encrypted Gmail tokens
    const userResult = await pool.query(
      'SELECT id, email, encrypted_access_token, encrypted_refresh_token, token_expiry FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    // Check if Gmail access token needs refresh
    const now = new Date();
    const tokenExpiry = user.token_expiry ? new Date(user.token_expiry) : null;

    if (tokenExpiry && tokenExpiry <= now) {
      try {
        const refreshToken = decrypt(user.encrypted_refresh_token);
        const newTokens = await refreshAccessToken(refreshToken);

        const newExpiry = newTokens.expiry_date
          ? new Date(newTokens.expiry_date)
          : new Date(Date.now() + 3600000); // fallback 1 hour

        await pool.query(
          `UPDATE users 
           SET encrypted_access_token = $1, 
               encrypted_refresh_token = $2,
               token_expiry = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4`,
          [
            encrypt(newTokens.access_token),
            encrypt(newTokens.refresh_token || refreshToken),
            newExpiry,
            userId
          ]
        );

        // Keep in-memory copy in sync
        user.encrypted_access_token = encrypt(newTokens.access_token);
        user.encrypted_refresh_token = encrypt(newTokens.refresh_token || refreshToken);
        user.token_expiry = newExpiry;
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Token refresh failed. Please re-authenticate.'
        });
      }
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email
    };

    // Attach OAuth2 client for Gmail API calls
    const accessToken = decrypt(user.encrypted_access_token);
    const refreshToken = decrypt(user.encrypted_refresh_token);
    req.oauth2Client = createOAuth2Client(accessToken, refreshToken);

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed'
    });
  }
}

module.exports = {
  authenticate
};

