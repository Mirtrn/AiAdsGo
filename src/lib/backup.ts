/**
 * 数据库备份核心逻辑
 * 功能: 复制SQLite数据库文件并记录备份日志
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
const backupDir = process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups')
const maxBackupDays = parseInt(process.env.MAX_BACKUP_DAYS || '30')

export interface BackupResult {
  success: boolean
  backupFilename?: string
  backupPath?: string
  fileSizeBytes?: number
  errorMessage?: string
}

/**
 * 执行数据库备份
 * @param backupType 备份类型: auto(自动) 或 manual(手动)
 */
export async function backupDatabase(backupType: 'auto' | 'manual' = 'auto'): Promise<BackupResult> {
  console.log(`\n🔄 开始${backupType === 'auto' ? '自动' : '手动'}备份数据库...`)
  console.log('📍 数据库路径:', dbPath)
  console.log('📂 备份目录:', backupDir)

  try {
    // 检查数据库文件是否存在
    if (!fs.existsSync(dbPath)) {
      throw new Error('数据库文件不存在')
    }

    // 确保备份目录存在
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true })
      console.log('✅ 备份目录已创建')
    }

    // 生成备份文件名: autoads_backup_YYYYMMDD_HHMMSS.db
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .split('.')[0]
    const backupFilename = `autoads_backup_${timestamp}.db`
    const backupPath = path.join(backupDir, backupFilename)

    console.log('📝 备份文件:', backupFilename)

    // 复制数据库文件
    fs.copyFileSync(dbPath, backupPath)

    // 获取备份文件大小
    const stats = fs.statSync(backupPath)
    const fileSizeBytes = stats.size

    console.log(`✅ 备份文件已创建: ${(fileSizeBytes / 1024).toFixed(2)} KB`)

    // 记录备份日志到数据库
    const db = new Database(dbPath)
    try {
      db.prepare(`
        INSERT INTO backup_logs (
          backup_filename, backup_path, file_size_bytes, status, backup_type
        ) VALUES (?, ?, ?, ?, ?)
      `).run(backupFilename, backupPath, fileSizeBytes, 'success', backupType)

      console.log('✅ 备份日志已记录')
    } finally {
      db.close()
    }

    // 清理过期备份
    await cleanupOldBackups()

    console.log('✅ 数据库备份完成!\n')

    return {
      success: true,
      backupFilename,
      backupPath,
      fileSizeBytes,
    }

  } catch (error: any) {
    console.error('❌ 备份失败:', error.message)

    // 记录失败日志(如果数据库可访问)
    try {
      const db = new Database(dbPath)
      db.prepare(`
        INSERT INTO backup_logs (
          backup_filename, backup_path, file_size_bytes, status, error_message, backup_type
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run('', '', 0, 'failed', error.message, backupType)
      db.close()
    } catch (logError) {
      console.error('⚠️  无法记录备份失败日志:', logError)
    }

    return {
      success: false,
      errorMessage: error.message,
    }
  }
}

/**
 * 清理超过保留天数的备份文件
 */
export async function cleanupOldBackups(): Promise<void> {
  console.log(`\n🧹 清理超过${maxBackupDays}天的备份文件...`)

  try {
    if (!fs.existsSync(backupDir)) {
      return
    }

    const files = fs.readdirSync(backupDir)
    const now = Date.now()
    const maxAge = maxBackupDays * 24 * 60 * 60 * 1000 // 转换为毫秒

    let deletedCount = 0

    for (const file of files) {
      if (!file.startsWith('autoads_backup_')) {
        continue
      }

      const filePath = path.join(backupDir, file)
      const stats = fs.statSync(filePath)
      const age = now - stats.mtimeMs

      if (age > maxAge) {
        fs.unlinkSync(filePath)
        deletedCount++
        console.log(`   🗑️  删除过期备份: ${file}`)
      }
    }

    if (deletedCount > 0) {
      console.log(`✅ 已删除${deletedCount}个过期备份文件`)
    } else {
      console.log('✅ 无过期备份文件')
    }

  } catch (error: any) {
    console.error('⚠️  清理过期备份失败:', error.message)
  }
}

/**
 * 获取备份历史
 * @param limit 返回数量限制
 */
export function getBackupHistory(limit: number = 30): any[] {
  const db = new Database(dbPath)
  try {
    const backups = db.prepare(`
      SELECT * FROM backup_logs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit)
    return backups
  } finally {
    db.close()
  }
}
