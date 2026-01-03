/**
 * Migration script to add status column to drafts table
 * Run this if you have an existing database without the status column
 */
const pool = require('../config/database');

async function addStatusColumn() {
  try {
    // Check if column already exists
    const checkResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'drafts' AND column_name = 'status'
    `);

    if (checkResult.rows.length > 0) {
      console.log('✅ Status column already exists in drafts table');
      process.exit(0);
      return;
    }

    // Add status column
    await pool.query(`
      ALTER TABLE drafts 
      ADD COLUMN status VARCHAR(50) DEFAULT 'PENDING_REVIEW'
    `);

    console.log('✅ Status column added to drafts table successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

addStatusColumn();

