const pool = require('../config/database');
const { decrypt } = require('../config/encryption');
const { refreshAccessToken, createOAuth2Client } = require('../config/gmail');
const { encrypt } = require('../config/encryption');

/**
 * Middleware to authenticate requests
 * Expects Authorization header: Bearer <user_id>
 * In production, this should use JWT tokens
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
    
    const userId = authHeader.replace('Bearer ', '');
    
    // Verify user exists
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
    
    // Check if token needs refresh
    const now = new Date();
    const tokenExpiry = user.token_expiry ? new Date(user.token_expiry) : null;
    
    if (tokenExpiry && tokenExpiry <= now) {
      // Token expired, refresh it
      try {
        const refreshToken = decrypt(user.encrypted_refresh_token);
        const newTokens = await refreshAccessToken(refreshToken);
        
        // Update tokens in database
        const newExpiry = new Date(Date.now() + (newTokens.expiry_date - Date.now()));
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
        
        // Update user object with new tokens
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

