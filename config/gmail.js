const { google } = require('googleapis');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/auth/callback'
);

// Gmail API scopes
const SCOPES = [
  "openid",
  "email",
  "profile",
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send'
];

/**
 * Get OAuth2 authorization URL
 * @returns {string} Authorization URL
 */
function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from callback
 * @returns {Promise<Object>} Tokens object
 */
async function getTokensFromCode(code) {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
  } catch (error) {
    console.error('Error getting tokens:', error);
    throw new Error('Failed to exchange code for tokens');
  }
}

/**
 * Create OAuth2 client with tokens
 * @param {string} accessToken - Access token
 * @param {string} refreshToken - Refresh token
 * @returns {google.auth.OAuth2Client} OAuth2 client
 */
function createOAuth2Client(accessToken, refreshToken) {
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });
  
  return client;
}

/**
 * Refresh access token
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<Object>} New tokens
 */
async function refreshAccessToken(refreshToken) {
  try {
    const client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );
    
    client.setCredentials({
      refresh_token: refreshToken
    });
    
    const { credentials } = await client.refreshAccessToken();
    return credentials;
  } catch (error) {
    console.error('Error refreshing token:', error);
    throw new Error('Failed to refresh access token');
  }
}

module.exports = {
  getAuthUrl,
  getTokensFromCode,
  createOAuth2Client,
  refreshAccessToken,
  SCOPES
};

