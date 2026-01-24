# Draftly API

A production-grade Node.js + Express REST API for asynchronous Gmail draft generation using LLM, with human-in-the-loop approval via Gmail labels.

## Architecture

```
Client → API → Pub/Sub → Worker → LLM → Gmail Draft → Human Review → Send
```

### Key Components

1. **API Server** (`server.js`): Express REST API that handles authentication and queues draft generation requests
2. **Pub/Sub Service** (`services/pubsub.js`): Async message queue (Google Cloud Pub/Sub or local fallback)
3. **Worker Process** (`workers/draftWorker.js`): Background worker that processes draft generation requests
4. **LLM Provider** (`services/llmProvider.js`): Abstracted LLM interface (OpenAI, Bedrock)
5. **Gmail Integration**: OAuth2 authentication, draft creation, label management

### Why Pub/Sub + Async?

- **Scalability**: API responds immediately, heavy processing happens asynchronously
- **Reliability**: Pub/Sub ensures message delivery and retries on failure
- **Separation of Concerns**: API stays responsive, worker handles long-running LLM calls
- **Production-Ready**: Handles high load, failures, and restarts gracefully

## Features

- ✅ **Asynchronous Processing**: Pub/Sub-based queue for draft generation
- ✅ **Real LLM Integration**: OpenAI GPT for intelligent draft replies
- ✅ **Human-in-the-Loop**: Gmail labels (LLM-Review, Send-Now) for approval workflow
- ✅ **Idempotency**: Prevents duplicate drafts for the same message
- ✅ **Token Management**: Automatic Gmail OAuth token refresh
- ✅ **Error Handling**: Comprehensive logging and graceful failure handling
- ✅ **Production-Ready**: Restart-safe worker, retry logic, database transactions

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- Gmail API credentials (Client ID and Client Secret)
- OpenAI API key (for LLM) OR Amazon Bedrock credentials
- (Optional) Google Cloud Project for Pub/Sub

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

# Pub/Sub Configuration (Optional - uses local queue if not set)
GOOGLE_CLOUD_PROJECT_ID=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
PUBSUB_TOPIC=draft-generation
PUBSUB_SUBSCRIPTION=draft-generation-sub

# LLM Configuration
LLM_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-3.5-turbo
OPENAI_MAX_TOKENS=200
```

**Important:** 
- `ENCRYPTION_KEY` must be exactly 32 characters long
- If `GOOGLE_CLOUD_PROJECT_ID` is not set, the system uses a local in-memory queue (development mode)
- Set `LLM_PROVIDER=openai` and provide `OPENAI_API_KEY` for OpenAI integration

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

### 5. (Optional) Set Up Google Cloud Pub/Sub

For production, set up Google Cloud Pub/Sub:

1. Create a Google Cloud Project
2. Enable Pub/Sub API
3. Create a service account with Pub/Sub permissions
4. Download service account key JSON
5. Set `GOOGLE_APPLICATION_CREDENTIALS` to the key file path
6. Set `GOOGLE_CLOUD_PROJECT_ID` to your project ID

If not configured, the system automatically uses a local in-memory queue.

## Running the System

### Start API Server

```bash
# Development mode (with nodemon)
npm run dev

# Production mode
npm start
```

### Start Worker Process

In a separate terminal:

```bash
npm run worker
```

**Important**: The worker must run separately from the API server. In production, run multiple worker instances for scalability.

## API Endpoints

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

Handles the OAuth callback, exchanges the code for tokens, and returns a JWT token.

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
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Gmail Sync

#### Sync Gmail Messages

```
POST /gmail/sync
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "maxResults": 50,
  "query": "in:inbox"
}
```

Syncs Gmail message metadata into the database.

**Response:**
```json
{
  "success": true,
  "inserted": 25
}
```

### Draft Generation

#### Queue Draft Generation

```
POST /drafts/generate
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "messageId": "gmail_message_id_here"
}
```

Queues a draft generation request. Returns immediately with `QUEUED` status.

**Response:**
```json
{
  "success": true,
  "status": "QUEUED",
  "message": "Draft generation request queued successfully",
  "pubsubMessageId": "1234567890"
}
```

**Error Responses:**
- `409 Conflict`: Draft already exists for this message
- `404 Not Found`: Message not found (sync Gmail first)

#### Send Approved Drafts

```
POST /drafts/send
Authorization: Bearer <jwt_token>
```

Sends all drafts that have been labeled with "Send-Now" in Gmail.

**Response:**
```json
{
  "success": true,
  "sent": 3,
  "total": 5
}
```

## Usage Workflow

### 1. Authenticate

```bash
# Get auth URL
curl -X POST http://localhost:3000/auth/gmail

