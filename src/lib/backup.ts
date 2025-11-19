import fs from 'fs'
import path from 'path'
import { getDatabase } from './db'

const BACKUP_DIR = path.join(process.cwd(), 'backups')

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
}

export function performBackup() {
  try {
    const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(BACKUP_DIR, `autoads-backup-${timestamp}.db`)

    // Use SQLite's backup API if available, or file copy
    // Better-sqlite3 has a backup method
    const db = getDatabase()
    db.backup(backupPath)
      .then(() => {
        console.log(`✅ Database backup created at ${backupPath}`)
        // Clean up old backups (keep last 7 days)
        cleanOldBackups()
      })
      .catch((err) => {
        console.error('❌ Backup failed:', err)
      })

  } catch (error) {
    console.error('❌ Backup initiation failed:', error)
  }
}

function cleanOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
    const now = Date.now()
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

    files.forEach(file => {
      const filePath = path.join(BACKUP_DIR, file)
      const stats = fs.statSync(filePath)
      if (now - stats.mtimeMs > SEVEN_DAYS) {
        fs.unlinkSync(filePath)
        console.log(`🗑️ Deleted old backup: ${file}`)
      }
    })
  } catch (error) {
    console.error('⚠️ Failed to clean old backups:', error)
  }
}

// Simple daily scheduler (if running in long-lived process)
// For Next.js serverless/edge, this might need to be triggered by an external cron or API route
let backupInterval: NodeJS.Timeout | null = null

export function startBackupScheduler() {
  if (backupInterval) return

  // Check every hour if it's time to backup (e.g., 3 AM)
  backupInterval = setInterval(() => {
    const now = new Date()
    if (now.getHours() === 3 && now.getMinutes() === 0) {
      performBackup()
    }
  }, 60 * 1000) // Check every minute

  console.log('⏰ Backup scheduler started')
}
