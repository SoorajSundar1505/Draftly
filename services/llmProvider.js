/**
 * LLM Provider Service
 * Abstracted LLM interface supporting multiple providers (OpenAI, Bedrock, etc.)
 */
require('dotenv').config();

let provider = null;

/**
 * Initialize LLM provider based on environment configuration
 */
function initialize() {
  const providerType = process.env.LLM_PROVIDER || 'openai';

  if (providerType === 'openai') {
    provider = require('./llm/openai');
    console.log('🤖 Using OpenAI LLM provider');
  } else if (providerType === 'bedrock') {
    provider = require('./llm/bedrock');
    console.log('🤖 Using Amazon Bedrock LLM provider');
  } else {
    throw new Error(`Unsupported LLM provider: ${providerType}`);
  }

  return provider.initialize();
}

/**
 * Generate a draft reply using the configured LLM provider
 * @param {string} emailBody - Cleaned email body text
 * @param {string} subject - Email subject
 * @param {string} fromEmail - Sender email address
 * @returns {Promise<string>} Generated draft reply text
 */
async function generateDraftReply(emailBody, subject, fromEmail) {
  if (!provider) {
    throw new Error('LLM provider not initialized. Call initialize() first.');
  }

  return provider.generateDraftReply(emailBody, subject, fromEmail);
}

/**
 * Build a controlled prompt for LLM
 * @param {string} emailBody - Original email body
 * @param {string} subject - Email subject
 * @param {string} fromEmail - Sender email
 * @returns {string} Formatted prompt
 */
function buildPrompt(emailBody, subject, fromEmail) {
  const maxBodyLength = 2000; // Limit input to prevent token overflow
  const truncatedBody = emailBody.length > maxBodyLength 
    ? emailBody.substring(0, maxBodyLength) + '...' 
    : emailBody;

  return `You are a professional email assistant. Generate a concise, professional email reply.

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
}

module.exports = {
  initialize,
  generateDraftReply,
  buildPrompt
};

