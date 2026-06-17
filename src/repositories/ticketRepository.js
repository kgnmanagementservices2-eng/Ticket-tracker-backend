const db = require("../config/db");

// 1. Find the name of the department to check if it is "HR"
const getDepartmentById = async (tenantId, departmentId) => {
  const res = await db.query(
    `SELECT name FROM departments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, departmentId],
  );
  return res.rows[0];
};

// 2. Find the Manager for Escalations and HR
const getManagerForDepartment = async (tenantId, departmentId) => {
  const res = await db.query(
    `SELECT id FROM users 
         WHERE tenant_id = $1 AND department_id = $2 AND role = 'BACK_OFFICE_MANAGER' 
         LIMIT 1`,
    [tenantId, departmentId],
  );
  return res.rows[0];
};

// 3. The Load Balancer: Find the Team Member with the fewest open tickets.

const getLeastLoadedMember = async (tenantId, departmentId) => {
  const res = await db.query(
    `SELECT id FROM users 
         WHERE tenant_id = $1 AND department_id = $2 AND role = 'BACK_OFFICE_MEMBER' 
         ORDER BY active_ticket_count ASC 
         LIMIT 1`,
    [tenantId, departmentId],
  );
  return res.rows[0];
};

// 4. Create the ticket AND increment the user's workload using a Transaction
const createAndAssignTicket = async (
  tenantId,
  creatorId,
  assigneeId,
  departmentId,
  storeId,
  marketId,
  ticketData,
) => {
  const attachmentsJson = ticketData.attachments
    ? JSON.stringify(ticketData.attachments)
    : null;

  // 🟢 ULTIMATE FAIL-SAFE:
  // If the middle service layer drops or misplaces the variables,
  // we yank them directly from the raw frontend payload right before saving.
  const finalStoreId =
    storeId || ticketData.storeId || ticketData.store_id || null;
  const finalMarketId =
    marketId || ticketData.marketId || ticketData.market_id || null;
  const finalDeptId =
    departmentId || ticketData.departmentId || ticketData.department_id || null;

  const { Pool } = require("pg");
  const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Insert the Ticket (using our fail-safe IDs)
    const ticketRes = await client.query(
      `INSERT INTO tickets (
                tenant_id, creator_id, assignee_id, department_id, store_id, market_id,
                category_level_1, category_level_2, user_comments, generated_email_body, 
                priority, attachments
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        tenantId,
        creatorId,
        assigneeId,
        finalDeptId, // 🟢 Uses Fail-safe
        finalStoreId, // 🟢 Uses Fail-safe
        finalMarketId, // 🟢 Uses Fail-safe
        ticketData.categoryLevel1,
        ticketData.categoryLevel2,
        ticketData.userComments,
        ticketData.generatedEmailBody,
        ticketData.priority,
        attachmentsJson,
      ],
    );

    // Log that the employee created the ticket
    await client.query(
      `INSERT INTO ticket_history (tenant_id, ticket_id, actor_id, action) 
       VALUES ($1, $2, $3, 'CREATED')`,
      [tenantId, ticketRes.rows[0].id, creatorId],
    );

    // Increment the assigned user's workload (if someone was assigned)
    if (assigneeId) {
      await client.query(
        `UPDATE users SET active_ticket_count = active_ticket_count + 1 WHERE id = $1`,
        [assigneeId],
      );

      // Fetch the assignee's name for the timeline
      const userRes = await client.query(
        `SELECT name FROM users WHERE id = $1`,
        [assigneeId],
      );
      const assigneeName = userRes.rows[0]?.name || "agent";

      // System logs the auto-assignment WITH the target's name
      await client.query(
        `INSERT INTO ticket_history (tenant_id, ticket_id, actor_id, action, details) 
         VALUES ($1, $2, NULL, 'AUTO_ASSIGNED', $3)`,
        [
          tenantId,
          ticketRes.rows[0].id,
          `Smart router assigned ticket to ${assigneeName}.`,
        ],
      );
    }

    await client.query("COMMIT");
    return ticketRes.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
// ... keep your existing functions at the top ...

// 5. Update Status and Decrease Workload
const updateTicketStatus = async (
  tenantId,
  ticketId,
  status,
  resolutionNotes,
) => {
  const { Pool } = require("pg");
  const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Update the ticket
    const ticketRes = await client.query(
      `UPDATE tickets 
             SET status = $1, resolution_notes = $2, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $3 AND tenant_id = $4 
             RETURNING assignee_id`,
      [status, resolutionNotes, ticketId, tenantId],
    );

    const assigneeId = ticketRes.rows[0]?.assignee_id;

    // If the ticket is now resolved/closed, free up the agent's workload
    if ((status === "RESOLVED" || status === "CLOSED") && assigneeId) {
      await client.query(
        `UPDATE users SET active_ticket_count = active_ticket_count - 1 
                 WHERE id = $1 AND active_ticket_count > 0`,
        [assigneeId],
      );
    }

    await client.query("COMMIT");
    return { success: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// 6. Manual Manager Override (Reassignment)
const reassignTicket = async (
  tenantId,
  ticketId,
  oldAssigneeId,
  newAssigneeId,
  actorId, // 🟢 NEW: We need to know who is pressing the button
) => {
  const { Pool } = require("pg");
  const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Update the ticket to the new user and flag it as reassigned
    await client.query(
      `UPDATE tickets 
             SET assignee_id = $1, is_reassigned = TRUE, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2 AND tenant_id = $3`,
      [newAssigneeId, ticketId, tenantId],
    );

    // Decrease the old agent's workload
    if (oldAssigneeId) {
      await client.query(
        `UPDATE users SET active_ticket_count = active_ticket_count - 1 
                 WHERE id = $1 AND active_ticket_count > 0`,
        [oldAssigneeId],
      );
    }

    // Increase the new agent's workload
    // Increase the new agent's workload
    await client.query(
      `UPDATE users SET active_ticket_count = active_ticket_count + 1 WHERE id = $1`,
      [newAssigneeId],
    );

    // 🟢 NEW: Fetch the new assignee's name for the timeline
    const userRes = await client.query(`SELECT name FROM users WHERE id = $1`, [
      newAssigneeId,
    ]);
    const newAssigneeName = userRes.rows[0]?.name || "agent";

    // 🟢 NEW: Log the Escalation or Reassignment WITH the target's name
    const actionType =
      String(oldAssigneeId) === String(actorId) ? "ESCALATED" : "REASSIGNED";
    const actionVerb = actionType === "ESCALATED" ? "escalated" : "routed";

    await client.query(
      `INSERT INTO ticket_history (tenant_id, ticket_id, actor_id, action, details) VALUES ($1, $2, $3, $4, $5)`,
      [
        tenantId,
        ticketId,
        actorId,
        actionType,
        `Ticket ${actionVerb} to ${newAssigneeName}.`,
      ],
    );

    await client.query("COMMIT");
    return { success: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// ... existing functions ...

// 7. Update Call Status for Voice Huddles
const updateCallStatus = async (
  tenantId,
  ticketId,
  isCallActive,
  activeCallRoom,
) => {
  const res = await db.query(
    `UPDATE tickets 
         SET is_call_active = $1, active_call_room = $2, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $3 AND tenant_id = $4 
         RETURNING id, assignee_id`,
    [isCallActive, activeCallRoom, ticketId, tenantId],
  );
  return res.rows[0];
};

const getTickets = async (
  tenantId, // 1
  userId, // 2
  role, // 3
  departmentId, // 4
  marketId, // 5
  limit = 20, // 6
  offset = 0, // 7
  filterAssigneeId = null, // 8
  statusFilters = [], // 9
  priorityFilters = [], // 10
  storeIdFilter = null, // 11
) => {
  let baseQuery = `
    FROM tickets t
    LEFT JOIN users u ON t.assignee_id = u.id
    WHERE t.tenant_id = $1
  `;

  let params = [tenantId];
  let paramIndex = 2;

  // 1. Base Security
  if (role === "EMPLOYEE") {
    baseQuery += ` AND t.creator_id = $${paramIndex}`;
    params.push(userId);
    paramIndex++;
  } else if (role === "BACK_OFFICE_MEMBER") {
    baseQuery += ` AND t.assignee_id = $${paramIndex}`;
    params.push(userId);
    paramIndex++;
  } else if (role === "BACK_OFFICE_MANAGER") {
    baseQuery += ` AND t.department_id = $${paramIndex}`;
    params.push(departmentId);
    paramIndex++;
  } else if (role === "MARKET_MANAGER") {
    baseQuery += ` AND t.market_id = $${paramIndex}`;
    params.push(marketId);
    paramIndex++;
  }

  // 2. Assignee Filter
  if (filterAssigneeId && role !== "EMPLOYEE") {
    baseQuery += ` AND t.assignee_id = $${paramIndex}`;
    params.push(filterAssigneeId);
    paramIndex++;
  }

  // 3. Status Filters (🟢 Added safety check)
  if (statusFilters && statusFilters.length > 0) {
    baseQuery += ` AND t.status = ANY($${paramIndex})`;
    params.push(statusFilters);
    paramIndex++;
  }

  // 4. Priority Filters (🟢 Added safety check)
  if (priorityFilters && priorityFilters.length > 0) {
    baseQuery += ` AND t.priority = ANY($${paramIndex})`;
    params.push(priorityFilters);
    paramIndex++;
  }

  // 5. Store ID Filter (🟢 For the Dashboard Drill-down)
  if (storeIdFilter) {
    baseQuery += ` AND t.store_id = $${paramIndex}`;
    params.push(storeIdFilter);
    paramIndex++;
  }

  const countRes = await db.query(`SELECT COUNT(*) ${baseQuery}`, params);
  const totalRecords = parseInt(countRes.rows[0].count, 10);

  const dataQuery = `
    SELECT t.*, u.name AS assignee_name 
    ${baseQuery} 
    ORDER BY t.created_at DESC 
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const dataParams = [...params, limit, offset];
  const res = await db.query(dataQuery, dataParams);

  return { data: res.rows, totalRecords };
};
// 9. Fetch a single ticket by ID
// src/repositories/ticketRepository.js

// src/repositories/ticketRepository.js

const getTicketById = async (tenantId, ticketId) => {
  const query = `
    SELECT t.*, 
           creator.name AS creator_name,
           creator.id AS creator_id,
           assignee.name AS assignee_name,
           dept.name AS department_name,
           m.name AS market_name,
           s.name AS store_name
    FROM tickets t
    LEFT JOIN users creator ON t.creator_id = creator.id
    LEFT JOIN users assignee ON t.assignee_id = assignee.id
    LEFT JOIN departments dept ON t.department_id = dept.id
    /* 🟢 FIX: Fetch Market and Store based on the TICKET's data, not the creator's data */
    LEFT JOIN markets m ON t.market_id = m.id
    LEFT JOIN stores s ON t.store_id = s.id
    WHERE t.id = $1 AND t.tenant_id = $2
  `;
  const res = await db.query(query, [ticketId, tenantId]);
  const ticket = res.rows[0];

  if (!ticket) return null;

  // Fetch the journey timeline
  const historyRes = await db.query(
    `
    SELECT h.*, u.name as actor_name 
    FROM ticket_history h
    LEFT JOIN users u ON h.actor_id = u.id
    WHERE h.ticket_id = $1 AND h.tenant_id = $2
    ORDER BY h.created_at ASC
  `,
    [ticketId, tenantId],
  );

  // Attach the journey array to the ticket object
  ticket.journey = historyRes.rows;

  return ticket;
};
// No controller changes needed; it will automatically send this richer data to the frontend!
// Fetch all tickets that have an active voice huddle
const getActiveHuddles = async (tenantId, role, departmentId) => {
  let query = `SELECT id, category_level_1, category_level_2, priority, active_call_room, assignee_id, status
     FROM tickets 
     WHERE tenant_id = $1 
       AND is_call_active = TRUE 
       AND status NOT IN ('CLOSED', 'RESOLVED')`;
  let params = [tenantId];

  // 🟢 THE FIX: Isolate live huddle list
  if (role === "BACK_OFFICE_MANAGER" || role === "BACK_OFFICE_MEMBER") {
    query += ` AND department_id = $2`;
    params.push(departmentId);
  }

  query += ` ORDER BY created_at DESC`;
  const res = await db.query(query, params);
  return res.rows;
};

// src/repositories/ticketRepository.js

// src/repositories/ticketRepository.js

// 🟢 NEW: Added marketId as the 5th parameter
const getTicketStats = async (
  tenantId,
  userId,
  role,
  departmentId,
  marketId,
) => {
  // 🟢 FIX: Added "t." to all conditions to strictly target the tickets table
  let baseCondition = `t.tenant_id = $1`;
  let params = [tenantId];
  let pIdx = 2;

  if (role === "EMPLOYEE") {
    baseCondition += ` AND t.creator_id = $${pIdx++}`;
    params.push(userId);
  } else if (role === "BACK_OFFICE_MEMBER") {
    baseCondition += ` AND t.assignee_id = $${pIdx++}`;
    params.push(userId);
  } else if (role === "BACK_OFFICE_MANAGER") {
    baseCondition += ` AND t.department_id = $${pIdx++}`;
    params.push(departmentId);
  } else if (role === "MARKET_MANAGER") {
    baseCondition += ` AND t.market_id = $${pIdx++}`;
    params.push(marketId);
  }

  // 1. Status Counts (🟢 Added 't' alias)
  const statusRes = await db.query(
    `SELECT t.status, COUNT(*) as count FROM tickets t WHERE ${baseCondition} GROUP BY t.status`,
    params,
  );

  // 2. Priority Distribution (🟢 Added 't' alias)
  const priorityRes = await db.query(
    `SELECT t.priority as name, COUNT(*) as value FROM tickets t WHERE ${baseCondition} GROUP BY t.priority`,
    params,
  );

  // 3. Time-Series Analytics: Last 6 Months (🟢 Added 't' alias)
  const timeSeriesRes = await db.query(
    `
    SELECT 
      to_char(date_trunc('month', t.created_at), 'Mon') AS month,
      COUNT(*) AS total_created,
      COUNT(CASE WHEN t.status IN ('RESOLVED', 'CLOSED') THEN 1 END) AS total_resolved
    FROM tickets t 
    WHERE ${baseCondition} AND t.created_at >= NOW() - INTERVAL '6 months'
    GROUP BY date_trunc('month', t.created_at)
    ORDER BY date_trunc('month', t.created_at) ASC
  `,
    params,
  );

  // 4. Recent Activity (🟢 Added 't' alias)
  const recentRes = await db.query(
    `
    SELECT t.id, t.category_level_1, t.priority, t.status, t.created_at 
    FROM tickets t WHERE ${baseCondition} 
    ORDER BY t.created_at DESC LIMIT 5
  `,
    params,
  );

  // 5. Department Breakdown
  const deptStatsRes = await db.query(
    `SELECT d.name as department_name, t.status, COUNT(*) as count 
     FROM tickets t 
     LEFT JOIN departments d ON t.department_id = d.id 
     WHERE ${baseCondition} 
     GROUP BY d.name, t.status`,
    params,
  );

  // 6. Market Breakdown
  const marketStatsRes = await db.query(
    `SELECT m.name as market_name, t.status, COUNT(*) as count 
     FROM tickets t 
     LEFT JOIN markets m ON t.market_id = m.id 
     WHERE ${baseCondition} 
     GROUP BY m.name, t.status`,
    params,
  );

  // ... (Keep existing stats queries 1 through 6)

  // 🟢 NEW 7: Store Breakdown for the deep drill-down
  const storeStatsRes = await db.query(
    `SELECT s.id as store_id, s.name as store_name, m.name as market_name, t.status, COUNT(*) as count 
     FROM tickets t 
     LEFT JOIN stores s ON t.store_id = s.id 
     LEFT JOIN markets m ON s.market_id = m.id 
     WHERE ${baseCondition} 
     GROUP BY s.id, s.name, m.name, t.status`,
    params,
  );

  return {
    statuses: statusRes.rows,
    distribution: priorityRes.rows,
    timeSeries: timeSeriesRes.rows,
    recent: recentRes.rows,
    departmentStats: deptStatsRes.rows,
    marketStats: marketStatsRes.rows,
    storeStats: storeStatsRes.rows, // 🟢 Return Store Stats
  };
};

// src/repositories/ticketRepository.js
const setCallActive = async (tenantId, ticketId, isActive) => {
  await db.query(
    `UPDATE tickets SET is_call_active = $1 WHERE id = $2 AND tenant_id = $3`,
    [isActive, ticketId, tenantId],
  );
};
// 1. Log the start of a call
const logCallStart = async (tenantId, ticketId, initiatorId) => {
  const res = await db.query(
    `INSERT INTO call_logs (ticket_id, tenant_id, initiator_id) 
     VALUES ($1, $2, $3) RETURNING id`,
    [ticketId, tenantId, initiatorId],
  );
  return res.rows[0];
};

// 2. Log the end of a call and calculate duration
const logCallEnd = async (callId) => {
  await db.query(
    `UPDATE call_logs 
     SET ended_at = CURRENT_TIMESTAMP,
         duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at))
     WHERE id = $1`,
    [callId],
  );
};

// 3. Fetch call history for a specific ticket
const getCallHistory = async (tenantId, ticketId) => {
  const res = await db.query(
    `SELECT c.*, u.name as initiator_name 
     FROM call_logs c
     LEFT JOIN users u ON c.initiator_id = u.id
     WHERE c.ticket_id = $1 AND c.tenant_id = $2
     ORDER BY c.started_at DESC`,
    [ticketId, tenantId],
  );
  return res.rows;
};
// Fetch global call history for the Command Center
const getGlobalCallHistory = async (tenantId) => {
  const res = await db.query(
    `SELECT c.*, u.name as initiator_name, t.priority 
     FROM call_logs c
     LEFT JOIN users u ON c.initiator_id = u.id
     LEFT JOIN tickets t ON c.ticket_id = t.id
     WHERE c.tenant_id = $1
     ORDER BY c.started_at DESC
     LIMIT 50`,
    [tenantId],
  );
  return res.rows;
};

// 🟢 NEW: Bulletproof fallback to close any ghost calls
const closeAllActiveCallsForTicket = async (ticketId) => {
  await db.query(
    `UPDATE call_logs 
     SET ended_at = CURRENT_TIMESTAMP,
         duration_seconds = CAST(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at)) AS INTEGER)
     WHERE ticket_id = $1 AND ended_at IS NULL`,
    [ticketId],
  );
};
// 🟢 1. Find if a call is already happening
const getActiveCallForTicket = async (ticketId) => {
  const res = await db.query(
    `SELECT * FROM call_logs WHERE ticket_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [ticketId],
  );
  return res.rows[0];
};

