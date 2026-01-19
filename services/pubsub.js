/**
 * Pub/Sub Service Abstraction
 * Supports Google Cloud Pub/Sub with local fallback for development
 */
require('dotenv').config();

let pubsubClient = null;
let topic = null;
let subscription = null;

// Local in-memory queue for development (fallback)
const localQueue = [];
const localSubscribers = [];

/**
 * Initialize Pub/Sub client
 * Uses Google Cloud Pub/Sub if credentials are available, otherwise falls back to local queue
 */
async function initialize() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const topicName = process.env.PUBSUB_TOPIC || 'draft-generation';
  const subscriptionName = process.env.PUBSUB_SUBSCRIPTION || 'draft-generation-sub';

  // Check if we should use Google Cloud Pub/Sub
  if (projectId && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const { PubSub } = require('@google-cloud/pubsub');
      pubsubClient = new PubSub({ projectId });
      
      // Get or create topic
      topic = pubsubClient.topic(topicName);
      const [topicExists] = await topic.exists();
      if (!topicExists) {
        [topic] = await pubsubClient.createTopic(topicName);
        console.log(`✅ Created Pub/Sub topic: ${topicName}`);
      } else {
        console.log(`✅ Using existing Pub/Sub topic: ${topicName}`);
      }

      // Get or create subscription
      subscription = topic.subscription(subscriptionName);
      const [subExists] = await subscription.exists();
      if (!subExists) {
        [subscription] = await topic.createSubscription(subscriptionName);
        console.log(`✅ Created Pub/Sub subscription: ${subscriptionName}`);
      } else {
        console.log(`✅ Using existing Pub/Sub subscription: ${subscriptionName}`);
      }

      console.log('📡 Using Google Cloud Pub/Sub');
      return true;
    } catch (error) {
      console.warn('⚠️  Failed to initialize Google Cloud Pub/Sub, falling back to local queue:', error.message);
      console.log('📦 Using local in-memory queue (development mode)');
      return false;
    }
  } else {
    console.log('📦 Using local in-memory queue (development mode)');
    console.log('   Set GOOGLE_CLOUD_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS to use Google Cloud Pub/Sub');
    return false;
  }
}

/**
 * Publish a message to the topic
 * @param {Object} data - Message data to publish
 * @returns {Promise<string>} Message ID
 */
async function publish(data) {
  const messageData = {
    userId: data.userId,
    messageId: data.messageId,
    timestamp: new Date().toISOString()
  };

  if (pubsubClient && topic) {
    // Use Google Cloud Pub/Sub
    try {
      const messageId = await topic.publishMessage({
        json: messageData
      });
      console.log(`📤 Published message to Pub/Sub: ${messageId}`);
      return messageId;
    } catch (error) {
      console.error('Error publishing to Pub/Sub:', error);
      throw new Error(`Failed to publish message: ${error.message}`);
    }
  } else {
    // Use local queue
    const messageId = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    localQueue.push({
      id: messageId,
      data: messageData,
      ackId: messageId
    });
    
    // Notify subscribers
    localSubscribers.forEach(callback => {
      setImmediate(() => {
        try {
          callback(localQueue[localQueue.length - 1]);
        } catch (err) {
          console.error('Error in local subscriber callback:', err);
        }
      });
    });
    
    console.log(`📤 Published message to local queue: ${messageId}`);
    return messageId;
  }
}

/**
 * Subscribe to messages
 * @param {Function} messageHandler - Function to handle messages: (message) => Promise<void>
 * @returns {Promise<Function>} Function to stop the subscription
 */
async function subscribe(messageHandler) {
  if (pubsubClient && subscription) {
    // Use Google Cloud Pub/Sub
    const messageHandlerWrapper = async (message) => {
      try {
        const data = message.json;
        console.log(`📥 Received message from Pub/Sub: ${message.id}`);
        
        await messageHandler({
          id: message.id,
          data: data,
          ack: () => message.ack(),
          nack: () => message.nack()
        });
      } catch (error) {
        console.error('Error processing Pub/Sub message:', error);
        message.nack(); // Nack on error to retry
      }
    };

    subscription.on('message', messageHandlerWrapper);
    console.log('✅ Subscribed to Pub/Sub topic');

    // Return unsubscribe function
    return () => {
      subscription.removeListener('message', messageHandlerWrapper);
      console.log('🛑 Unsubscribed from Pub/Sub topic');
    };
  } else {
    // Use local queue
    const localHandler = async (message) => {
      try {
        console.log(`📥 Processing message from local queue: ${message.id}`);
        await messageHandler({
          id: message.id,
          data: message.data,
          ack: () => {
            const index = localQueue.findIndex(m => m.id === message.id);
            if (index > -1) {
              localQueue.splice(index, 1);
            }
          },
          nack: () => {
            // For local queue, nack just re-queues the message
            console.log(`⚠️  Message ${message.id} nacked, will be retried`);
          }
        });
      } catch (error) {
        console.error('Error processing local queue message:', error);
        // Re-queue message for retry
        setTimeout(() => {
          localQueue.push(message);
        }, 5000);
      }
    };

    localSubscribers.push(localHandler);
    console.log('✅ Subscribed to local queue');

    // Process existing messages
    setInterval(() => {
      if (localQueue.length > 0) {
        const message = localQueue.shift();
        localHandler(message);
      }
    }, 1000);

    // Return unsubscribe function
    return () => {
      const index = localSubscribers.indexOf(localHandler);
      if (index > -1) {
        localSubscribers.splice(index, 1);
      }
      console.log('🛑 Unsubscribed from local queue');
    };
  }
}

/**
 * Get subscription instance (for advanced usage)
 */
function getSubscription() {
  return subscription;
}

/**
 * Get topic instance (for advanced usage)
 */
function getTopic() {
  return topic;
}

module.exports = {
  initialize,
  publish,
  subscribe,
  getSubscription,
  getTopic
};

