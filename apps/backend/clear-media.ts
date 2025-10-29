import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/mda',
});

async function clearMedia() {
  try {
    const deleteResult = await pool.query('DELETE FROM media_assets');
    console.log(`✓ Deleted ${deleteResult.rowCount} media asset(s)`);
    
    const countResult = await pool.query('SELECT COUNT(*) FROM media_assets');
    console.log(`✓ Media assets remaining: ${countResult.rows[0].count}`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

clearMedia();