# Visit the authUrl in browser, then get JWT from callback
# Save the JWT token for subsequent requests
```

### 2. Sync Gmail Messages

```bash
curl -X POST http://localhost:3000/gmail/sync \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"maxResults": 50}'
```

### 3. Generate Draft (Queued)

```bash
curl -X POST http://localhost:3000/drafts/generate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messageId": "gmail_message_id"}'
```

The API returns immediately with `QUEUED` status. The worker processes the request asynchronously.

### 4. Review Draft in Gmail

1. Open Gmail
2. Find the draft with label "LLM-Review"
3. Review and edit if needed
4. Apply "Send-Now" label when ready to send

### 5. Send Approved Drafts

```bash
curl -X POST http://localhost:3000/drafts/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

All drafts with "Send-Now" label are sent automatically.

## Database Schema

### Users
- Stores user information and encrypted OAuth tokens

### Messages
- Stores Gmail messages synced from user's account
- Unique constraint: `(user_id, message_id)`

### Drafts
- Stores draft emails with status tracking
- Status values: `PENDING_REVIEW`, `SENT`
- Unique constraint: `(user_id, draft_id)`

### Logs
- Stores API request logs and worker processing logs
- Used for monitoring and debugging

## Project Structure

```
draftly/
├── config/
│   ├── database.js          # PostgreSQL connection
│   ├── encryption.js        # Token encryption/decryption
│   └── gmail.js             # Gmail OAuth2 configuration
├── database/
│   └── schema.sql           # Database schema
├── middleware/
│   ├── auth.js              # JWT authentication middleware
│   ├── rateLimit.js         # Rate limiting middleware
│   └── logger.js            # Request logging middleware
├── routes/
│   ├── auth.js              # Authentication routes
│   ├── gmail.js             # Gmail sync routes
│   ├── drafts.js            # Draft generation/sending routes
│   └── health.js            # Health check route
├── services/
│   ├── pubsub.js            # Pub/Sub abstraction (Google Cloud or local)
│   ├── llmProvider.js       # LLM provider abstraction
│   ├── llm/
│   │   ├── openai.js        # OpenAI implementation
│   │   └── bedrock.js       # Amazon Bedrock (placeholder)
│   └── mockLLM.js           # Mock LLM (legacy, replaced by llmProvider)
├── utils/
│   ├── emailContent.js      # Email extraction and cleaning
│   └── gmailLabels.js       # Gmail label management
├── workers/
│   └── draftWorker.js       # Background worker for draft generation
├── scripts/
│   ├── migrate.js            # Database migration
│   └── add-status-column.js # Status column migration
├── server.js                # Main API server
└── package.json
```

## Security Features

- **Token Encryption**: AES-256-GCM encryption for OAuth tokens
- **Automatic Token Refresh**: Handles expired Gmail tokens automatically
- **JWT Authentication**: Secure token-based API authentication
- **Rate Limiting**: Prevents API abuse
- **Helmet.js**: Security headers
- **CORS Configuration**: Controlled cross-origin access
- **Idempotency**: Prevents duplicate draft generation

## Error Handling

- **API Errors**: Logged to database and returned with appropriate HTTP status codes
- **Worker Errors**: Logged to database, messages nacked for retry
- **LLM Failures**: Gracefully handled, logged, and retried
- **Gmail API Errors**: Token refresh attempted, errors logged

## Production Deployment

### Recommended Setup

1. **API Server**: Deploy to cloud (e.g., Google Cloud Run, AWS ECS)
2. **Worker**: Run as separate service (e.g., Cloud Run Job, ECS Task)
3. **Pub/Sub**: Use Google Cloud Pub/Sub (not local queue)
4. **Database**: Managed PostgreSQL (e.g., Cloud SQL, RDS)
5. **Scaling**: Run multiple worker instances for parallel processing

### Environment Variables for Production

- Set `NODE_ENV=production`
- Use managed database with connection pooling
- Configure Google Cloud Pub/Sub
- Set up monitoring and alerting
- Use secrets management for API keys

## Development

The server runs on `http://localhost:3000` by default.

### Local Development Mode

- Uses local in-memory queue (no Pub/Sub setup needed)
- Mock LLM available (set `LLM_PROVIDER=mock` if needed)
- Hot reload with nodemon

### Testing the Flow

1. Start API: `npm run dev`
2. Start Worker: `npm run worker` (in separate terminal)
3. Authenticate via `/auth/gmail`
4. Sync messages via `/gmail/sync`
5. Generate draft via `/drafts/generate`
6. Check Gmail for draft with "LLM-Review" label
7. Apply "Send-Now" label and call `/drafts/send`

## License

ISC
