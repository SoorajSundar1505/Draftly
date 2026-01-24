/**
 * Gmail Label Management Utilities
 */

/**
 * Ensure a Gmail label exists, create it if it doesn't
 * @param {Object} gmail - Gmail API client
 * @param {string} labelName - Label name to ensure exists
 * @returns {Promise<string>} Label ID
 */
async function ensureLabelExists(gmail, labelName) {
  try {
    // List all labels
    const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
    const labels = labelsResponse.data.labels || [];

    // Check if label already exists
    const existingLabel = labels.find(label => label.name === labelName);
    if (existingLabel) {
      return existingLabel.id;
    }

    // Create label if it doesn't exist
    const createResponse = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show'
      }
    });

    return createResponse.data.id;
  } catch (error) {
    console.error(`Error ensuring label "${labelName}" exists:`, error);
    throw new Error(`Failed to ensure label "${labelName}" exists: ${error.message}`);
  }
}

/**
 * Ensure multiple labels exist
 * @param {Object} gmail - Gmail API client
 * @param {string[]} labelNames - Array of label names
 * @returns {Promise<Object>} Map of label name to label ID
 */
async function ensureLabelsExist(gmail, labelNames) {
  const labelMap = {};
  
  for (const labelName of labelNames) {
    try {
      const labelId = await ensureLabelExists(gmail, labelName);
      labelMap[labelName] = labelId;
    } catch (error) {
      console.error(`Failed to ensure label "${labelName}":`, error);
      // Continue with other labels even if one fails
    }
  }
  
  return labelMap;
}

/**
 * Apply a label to a message or draft
 * @param {Object} gmail - Gmail API client
 * @param {string} messageId - Message or draft ID
 * @param {string} labelId - Label ID to apply
 * @returns {Promise<void>}
 */
async function applyLabel(gmail, messageId, labelId) {
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [labelId]
      }
    });
  } catch (error) {
    console.error(`Error applying label to message ${messageId}:`, error);
    throw new Error(`Failed to apply label: ${error.message}`);
  }
}

/**
 * Remove a label from a message or draft
 * @param {Object} gmail - Gmail API client
 * @param {string} messageId - Message or draft ID
 * @param {string} labelId - Label ID to remove
 * @returns {Promise<void>}
 */
async function removeLabel(gmail, messageId, labelId) {
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: [labelId]
      }
    });
  } catch (error) {
    console.error(`Error removing label from message ${messageId}:`, error);
    throw new Error(`Failed to remove label: ${error.message}`);
  }
}

/**
 * Get messages with a specific label
 * @param {Object} gmail - Gmail API client
 * @param {string} labelName - Label name to search for
 * @returns {Promise<Array>} Array of message objects
 */
async function getMessagesWithLabel(gmail, labelName) {
  try {
    // First, get the label ID
    const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
    const labels = labelsResponse.data.labels || [];
    const label = labels.find(l => l.name === labelName);
    
    if (!label) {
      return [];
    }

    // Search for messages with this label
    const response = await gmail.users.messages.list({
      userId: 'me',
      labelIds: [label.id],
      maxResults: 100
    });

    return response.data.messages || [];
  } catch (error) {
    console.error(`Error getting messages with label "${labelName}":`, error);
    throw new Error(`Failed to get messages with label: ${error.message}`);
  }
}

module.exports = {
  ensureLabelExists,
  ensureLabelsExist,
  applyLabel,
  removeLabel,
  getMessagesWithLabel
};

