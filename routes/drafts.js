const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { publish: publishToPubSub } = require('../services/pubsub');
const { ensureLabelsExist, removeLabel, getMessagesWithLabel } = require('../utils/gmailLabels');

/**
 * POST /drafts/generate
 * Queues a draft generation request via Pub/Sub
 * Body: { "messageId": "<gmail_message_id>" }
 */
router.post('/generate', authenticate, async (req, res) => {
  const userId = req.user.id;
  const { messageId } = req.body;

  if (!messageId) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'messageId is required'
    });
  }

  try {
    // Check for existing draft to prevent duplicates (idempotency)
    const existingDraft = await pool.query(
      `SELECT draft_id, status FROM drafts 
       WHERE user_id = $1 AND message_id = $2 AND status != 'SENT'`,
      [userId, messageId]
    );

    if (existingDraft.rows.length > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A draft for this message already exists and is pending review',
        draftId: existingDraft.rows[0].draft_id,
        status: existingDraft.rows[0].status
      });
    }

    // Verify message exists in our database (optional but good for validation)
    const messageCheck = await pool.query(
      `SELECT message_id FROM messages WHERE user_id = $1 AND message_id = $2`,
      [userId, messageId]
    );

    if (messageCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Message not found. Please sync Gmail messages first using POST /gmail/sync'
      });
    }

    // Publish to Pub/Sub for async processing
    const pubsubMessageId = await publishToPubSub({
      userId: userId,
      messageId: messageId
    });

    // Log request
    try {
      await pool.query(
        `INSERT INTO logs (user_id, action, endpoint, method, status_code)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'draft_generate_queued', '/drafts/generate', 'POST', 200]
      );
    } catch (logError) {
      console.error('Error logging draft generation request:', logError);
    }

    return res.json({
      success: true,
      status: 'QUEUED',
      message: 'Draft generation request queued successfully',
      pubsubMessageId: pubsubMessageId
    });

  } catch (error) {
    console.error('Error queueing draft generation:', error);

    // Log error
    try {
      await pool.query(
        `INSERT INTO logs (user_id, action, endpoint, method, status_code, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          'draft_generate_queued',
          '/drafts/generate',
          'POST',
          500,
          error.message
        ]
      );
    } catch (logError) {
      console.error('Error logging draft generation failure:', logError);
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to queue draft generation',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /drafts/send
 * Sends drafts that have been labeled with "Send-Now"
 */
router.post('/send', authenticate, async (req, res) => {
  const userId = req.user.id;

  try {
    const gmail = google.gmail({ version: 'v1', auth: req.oauth2Client });

    // Get label IDs
    const labels = await ensureLabelsExist(gmail, ['Send-Now']);
    const sendNowLabelId = labels['Send-Now'];

    if (!sendNowLabelId) {
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Send-Now label not found and could not be created'
      });
    }

    // List all drafts for the user
    const draftsResponse = await gmail.users.drafts.list({
      userId: 'me',
      maxResults: 100
    });

    const drafts = draftsResponse.data.drafts || [];

    if (drafts.length === 0) {
      return res.json({
        success: true,
        sent: 0,
        message: 'No drafts found'
      });
    }

    let sentCount = 0;
    const errors = [];

    // Process each draft
    for (const draft of drafts) {
      try {
        // Get the draft message to check its labels
        const draftResponse = await gmail.users.drafts.get({
          userId: 'me',
          id: draft.id,
          format: 'full'
        });

        const draftMessage = draftResponse.data.message;
        const messageLabelIds = draftMessage.labelIds || [];

        // Check if this draft has the Send-Now label
        if (!messageLabelIds.includes(sendNowLabelId)) {
          continue; // Skip drafts without Send-Now label
        }

        // Send the draft
        await gmail.users.drafts.send({
          userId: 'me',
          requestBody: {
            id: draft.id
          }
        });

        // Remove Send-Now label (the message is now sent, so we modify the sent message)
        // Note: After sending, the draft becomes a sent message with a new ID
        // We'll update the database status, but can't remove the label from the draft anymore
        // The label will remain on the sent message, which is acceptable

        // Update database status
        await pool.query(
          `UPDATE drafts 
           SET status = $1, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $2 AND draft_id = $3`,
          ['SENT', userId, draft.id]
        );

        sentCount++;

        // Log success
        try {
          await pool.query(
            `INSERT INTO logs (user_id, action, endpoint, method, status_code)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, 'draft_send', '/drafts/send', 'POST', 200]
          );
        } catch (logError) {
          console.error('Error logging draft send:', logError);
        }

      } catch (draftError) {
        console.error(`Error sending draft ${draft.id}:`, draftError);
        errors.push({
          draftId: draft.id,
          error: draftError.message
        });

        // Log error
        try {
          await pool.query(
            `INSERT INTO logs (user_id, action, endpoint, method, status_code, error_message)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              userId,
              'draft_send',
              '/drafts/send',
              'POST',
              500,
              `Failed to send draft ${draft.id}: ${draftError.message}`
            ]
          );
        } catch (logError) {
          console.error('Error logging draft send failure:', logError);
        }
      }
    }

    return res.json({
      success: true,
      sent: sentCount,
      total: drafts.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Error sending drafts:', error);

    // Log error
    try {
      await pool.query(
        `INSERT INTO logs (user_id, action, endpoint, method, status_code, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          'draft_send',
          '/drafts/send',
          'POST',
          500,
          error.message
        ]
      );
    } catch (logError) {
      console.error('Error logging draft send failure:', logError);
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to send drafts',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

