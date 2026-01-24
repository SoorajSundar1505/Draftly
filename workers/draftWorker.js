/**
 * Draft Generation Worker
 * Subscribes to Pub/Sub and processes draft generation requests
 */
require('dotenv').config();

const { google } = require('googleapis');
const pool = require('../config/database');
const { decrypt } = require('../config/encryption');
const { refreshAccessToken, createOAuth2Client } = require('../config/gmail');
const { encrypt } = require('../config/encryption');
const { subscribe: subscribeToPubSub, initialize: initializePubSub } = require('../services/pubsub');
const { initialize: initializeLLM, generateDraftReply } = require('../services/llmProvider');
const { extractPlainText, extractHtmlText, cleanEmailContent, extractEmailAddress } = require('../utils/emailContent');
const { ensureLabelsExist, applyLabel } = require('../utils/gmailLabels');

let isShuttingDown = false;

/**
 * Process a draft generation request
 */
async function processDraftGeneration(message) {
  const { userId, messageId } = message.data;
  let messageAcked = false;

  try {
    console.log(`🔄 Processing draft generation: userId=${userId}, messageId=${messageId}`);

    // Load user and tokens
    const userResult = await pool.query(
      'SELECT id, email, encrypted_access_token, encrypted_refresh_token, token_expiry FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error(`User ${userId} not found`);
    }

    const user = userResult.rows[0];

    // Check if token needs refresh
    const now = new Date();
    const tokenExpiry = user.token_expiry ? new Date(user.token_expiry) : null;

    if (tokenExpiry && tokenExpiry <= now) {
      console.log(`🔄 Refreshing token for user ${userId}`);
      const refreshToken = decrypt(user.encrypted_refresh_token);
      const newTokens = await refreshAccessToken(refreshToken);

      const newExpiry = newTokens.expiry_date
        ? new Date(newTokens.expiry_date)
        : new Date(Date.now() + 3600000);

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

      user.encrypted_access_token = encrypt(newTokens.access_token);
      user.encrypted_refresh_token = encrypt(newTokens.refresh_token || refreshToken);
      user.token_expiry = newExpiry;
    }

    // Create OAuth2 client
    const accessToken = decrypt(user.encrypted_access_token);
    const refreshToken = decrypt(user.encrypted_refresh_token);
    const oauth2Client = createOAuth2Client(accessToken, refreshToken);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Check for existing draft (idempotency check)
    const existingDraft = await pool.query(
      `SELECT draft_id, status FROM drafts 
       WHERE user_id = $1 AND message_id = $2 AND status != 'SENT'`,
      [userId, messageId]
    );

    if (existingDraft.rows.length > 0) {
      console.log(`⚠️  Draft already exists for message ${messageId}, skipping`);
      message.ack();
      messageAcked = true;
      return;
    }

    // Ensure required labels exist
    await ensureLabelsExist(gmail, ['LLM-Review', 'Send-Now']);

    // Fetch full email from Gmail
    const messageResponse = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const gmailMessage = messageResponse.data;
    const payload = gmailMessage.payload;
    const headers = payload.headers || [];

    // Extract email metadata
    let subject = '';
    let fromEmail = '';
    let threadId = gmailMessage.threadId || null;

    for (const header of headers) {
      if (header.name === 'Subject') {
        subject = header.value || '';
      } else if (header.name === 'From') {
        fromEmail = header.value || '';
      }
    }

    // Extract email body
    let emailBody = extractPlainText(payload);
    if (!emailBody) {
      // Fallback to HTML if no plain text
      const htmlBody = extractHtmlText(payload);
      if (htmlBody) {
        // Simple HTML to text conversion (remove tags)
        emailBody = htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }

    if (!emailBody) {
      throw new Error('Could not extract email body content');
    }

    // Clean email content
    const cleanedBody = cleanEmailContent(emailBody, 5000);

    // Generate draft reply using LLM
    console.log(`🤖 Generating draft reply with LLM for message ${messageId}`);
    const draftBody = await generateDraftReply(cleanedBody, subject, fromEmail);

    // Extract reply-to email address
    const replyToEmail = extractEmailAddress(fromEmail);
    if (!replyToEmail) {
      throw new Error('Could not extract sender email address');
    }

    // Create reply subject (add Re: if not present)
    const replySubject = subject.startsWith('Re:') || subject.startsWith('RE:') 
      ? subject 
      : `Re: ${subject}`;

    // Create Gmail draft
    console.log(`📝 Creating Gmail draft for message ${messageId}`);
    const draftResponse = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          threadId: threadId,
          raw: Buffer.from(
            `To: ${replyToEmail}\r\n` +
            `Subject: ${replySubject}\r\n` +
            `Content-Type: text/plain; charset=utf-8\r\n` +
            `\r\n` +
            `${draftBody}`
          ).toString('base64')
        }
      }
    });

    const draftId = draftResponse.data.id;
    const createdDraft = draftResponse.data.message;

    // Apply LLM-Review label to the draft
    try {
      const labels = await ensureLabelsExist(gmail, ['LLM-Review']);
      if (labels['LLM-Review']) {
        await applyLabel(gmail, createdDraft.id, labels['LLM-Review']);
      }
    } catch (labelError) {
      console.error('Error applying LLM-Review label:', labelError);
      // Continue even if label application fails
    }

    // Store draft metadata in database
    await pool.query(
      `INSERT INTO drafts (user_id, draft_id, message_id, thread_id, subject, to_emails, body_text, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, message_id) 
       DO UPDATE SET 
         draft_id = EXCLUDED.draft_id,
         thread_id = EXCLUDED.thread_id,
         subject = EXCLUDED.subject,
         to_emails = EXCLUDED.to_emails,
         body_text = EXCLUDED.body_text,
         status = EXCLUDED.status,
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        draftId,
        messageId,
        threadId,
        replySubject,
        [replyToEmail],
        draftBody,
        'PENDING_REVIEW'
      ]
    );

    // Log success
    await pool.query(
      `INSERT INTO logs (user_id, action, endpoint, method, status_code)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, 'draft_generated', 'worker', 'PROCESS', 200]
    );

    console.log(`✅ Draft generated successfully: draftId=${draftId}, messageId=${messageId}`);
    message.ack();
    messageAcked = true;

  } catch (error) {
    console.error(`❌ Error processing draft generation:`, error);

    // Log error
    try {
      await pool.query(
        `INSERT INTO logs (user_id, action, endpoint, method, status_code, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          message.data.userId || null,
          'draft_generation_failed',
          'worker',
          'PROCESS',
          500,
          error.message
        ]
      );
    } catch (logError) {
      console.error('Error logging draft generation failure:', logError);
    }

    // Nack the message to retry (Pub/Sub will redeliver)
    if (!messageAcked) {
      message.nack();
    }
  }
}

/**
 * Initialize and start the worker
 */
async function startWorker() {
  try {
    console.log('🚀 Starting Draft Generation Worker...');

    // Initialize Pub/Sub
    await initializePubSub();

    // Initialize LLM provider
    await initializeLLM();

    // Subscribe to messages
    const unsubscribe = await subscribeToPubSub(processDraftGeneration);

    console.log('✅ Worker started and listening for messages');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down worker...');
      isShuttingDown = true;
      if (unsubscribe) {
        unsubscribe();
      }
      await pool.end();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Shutting down worker...');
      isShuttingDown = true;
      if (unsubscribe) {
        unsubscribe();
      }
      await pool.end();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Failed to start worker:', error);
    process.exit(1);
  }
}

// Start the worker
startWorker();

