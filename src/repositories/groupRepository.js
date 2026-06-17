const db = require("../config/db");

// 1. Create a new group
const createGroup = async (tenantId, name, description, creatorId) => {
  const query = `
    INSERT INTO groups (tenant_id, name, description, created_by)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  const { rows } = await db.query(query, [
    tenantId,
    name,
    description,
    creatorId,
  ]);
  return rows[0];
};

// 2. Add members to a group
const addMembersToGroup = async (groupId, userIds) => {
  // We use Promise.all to insert multiple users at once safely
  const insertPromises = userIds.map((userId) => {
    return db.query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [groupId, userId],
    );
  });
  await Promise.all(insertPromises);
};

// 3. Get all groups that a specific user is a part of

// 4. Get all users available in the tenant (so Admin can select who to add)
const getAvailableUsersForGroup = async (tenantId) => {
  const query = `
    SELECT id,name, role 
    FROM users 
    WHERE tenant_id = $1 AND is_active = TRUE
    ORDER BY name ASC;
  `;
  const { rows } = await db.query(query, [tenantId]);
  return rows;
};

// 5. Get all messages for a specific group
// 5. Get all messages for a specific group
// 5. Get messages for a specific group (UPDATED WITH PAGINATION)
const getGroupMessages = async (groupId, limit = 50, offset = 0) => {
  const query = `
    SELECT * FROM (
      SELECT 
        gm.id, gm.message, gm.attachment_url, gm.attachment_name, gm.created_at, gm.sender_id, gm.group_id,
        u.name as sender_name,
        u.role as sender_role
      FROM group_messages gm
      JOIN users u ON gm.sender_id = u.id
      WHERE gm.group_id = $1
      ORDER BY gm.created_at DESC
      LIMIT $2 OFFSET $3
    ) sub
    ORDER BY created_at ASC;
  `;
  const { rows } = await db.query(query, [groupId, limit, offset]);
  return rows;
};

// 6. Save a new message (UPDATED for attachments)
const saveGroupMessage = async (
  groupId,
  senderId,
  message,
  attachmentUrl,
  attachmentName,
) => {
  const query = `
    INSERT INTO group_messages (group_id, sender_id, message, attachment_url, attachment_name)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  const { rows } = await db.query(query, [
    groupId,
    senderId,
    message,
    attachmentUrl,
    attachmentName,
  ]);
  return rows[0];
};
// 7. Get all member IDs of a specific group (for notifications)

// 3. Get all groups that a specific user is a part of (UPDATED WITH UNREAD COUNT)
const getUserGroups = async (tenantId, userId) => {
  const query = `
    SELECT 
      g.id, g.name, g.description, g.created_at,
      (
        SELECT COUNT(*) 
        FROM group_messages gm2 
        WHERE gm2.group_id = g.id 
        AND gm2.created_at > gm.last_read_at
        AND gm2.sender_id != $2 -- Don't count their own messages!
      )::int AS unread_count
    FROM groups g
    JOIN group_members gm ON g.id = gm.group_id
    WHERE g.tenant_id = $1 AND gm.user_id = $2
    ORDER BY g.created_at DESC;
  `;
  const { rows } = await db.query(query, [tenantId, userId]);
  return rows;
};

// 7. Update the watermark when a user opens a chat
const updateLastRead = async (groupId, userId) => {
  const query = `
    UPDATE group_members 
    SET last_read_at = CURRENT_TIMESTAMP 
    WHERE group_id = $1 AND user_id = $2;
  `;
  await db.query(query, [groupId, userId]);
};

// 8. Get all members of a specific group
const getGroupMembers = async (groupId) => {
  const query = `
    SELECT u.id, u.name, u.role, u.email 
    FROM group_members gm
    JOIN users u ON gm.user_id = u.id
    WHERE gm.group_id = $1
    ORDER BY u.name ASC;
  `;
  const { rows } = await db.query(query, [groupId]);
  return rows;
};

// 9. Remove a member from a group
const removeMember = async (groupId, userId) => {
  const query = `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`;
  await db.query(query, [groupId, userId]);
};

// 10. Add new members to an existing group
const addMembersToExistingGroup = async (groupId, memberIds) => {
  // Use a transaction or multiple inserts. For simplicity, we loop:
  for (const userId of memberIds) {
    // ON CONFLICT DO NOTHING prevents crashing if they are already in the group
    await db.query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [groupId, userId],
    );
  }
};
const deleteGroup = async (tenantId, groupId) => {
  const query = `DELETE FROM groups WHERE tenant_id = $1 AND id = $2`;
  await db.query(query, [tenantId, groupId]);
};

const getGroupMembersPaginated = async (groupId, limit, offset, search) => {
  let query = `
    SELECT u.id, u.name, u.email, u.role, gm.joined_at
    FROM group_members gm
    JOIN users u ON gm.user_id = u.id
    WHERE gm.group_id = $1
  `;
  let params = [groupId];
  let paramIndex = 2;

  // Add search condition dynamically
  if (search) {
    query += ` AND (u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  // Add ordering and pagination
  query += ` ORDER BY u.name ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  // Get total count to tell the frontend if there are more pages
  let countQuery = `
    SELECT COUNT(*) 
    FROM group_members gm
    JOIN users u ON gm.user_id = u.id
    WHERE gm.group_id = $1
  `;
  let countParams = [groupId];
  if (search) {
    countQuery += ` AND (u.name ILIKE $2 OR u.email ILIKE $2)`;
    countParams.push(`%${search}%`);
  }

  const [dataRes, countRes] = await Promise.all([
    db.query(query, params),
    db.query(countQuery, countParams),
  ]);

  return {
    members: dataRes.rows,
    totalRecords: parseInt(countRes.rows[0].count, 10),
  };
};
const clearGroupChat = async (groupId) => {
  // Deletes all messages for the group and returns the number of rows deleted
  const res = await db.query(
    `DELETE FROM group_messages WHERE group_id = $1 RETURNING id`,
    [groupId],
  );
  return res.rowCount;
};
module.exports = {
  createGroup,
  addMembersToGroup,
  getUserGroups,
  getAvailableUsersForGroup,
  getGroupMessages,
  saveGroupMessage,
  updateLastRead,
  getGroupMembers,
  removeMember,
  addMembersToExistingGroup,
  deleteGroup,
  getGroupMembersPaginated,
  clearGroupChat,
};
