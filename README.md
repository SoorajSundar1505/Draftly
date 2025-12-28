# Draftly API

A Node.js + Express REST API for Gmail integration with drafts management.

## Features

- ✅ Node.js + Express server
- ✅ PostgreSQL database with schema (users, messages, drafts, logs)
- ✅ Gmail OAuth2 authentication (read + send scopes)
- ✅ Token encryption and automatic refresh
- ✅ API Gateway middleware (authentication, rate limiting)
- ✅ RESTful API endpoints

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- Gmail API credentials (Client ID and Client Secret)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# PostgreSQL Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=draftly
DB_USER=postgres
DB_PASSWORD=your_password

# Gmail OAuth2 Configuration
GMAIL_CLIENT_ID=your_gmail_client_id
GMAIL_CLIENT_SECRET=your_gmail_client_secret
GMAIL_REDIRECT_URI=http://localhost:3000/auth/callback

# Encryption
ENCRYPTION_KEY=your_32_character_encryption_key_here

# Session
SESSION_SECRET=your_session_secret_here
```

**Important:** 
- `ENCRYPTION_KEY` must be exactly 32 characters long
- Generate a secure random string for encryption key

### 3. Set Up PostgreSQL Database

```bash
# Create database
createdb draftly

# Run migrations
npm run migrate
```

### 4. Configure Gmail OAuth2

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable Gmail API
4. Create OAuth 2.0 credentials (Web application)
5. Add authorized redirect URI: `http://localhost:3000/auth/callback`
6. Copy Client ID and Client Secret to `.env` file

## Running the Server

```bash
# Development mode (with nodemon)
npm run dev

# Production mode
npm start
```

## API Endpoints

### Health Check

```
GET /health
```

Returns server health status and database connection status.

### Authentication

#### Initiate Gmail OAuth Flow

```
POST /auth/gmail
```

Returns an authorization URL that the user should visit to grant Gmail access.

**Response:**
```json
{
  "success": true,
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "message": "Please visit the authUrl to authorize Gmail access"
}
```

#### OAuth Callback

```
GET /auth/callback?code=AUTHORIZATION_CODE
```

Handles the OAuth callback, exchanges the code for tokens, and stores encrypted tokens in the database.

**Response:**
```json
{
  "success": true,
  "message": "Gmail authentication successful",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "User Name"
  },
  "token": "1"
}
```

## Database Schema

### Users
- Stores user information and encrypted OAuth tokens

### Messages
- Stores Gmail messages synced from user's account

### Drafts
- Stores draft emails

### Logs
- Stores API request logs for monitoring and debugging

## Security Features

- Token encryption using AES-256-GCM
- Automatic token refresh
- Rate limiting on all endpoints
- Helmet.js for security headers
- CORS configuration

## Project Structure

```
draftly/
├── config/
│   ├── database.js      # PostgreSQL connection
│   ├── encryption.js    # Token encryption/decryption
│   └── gmail.js         # Gmail OAuth2 configuration
├── database/
│   └── schema.sql       # Database schema
├── middleware/
│   ├── auth.js          # Authentication middleware
│   ├── rateLimit.js     # Rate limiting middleware
│   └── logger.js        # Request logging middleware
├── routes/
│   ├── auth.js          # Authentication routes
│   └── health.js        # Health check route
├── scripts/
│   └── migrate.js       # Database migration script
├── server.js            # Main server file
└── package.json
```

## Development

The server runs on `http://localhost:3000` by default.

## License

ISC