// 🟢 2. Mark the call as answered when the second person joins
const markCallAsAnswered = async (callId) => {
  await db.query(`UPDATE call_logs SET is_answered = TRUE WHERE id = $1`, [
    callId,
  ]);
};
// 🟢 UPDATED: Now accepts attachmentUrl and attachmentName
const addTicketMessage = async (
  tenantId,
  ticketId,
  senderId,
  message,
  attachmentUrl,
  attachmentName,
) => {
  const query = `
    INSERT INTO ticket_messages (tenant_id, ticket_id, sender_id, message, attachment_url, attachment_name)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, ticket_id, sender_id, message, attachment_url, attachment_name, created_at;
  `;
  const { rows } = await db.query(query, [
    tenantId,
    ticketId,
    senderId,
    message,
    attachmentUrl,
    attachmentName,
  ]);
  return rows[0];
};

// 🟢 UPDATED: Now fetches the attachment columns
const getTicketMessages = async (tenantId, ticketId) => {
  const query = `
    SELECT 
      m.id, 
      m.message, 
      m.attachment_url,
      m.attachment_name,
      m.created_at, 
      m.sender_id,
u.name as sender_name,
      u.role as sender_role
    FROM ticket_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.tenant_id = $1 AND m.ticket_id = $2
    ORDER BY m.created_at ASC;
  `;
  const { rows } = await db.query(query, [tenantId, ticketId]);
  return rows;
};
// Update your module.exports to include the new functions:
module.exports = {
  getDepartmentById,
  getManagerForDepartment,
  getLeastLoadedMember,
  createAndAssignTicket,
  updateTicketStatus,
  reassignTicket,
  updateCallStatus,
  getTickets,
  getTicketById,
  getActiveHuddles,
  getTicketStats,
  logCallEnd,
  logCallStart,
  getCallHistory,
  setCallActive,
  getGlobalCallHistory,
  closeAllActiveCallsForTicket,
  getActiveCallForTicket,
  markCallAsAnswered,
  addTicketMessage,
  getTicketMessages,
};
