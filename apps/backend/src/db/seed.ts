import { db } from './index.js';
import bcrypt from 'bcrypt';

export async function seed() {
  try {
    console.log('Seeding database...');
    
    // Check if any users exist
    const result = await db.query('SELECT COUNT(*) FROM users');
    const count = parseInt(result.rows[0].count, 10);
    
    if (count === 0) {
      // Create default admin user
      const passwordHash = await bcrypt.hash('admin123', 10);
      await db.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
        ['admin', passwordHash, 'admin']
      );
      console.log('Created default admin user (username: admin, password: admin123)');
      console.log('⚠️  Please change the default password immediately!');
    } else {
      console.log('Users already exist, skipping seed');
    }
    
    console.log('Seeding completed');
  } catch (error) {
    console.error('Seeding failed:', error);
    throw error;
  }
}

// Run seed if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => {
      console.log('Done');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
