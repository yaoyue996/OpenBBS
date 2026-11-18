'use strict';

/**
 * Reset a user's password from the command line.
 *
 *   npm run reset-password -- <username> [new-password]
 *
 * If no password is given a random one is generated.
 */
const { db } = require('../src/db');
const { generatePassword, hashPassword } = require('../src/passwords');

async function main() {
  const username = String(process.argv[2] || '').trim();
  if (!username) {
    console.error('Usage: npm run reset-password -- <username> [new-password]');
    process.exit(1);
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    console.error(`User "${username}" was not found.`);
    process.exit(1);
  }
  const password = String(process.argv[3] || generatePassword(16));
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  const hash = await hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  console.log('');
  console.log(`  Password reset for ${user.username}`);
  console.log(`  New password: ${password}`);
  console.log('  All sessions for this user have been invalidated.');
  console.log('');
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
