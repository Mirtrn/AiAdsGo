const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'autoads.db');
const db = new Database(dbPath);

async function createUser() {
    const email = 'test@example.com';
    const password = 'password123';
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    try {
        const stmt = db.prepare(`
      INSERT INTO users (email, password_hash, display_name, role, package_type, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

        const info = stmt.run(email, passwordHash, 'Test User', 'admin', 'lifetime', 1);
        console.log(`User created with ID: ${info.lastInsertRowid}`);
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            console.log('User already exists, updating password...');
            const update = db.prepare(`
        UPDATE users SET password_hash = ?, role = 'admin', is_active = 1 WHERE email = ?
      `);
            update.run(passwordHash, email);
            console.log('User updated.');
        } else {
            console.error('Error creating user:', err);
        }
    }
}

createUser();
