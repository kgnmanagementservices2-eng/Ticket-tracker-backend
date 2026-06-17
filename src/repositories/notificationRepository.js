const db = require("../config/db");

const createNotification = async (
  tenantId,
  userId,
  title,
  message,
  type,
  referenceId = null,
) => {
  const query = `
    INSERT INTO notifications (tenant_id, user_id, title, message, type, reference_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;
  const { rows } = await db.query(query, [
    tenantId,
    userId,
    title,
    message,
    type,
    referenceId,
  ]);
  return rows[0];
};

const getUnreadNotifications = async (tenantId, userId) => {
  const query = `
    SELECT * FROM notifications 
    WHERE tenant_id = $1 AND user_id = $2 AND is_read = FALSE
    ORDER BY created_at DESC;
  `;
  const { rows } = await db.query(query, [tenantId, userId]);
  return rows;
};

const markAsRead = async (tenantId, userId, notificationId) => {
  const query = `
    UPDATE notifications 
    SET is_read = TRUE 
    WHERE id = $1 AND tenant_id = $2 AND user_id = $3
    RETURNING *;
  `;
  const { rows } = await db.query(query, [notificationId, tenantId, userId]);
  return rows[0];
};
// Add this right above your module.exports
const markAllAsRead = async (tenantId, userId) => {
  const query = `
    UPDATE notifications 
    SET is_read = TRUE 
    WHERE tenant_id = $1 AND user_id = $2 AND is_read = FALSE;
  `;
  await db.query(query, [tenantId, userId]);
};

module.exports = {
  createNotification,
  getUnreadNotifications,
  markAsRead,
  markAllAsRead, // 🟢 Export the new function!
};
