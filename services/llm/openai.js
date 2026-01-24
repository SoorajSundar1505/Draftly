/**
 * OpenAI LLM Provider
 */
require('dotenv').config();

let openaiClient = null;

/**
 * Initialize OpenAI client
 */
function initialize() {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required for OpenAI provider');
  }

  try {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({
      apiKey: apiKey
    });
    
    console.log('✅ OpenAI client initialized');
    return true;
  } catch (error) {
    console.error('Failed to initialize OpenAI client:', error);
    throw new Error(`OpenAI initialization failed: ${error.message}`);
  }
}

/**
 * Generate a draft reply using OpenAI
 * @param {string} emailBody - Cleaned email body text
 * @param {string} subject - Email subject
 * @param {string} fromEmail - Sender email address
 * @returns {Promise<string>} Generated draft reply text
 */
async function generateDraftReply(emailBody, subject, fromEmail) {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized');
  }

  const maxBodyLength = 2000;
  const truncatedBody = emailBody.length > maxBodyLength 
    ? emailBody.substring(0, maxBodyLength) + '...' 
    : emailBody;

  const prompt = `You are a professional email assistant. Generate a concise, professional email reply.

Original Email:
From: ${fromEmail || 'Unknown'}
Subject: ${subject || 'No Subject'}
Body: ${truncatedBody}

Requirements:
- Professional and courteous tone
- Acknowledge the original message briefly
- Keep response concise (2-4 sentences)
- Do NOT include quoted text from the original email
- Do NOT include signatures or closing phrases like "Best regards" (the email client will add these)
- Focus on being helpful and addressing the sender's question or request

Generate only the email body text:`;

  try {
    const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
    const maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS || '200', 10);

    const response = await openaiClient.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: 'You are a professional email assistant that generates concise, helpful email replies.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
      top_p: 1,
      frequency_penalty: 0.5, // Discourage repetition
      presence_penalty: 0.5
    });

    const draftText = response.choices[0]?.message?.content?.trim() || '';
    
    if (!draftText) {
      throw new Error('OpenAI returned empty response');
    }

    // Clean up the response (remove any quotes or extra formatting)
    const cleaned = draftText
      .replace(/^["']|["']$/g, '') // Remove surrounding quotes
      .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines
      .trim();

    return cleaned || 'Thank you for your email. I will review and respond shortly.';
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Error(`Failed to generate draft with OpenAI: ${error.message}`);
  }
}

module.exports = {
  initialize,
  generateDraftReply
};

