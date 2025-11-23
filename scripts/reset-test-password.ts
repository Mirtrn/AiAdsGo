#!/usr/bin/env tsx

import Database from 'better-sqlite3'
import bcrypt from 'bcrypt'
import path from 'path'

const dbPath = path.join(process.cwd(), 'data', 'autoads.db')
const db = new Database(dbPath)

const username = 'autoads'
const newPassword = 'test123'

// Hash the new password
const passwordHash = bcrypt.hashSync(newPassword, 10)

// Update the password
const result = db.prepare(`
  UPDATE users
  SET password_hash = ?
  WHERE username = ?
`).run(passwordHash, username)

if (result.changes > 0) {
  console.log(`✅ Password reset successful for user: ${username}`)
  console.log(`   New password: ${newPassword}`)
} else {
  console.log(`❌ User not found: ${username}`)
}

db.close()
