/**
 * Mock LLM Service
 * Placeholder for actual LLM integration
 * Returns a simple generated reply based on the email content
 */

/**
 * Generate a draft reply using mock LLM
 * @param {string} originalEmailBody - The original email body text
 * @param {string} originalSubject - The original email subject
 * @param {string} fromEmail - The sender's email address
 * @returns {Promise<string>} Generated draft reply text
 */
async function generateDraftReply(originalEmailBody, originalSubject, fromEmail) {
  // Simulate async LLM call delay
  await new Promise(resolve => setTimeout(resolve, 500));

  // Mock response - in production, this would call an actual LLM API
  const cleanedBody = originalEmailBody || '';
  const bodyPreview = cleanedBody.substring(0, 200);
  
  const draftText = `Thank you for your email${originalSubject ? ` regarding "${originalSubject}"` : ''}.

${bodyPreview ? `I've reviewed your message${bodyPreview.length < cleanedBody.length ? ' (truncated)' : ''}.` : ''}

I'll get back to you with more details soon.

Best regards`;

  return draftText;
}

/**
 * Build a controlled prompt for LLM
 * @param {string} emailBody - Original email body
 * @param {string} subject - Email subject
 * @param {string} fromEmail - Sender email
 * @returns {string} Formatted prompt
 */
function buildPrompt(emailBody, subject, fromEmail) {
  return `Generate a professional email reply to:
From: ${fromEmail || 'Unknown'}
Subject: ${subject || 'No Subject'}
Body: ${emailBody.substring(0, 1000) || 'No content'}

Requirements:
- Professional and courteous tone
- Acknowledge the original message
- Keep it concise (2-3 sentences)
- Do not include quoted text`;
}

module.exports = {
  generateDraftReply,
  buildPrompt
};

