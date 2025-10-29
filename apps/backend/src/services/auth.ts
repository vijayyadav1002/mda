import { db } from '../db/index.js';
import bcrypt from 'bcrypt';
import type { FastifyRequest } from 'fastify';

export async function ensureAdminExists() {
  const result = await db.query('SELECT COUNT(*) FROM users WHERE role = $1', ['admin']);
  const count = parseInt(result.rows[0].count, 10);
  
  if (count === 0) {
    console.log('\n⚠️  No admin user found!');
    console.log('Please create an admin user via the GraphQL mutation: createFirstAdmin');
    console.log('Example: mutation { createFirstAdmin(username: "admin", password: "yourpassword") { token user { id username role } } }\n');
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function authenticate(request: FastifyRequest): Promise<any> {
  try {
    await request.jwtVerify();
    return request.user;
  } catch (err) {
    throw new Error('Unauthorized');
  }
}

export async function requireAdmin(request: FastifyRequest): Promise<any> {
  const user = await authenticate(request);
  if (user.role !== 'admin') {
    throw new Error('Admin access required');
  }
  return user;
}
