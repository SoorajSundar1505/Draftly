const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

/**
 * POST /gmail/sync
 * Syncs Gmail messages metadata for the authenticated user.
 * Auth: JWT (Authorization: Bearer <jwt>)
 */
router.post('/sync', authenticate, async (req, res) => {
  const userId = req.user.id;

  try {
    const gmail = google.gmail({ version: 'v1', auth: req.oauth2Client });

    // Fetch a page of messages (metadata only)
    const maxResults = Math.min(
      parseInt(req.body?.maxResults, 10) || 50,
      500
    );

    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: req.body?.query || undefined
    });

    const messageStubs = listResponse.data.messages || [];

    if (messageStubs.length === 0) {
      return res.json({
        success: true,
        inserted: 0,
        message: 'No messages to sync'
      });
    }

    let insertedCount = 0;

    // Use a DB transaction for idempotent inserts
    await pool.query('BEGIN');

    try {
      for (const stub of messageStubs) {
        const { id: messageId, threadId } = stub;

        // Skip if already present (idempotent behaviour)
        const existing = await pool.query(
          'SELECT 1 FROM messages WHERE user_id = $1 AND message_id = $2',
          [userId, messageId]
        );

        if (existing.rowCount > 0) {
          continue;
        }

        // Fetch message metadata only
        const msgResponse = await gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject']
        });

        const data = msgResponse.data;
        const snippet = data.snippet || null;
        const internalDateMs = data.internalDate
          ? parseInt(data.internalDate, 10)
          : null;
        const receivedAt = internalDateMs ? new Date(internalDateMs) : null;

        const headers = (data.payload && data.payload.headers) || [];
        let fromEmail = null;
        let subject = null;

        for (const header of headers) {
          if (header.name === 'From') {
            fromEmail = header.value;
          } else if (header.name === 'Subject') {
            subject = header.value;
          }
        }

        const insertResult = await pool.query(
          `INSERT INTO messages (user_id, message_id, thread_id, subject, from_email, body_text, body_html, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (user_id, message_id) DO NOTHING`,
          [
            userId,
            messageId,
            threadId || null,
            subject,
            fromEmail,
            snippet, // store snippet as body_text when only metadata is fetched
            null,
            receivedAt
          ]
        );

        if (insertResult.rowCount > 0) {
          insertedCount += 1;
        }
      }

      await pool.query('COMMIT');
    } catch (innerErr) {
      await pool.query('ROLLBACK');
      throw innerErr;
    }

    return res.json({
      success: true,
      inserted: insertedCount
    });
  } catch (error) {
    console.error('Error during Gmail sync:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to sync Gmail messages'
    });
  }
});

module.exports = router;


