const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { generateDraftReply, buildPrompt } = require('../services/mockLLM');
const { extractPlainText, extractHtmlText, cleanEmailContent, extractEmailAddress } = require('../utils/emailContent');
const { ensureLabelsExist, applyLabel, removeLabel, getMessagesWithLabel } = require('../utils/gmailLabels');

/**
 * POST /drafts/generate
 * Generates a draft reply for a Gmail message using LLM
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
    const gmail = google.gmail({ version: 'v1', auth: req.oauth2Client });

    // Ensure required labels exist
    await ensureLabelsExist(gmail, ['LLM-Review', 'Send-Now']);

    // Fetch full email from Gmail
    const messageResponse = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const message = messageResponse.data;
    const payload = message.payload;
    const headers = payload.headers || [];

    // Extract email metadata
    let subject = '';
    let fromEmail = '';
    let toEmail = req.user.email; // Reply to the authenticated user's email
    let threadId = message.threadId || null;

    for (const header of headers) {
      if (header.name === 'Subject') {
        subject = header.value || '';
      } else if (header.name === 'From') {
        fromEmail = header.value || '';
      } else if (header.name === 'To') {
        toEmail = header.value || req.user.email;
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
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Could not extract email body content'
      });
    }

    // Clean email content
    const cleanedBody = cleanEmailContent(emailBody, 5000);

    // Build prompt and generate draft reply using mock LLM
    const prompt = buildPrompt(cleanedBody, subject, fromEmail);
    const draftBody = await generateDraftReply(cleanedBody, subject, fromEmail);

    // Extract reply-to email address
    const replyToEmail = extractEmailAddress(fromEmail);
    if (!replyToEmail) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Could not extract sender email address'
      });
    }

    // Create reply subject (add Re: if not present)
    const replySubject = subject.startsWith('Re:') || subject.startsWith('RE:') 
      ? subject 
      : `Re: ${subject}`;

    // Create Gmail draft
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
      `INSERT INTO drafts (user_id, draft_id, thread_id, subject, to_emails, body_text, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, draft_id) 
       DO UPDATE SET 
         thread_id = EXCLUDED.thread_id,
         subject = EXCLUDED.subject,
         to_emails = EXCLUDED.to_emails,
         body_text = EXCLUDED.body_text,
         status = EXCLUDED.status,
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        draftId,
        threadId,
        replySubject,
        [replyToEmail],
        draftBody,
        'PENDING_REVIEW'
      ]
    );

    // Log success
    try {
      await pool.query(
        `INSERT INTO logs (user_id, action, endpoint, method, status_code)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, 'draft_generate', '/drafts/generate', 'POST', 200]
      );
    } catch (logError) {
      console.error('Error logging draft generation:', logError);
    }

    return res.json({
      success: true,
      draftId: draftId,
      message: 'Draft generated successfully and labeled for review',
      status: 'PENDING_REVIEW'
    });

  } catch (error) {
    console.error('Error generating draft:', error);

    // Log error
    try {
      await pool.query(
        `INSERT INTO logs (user_id, action, endpoint, method, status_code, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          'draft_generate',
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
      message: 'Failed to generate draft',
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

