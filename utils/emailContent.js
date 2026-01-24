/**
 * Email Content Extraction and Cleaning Utilities
 */

/**
 * Extract text/plain from Gmail message payload
 * @param {Object} payload - Gmail message payload
 * @returns {string|null} Extracted plain text
 */
function extractPlainText(payload) {
  if (!payload) return null;

  // If payload has body with data, decode it
  if (payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  // If payload has parts, recursively search for text/plain
  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain') {
        if (part.body && part.body.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      } else if (part.mimeType === 'text/html' && !extractPlainText(part)) {
        // Fallback to HTML if no plain text found
        if (part.body && part.body.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      } else if (part.parts) {
        // Recursively check nested parts
        const text = extractPlainText(part);
        if (text) return text;
      }
    }
  }

  return null;
}

/**
 * Extract text/html from Gmail message payload
 * @param {Object} payload - Gmail message payload
 * @returns {string|null} Extracted HTML text
 */
function extractHtmlText(payload) {
  if (!payload) return null;

  // If payload has body with data and is HTML
  if (payload.mimeType === 'text/html' && payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  // If payload has parts, recursively search for text/html
  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html') {
        if (part.body && part.body.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      } else if (part.parts) {
        // Recursively check nested parts
        const html = extractHtmlText(part);
        if (html) return html;
      }
    }
  }

  return null;
}

/**
 * Clean email content by removing quoted replies and signatures
 * @param {string} text - Raw email text
 * @param {number} maxLength - Maximum length to return (default: 5000)
 * @returns {string} Cleaned email text
 */
function cleanEmailContent(text, maxLength = 5000) {
  if (!text) return '';

  let cleaned = text;

  // Remove common reply markers
  const replyMarkers = [
    /^On .+ wrote:.*$/gm,
    /^From: .+$/gm,
    /^Sent: .+$/gm,
    /^To: .+$/gm,
    /^Subject: .+$/gm,
    /^>+.*$/gm, // Quoted lines starting with >
    /^-----Original Message-----.*$/gms,
    /^________________________________.*$/gm
  ];

  for (const marker of replyMarkers) {
    cleaned = cleaned.replace(marker, '');
  }

  // Remove signatures (common patterns)
  const signaturePatterns = [
    /^--\s*$/m,
    /^Best regards.*$/gms,
    /^Regards,.*$/gms,
    /^Sincerely,.*$/gms,
    /^Thanks,.*$/gms,
    /^Thank you,.*$/gms
  ];

  for (const pattern of signaturePatterns) {
    const match = cleaned.search(pattern);
    if (match > 0) {
      cleaned = cleaned.substring(0, match).trim();
    }
  }

  // Remove excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/[ \t]+/g, ' ');

  // Limit length
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength) + '...';
  }

  return cleaned.trim();
}

/**
 * Extract email address from "Name <email@example.com>" format
 * @param {string} fromHeader - From header value
 * @returns {string} Email address
 */
function extractEmailAddress(fromHeader) {
  if (!fromHeader) return '';
  
  const match = fromHeader.match(/<([^>]+)>/);
  if (match) {
    return match[1];
  }
  
  // If no angle brackets, assume the whole string is the email
  return fromHeader.trim();
}

module.exports = {
  extractPlainText,
  extractHtmlText,
  cleanEmailContent,
  extractEmailAddress
};

