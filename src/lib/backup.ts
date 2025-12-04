import fs from 'fs'
import path from 'path'
import { getDatabase } from './db'

const BACKUP_DIR = path.join(process.cwd(), 'backups')

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
}

export async function performBackup() {
  try {
    const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(BACKUP_DIR, `autoads-backup-${timestamp}.db`)

    // For SQLite, perform file copy; For PostgreSQL, use pg_dump or other backup methods
    // Note: This simple file copy works for SQLite but needs different approach for PostgreSQL
    if (dbPath.endsWith('.db')) {
      fs.copyFileSync(dbPath, backupPath)
      console.log(`✅ Database backup created at ${backupPath}`)
      // Clean up old backups (keep last 7 days)
      cleanOldBackups()
    } else {
      console.log('⚠️ performBackup() only supports SQLite file copy. Use backupDatabase() for full support.')
    }
  } catch (error) {
    console.error('❌ Backup failed:', error)
  }
}

export async function backupDatabase(backupType: 'manual' | 'auto', createdBy?: number): Promise<{
  success: boolean;
  errorMessage?: string;
  backupFilename?: string;
  backupPath?: string;
  fileSizeBytes?: number;
}> {
  const db = await getDatabase()

  try {
    const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupFilename = `autoads-backup-${backupType}-${timestamp}.db`
    const backupPath = path.join(BACKUP_DIR, backupFilename)

    // For SQLite, use file copy; For PostgreSQL, this would need pg_dump
    if (dbPath.endsWith('.db')) {
      fs.copyFileSync(dbPath, backupPath)
    } else {
      throw new Error('Database backup for PostgreSQL not yet implemented')
    }

    console.log(`✅ Database backup created at ${backupPath}`)
    cleanOldBackups()

    // Get file size
    const stats = fs.statSync(backupPath)

    // Log to backup_logs table
    await db.exec(`
      INSERT INTO backup_logs (backup_type, status, backup_filename, backup_path, file_size_bytes, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [backupType, 'success', backupFilename, backupPath, stats.size, createdBy || null])

    return {
      success: true,
      backupFilename,
      backupPath,
      fileSizeBytes: stats.size
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('❌ Backup failed:', errorMessage)

    // Log failure to backup_logs table
    try {
      await db.exec(`
        INSERT INTO backup_logs (backup_type, status, error_message, created_by)
        VALUES (?, ?, ?, ?)
      `, [backupType, 'failed', errorMessage, createdBy || null])
    } catch (logError) {
      console.error('Failed to log backup failure:', logError)
    }

    return { success: false, errorMessage }
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
