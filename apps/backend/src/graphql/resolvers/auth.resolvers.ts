import { db } from '../../db/index.js';
import { hashPassword, verifyPassword } from '../../services/auth.js';
import { logAudit } from '../../services/audit.js';
import type { GraphQLContext } from '../context.js';

export const authQueryResolvers = {
  me: async (_: any, __: any, context: GraphQLContext) => {
    if (!context.user) throw new Error('Unauthorized');

    const result = await db.query(
      'SELECT id, username, role, created_at FROM users WHERE id = $1',
      [context.user.id]
    );

    if (result.rows.length === 0) throw new Error('User not found');

    return {
      id: result.rows[0].id,
      username: result.rows[0].username,
      role: result.rows[0].role,
      createdAt: result.rows[0].created_at.toISOString()
    };
  },

  hasAdminUser: async () => {
    const result = await db.query('SELECT COUNT(*) FROM users WHERE role = $1', ['admin']);
    const adminCount = parseInt(result.rows[0].count, 10);
    return adminCount > 0;
  },

  users: async (_: any, __: any, context: GraphQLContext) => {
    if (!context.user || context.user.role !== 'admin') {
      throw new Error('Admin access required');
    }

    const result = await db.query(
      'SELECT id, username, role, created_at FROM users ORDER BY created_at DESC'
    );

    return result.rows.map(row => ({
      id: row.id,
      username: row.username,
      role: row.role,
      createdAt: row.created_at.toISOString()
    }));
  }
};

export const authMutationResolvers = {
  login: async (_: any, args: { username: string; password: string }, context: GraphQLContext) => {
    const result = await db.query(
      'SELECT * FROM users WHERE username = $1',
      [args.username]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid credentials');
    }

    const user = result.rows[0];
    const valid = await verifyPassword(args.password, user.password_hash);

    if (!valid) {
      throw new Error('Invalid credentials');
    }

    const token = context.reply.jwtSign({
      id: user.id,
      username: user.username,
      role: user.role
    });

    await logAudit(user.id, 'LOGIN', 'user', user.id);

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.created_at.toISOString()
      }
    };
  },

  createFirstAdmin: async (_: any, args: { username: string; password: string }, context: GraphQLContext) => {
    // Check if any admin exists
    const adminCheck = await db.query('SELECT COUNT(*) FROM users WHERE role = $1', ['admin']);
    const adminCount = parseInt(adminCheck.rows[0].count, 10);

    if (adminCount > 0) {
      throw new Error('Admin already exists. Please login.');
    }

    const passwordHash = await hashPassword(args.password);

    const result = await db.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING *',
      [args.username, passwordHash, 'admin']
    );

    const user = result.rows[0];

    const token = context.reply.jwtSign({
      id: user.id,
      username: user.username,
      role: user.role
    });

    await logAudit(user.id, 'CREATE_FIRST_ADMIN', 'user', user.id);

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.created_at.toISOString()
      }
    };
  },

  createUser: async (_: any, args: { username: string; password: string; role: string }, context: GraphQLContext) => {
    if (!context.user || context.user.role !== 'admin') {
      throw new Error('Admin access required');
    }

    if (!['admin', 'editor', 'readonly'].includes(args.role)) {
      throw new Error('Invalid role. Must be admin, editor, or readonly');
    }

    const passwordHash = await hashPassword(args.password);

    const result = await db.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING *',
      [args.username, passwordHash, args.role]
    );

    const user = result.rows[0];

    await logAudit(context.user.id, 'CREATE_USER', 'user', user.id, {
      username: args.username,
      role: args.role
    });

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.created_at.toISOString()
    };
  },

  updateUserRole: async (_: any, args: { id: string; role: string }, context: GraphQLContext) => {
    if (!context.user || context.user.role !== 'admin') {
      throw new Error('Admin access required');
    }

    if (!['admin', 'editor', 'readonly'].includes(args.role)) {
      throw new Error('Invalid role. Must be admin, editor, or readonly');
    }

    if (context.user.id === Number.parseInt(args.id, 10)) {
      throw new Error('Cannot change your own role');
    }

    const result = await db.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
      [args.role, args.id]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = result.rows[0];

    await logAudit(context.user.id, 'UPDATE_USER_ROLE', 'user', user.id, {
      newRole: args.role
    });

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.created_at.toISOString()
    };
  },

  resetPassword: async (_: any, args: { userId: string; newPassword: string }, context: GraphQLContext) => {
    if (!context.user || context.user.role !== 'admin') {
      throw new Error('Admin access required');
    }

    const passwordHash = await hashPassword(args.newPassword);

    const result = await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, args.userId]
    );

    if (result.rowCount === 0) {
      throw new Error('User not found');
    }

    await logAudit(context.user.id, 'RESET_PASSWORD', 'user', Number.parseInt(args.userId, 10));

    return true;
  },

  changeMyPassword: async (_: any, args: { currentPassword: string; newPassword: string }, context: GraphQLContext) => {
    if (!context.user) {
      throw new Error('Unauthorized');
    }

    const userResult = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [context.user.id]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const isValid = await verifyPassword(args.currentPassword, userResult.rows[0].password_hash);

    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    const passwordHash = await hashPassword(args.newPassword);

    await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, context.user.id]
    );

    await logAudit(context.user.id, 'CHANGE_PASSWORD', 'user', context.user.id);

    return true;
  },

  deleteUser: async (_: any, args: { id: string }, context: GraphQLContext) => {
    if (!context.user || context.user.role !== 'admin') {
      throw new Error('Admin access required');
    }

    if (context.user.id === Number.parseInt(args.id, 10)) {
      throw new Error('Cannot delete yourself');
    }

    await db.query('DELETE FROM users WHERE id = $1', [args.id]);

    await logAudit(context.user.id, 'DELETE_USER', 'user', Number.parseInt(args.id, 10));

    return true;
  }
};
