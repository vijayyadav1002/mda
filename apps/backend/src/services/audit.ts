import { db } from '../db/index.js';

export async function logAudit(
  userId: number,
  action: string,
  resourceType: string,
  resourceId?: number,
  details?: any
) {
  await db.query(
    `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, resourceType, resourceId, details ? JSON.stringify(details) : null]
  );
}
