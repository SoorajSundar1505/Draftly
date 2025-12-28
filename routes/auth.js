const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { getAuthUrl, getTokensFromCode } = require('../config/gmail');
const { encrypt } = require('../config/encryption');
const { google } = require('googleapis');
const { authLimiter } = require('../middleware/rateLimit');
const jwt = require('jsonwebtoken');


/**
 * POST /auth/gmail
 * Initiates Gmail OAuth2 flow
 */
router.post('/gmail', authLimiter, async (req, res) => {
  try {
    const authUrl = getAuthUrl();
    res.json({
      success: true,
      authUrl: authUrl,
      message: 'Please visit the authUrl to authorize Gmail access'
    });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate authorization URL'
    });
  }
});

/**
 * GET /auth/callback
 * Handles OAuth2 callback and stores user tokens
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    
    if (error) {
      return res.status(400).json({
        error: 'Authorization failed',
        message: error
      });
    }
    
    if (!code) {
      return res.status(400).json({
        error: 'Missing authorization code',
        message: 'No authorization code provided'
      });
    }
    
    // Exchange code for tokens
    const tokens = await getTokensFromCode(code);
    
    if (!tokens.access_token) {
      return res.status(400).json({
        error: 'Invalid tokens',
        message: 'Failed to obtain access and refresh tokens'
      });
    }
    
    // Get user info from Google
   
    if (!tokens.id_token) {
      return res.status(400).json({
        error: 'Invalid tokens',
        message: 'Missing ID token'
      });
    }
    
    // Decode ID token (NO Google API call)
    const decoded = jwt.decode(tokens.id_token);
    
    const email = decoded.email;
    const name = decoded.name;
    const googleId = decoded.sub;
    
    
    // Encrypt tokens
    const encryptedAccessToken = encrypt(tokens.access_token);
    const encryptedRefreshToken = encrypt(tokens.refresh_token);
    
    // Calculate token expiry (default to 1 hour if not provided)
    const tokenExpiry = tokens.expiry_date 
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600000); // 1 hour from now
    
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR google_id = $2',
      [email, googleId]
    );
    
    let userId;
    
    if (existingUser.rows.length > 0) {
      // Update existing user
      await pool.query(
        `UPDATE users 
         SET name = $1,
             google_id = $2,
             encrypted_access_token = $3,
             encrypted_refresh_token = $4,
             token_expiry = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6`,
        [
          name,
          googleId,
          encryptedAccessToken,
          encryptedRefreshToken,
          tokenExpiry,
          existingUser.rows[0].id
        ]
      );
      userId = existingUser.rows[0].id;
    } else {
      // Create new user
      const result = await pool.query(
        `INSERT INTO users (email, name, google_id, encrypted_access_token, encrypted_refresh_token, token_expiry)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          email,
          name,
          googleId,
          encryptedAccessToken,
          encryptedRefreshToken,
          tokenExpiry
        ]
      );
      userId = result.rows[0].id;
    }
    
    const jwtToken = jwt.sign(
      { userId },
      process.env.SESSION_SECRET,
      { expiresIn: "7d" }
    );
    
    res.json({
      success: true,
      message: "Gmail authentication successful",
      user: {
        id: userId,
        email: email,
        name: name
      },
      token: jwtToken
    });
    
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to complete authentication'
    });
  }
});

router.get("/me", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  const decoded = jwt.verify(token, process.env.SESSION_SECRET);
  res.json(decoded);
});


module.exports = router;

