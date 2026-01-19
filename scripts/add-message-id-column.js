/**
 * Migration script to add message_id column to drafts table
 * Run this if you have an existing database without the message_id column
 */
const pool = require('../config/database');

async function addMessageIdColumn() {
  try {
    // Check if column already exists
    const checkResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'drafts' AND column_name = 'message_id'
    `);

    if (checkResult.rows.length > 0) {
      console.log('✅ message_id column already exists in drafts table');
      process.exit(0);
      return;
    }

    // Add message_id column
    await pool.query(`
      ALTER TABLE drafts 
      ADD COLUMN message_id VARCHAR(255)
    `);

    // Add unique constraint on (user_id, message_id)
    // Note: PostgreSQL unique constraints allow NULL values, so we use a partial unique index
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_user_message 
      ON drafts(user_id, message_id) 
      WHERE message_id IS NOT NULL
    `);

    console.log('✅ message_id column added to drafts table successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

addMessageIdColumn();

