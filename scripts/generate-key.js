const crypto = require('crypto');

// Generate a 32-character encryption key
const key = crypto.randomBytes(16).toString('hex');

console.log('\n🔐 Generated Encryption Key:');
console.log('ENCRYPTION_KEY=' + key);
console.log('\n⚠️  Add this to your .env file');
console.log('⚠️  Keep this key secure and never commit it to version control\n');

