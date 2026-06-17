const crypto = require("crypto");
const db = require("../config/db");

const createDepartment = async (tenantId, name) => {
  const res = await db.query(
    `INSERT INTO departments (tenant_id, name) VALUES ($1, $2) RETURNING *`,
    [tenantId, name],
  );
  return res.rows[0];
};

const createMarket = async (tenantId, name) => {
  const res = await db.query(
    `INSERT INTO markets (tenant_id, name) VALUES ($1, $2) RETURNING *`,
    [tenantId, name],
  );
  return res.rows[0];
};

// If no custom ID is provided, generate a random 8-character string (e.g., '4f9a2b1c')
const createStore = async (tenantId, marketId, name, id = null) => {
  // If no custom ID is provided, generate a random 8-character string (e.g., '4f9a2b1c')
  const storeId = id || crypto.randomBytes(4).toString("hex");

  const res = await db.query(
    `INSERT INTO stores (id, tenant_id, market_id, name) VALUES ($1, $2, $3, $4) RETURNING *`,
    [storeId, tenantId, marketId, name],
  );
  return res.rows[0];
};

// Update your createUser function
const createUser = async (
  tenantId,
  name,
  email,
  passwordHash,
  role,
  departmentId,
  marketId,
  storeId,
  id = null, // 🟢 NEW: Accept an optional custom ID
) => {
  // If no custom ID is provided, generate a fallback random string
  const userId = id || crypto.randomBytes(4).toString("hex");

  const res = await db.query(
    `INSERT INTO users 
        (id, tenant_id, name, email, password_hash, role, department_id, market_id, store_id) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
        RETURNING id, name, email, role`,
    [
      userId,
      tenantId,
      name,
      email,
      passwordHash,
      role,
      departmentId,
      marketId,
      storeId,
    ],
  );
  return res.rows[0];
};

// --- Unpaginated fetchers (Used for Dropdowns) ---
const getDepartments = async (tenantId) => {
  const res = await db.query(
    `SELECT * FROM departments WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return res.rows;
};

const getMarkets = async (tenantId) => {
  const res = await db.query(
    `SELECT * FROM markets WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return res.rows;
};

const getStores = async (tenantId) => {
  const res = await db.query(
    `SELECT * FROM stores WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return res.rows;
};

// --- Paginated fetchers (Used for Data Tables) ---
const getDepartmentsPaginated = async (tenantId, limit, offset, search) => {
  const params = [tenantId];
  let where = `WHERE tenant_id = $1`;

  if (search) {
    where += ` AND name ILIKE $2`;
    params.push(`%${search}%`);
  }

  const countRes = await db.query(
    `SELECT COUNT(*) FROM departments ${where}`,
    params,
  );
  const dataRes = await db.query(
    `SELECT * FROM departments ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return {
    data: dataRes.rows,
    totalRecords: parseInt(countRes.rows[0].count, 10),
  };
};

const getMarketsPaginated = async (tenantId, limit, offset, search) => {
  const params = [tenantId];
  let where = `WHERE tenant_id = $1`;

  if (search) {
    where += ` AND name ILIKE $2`;
    params.push(`%${search}%`);
  }

  const countRes = await db.query(
    `SELECT COUNT(*) FROM markets ${where}`,
    params,
  );
  const dataRes = await db.query(
    `SELECT * FROM markets ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return {
    data: dataRes.rows,
    totalRecords: parseInt(countRes.rows[0].count, 10),
  };
};

const getStoresPaginated = async (tenantId, limit, offset, search) => {
  const params = [tenantId];
  let where = `WHERE tenant_id = $1`;

  if (search) {
    where += ` AND name ILIKE $2`;
    params.push(`%${search}%`);
  }

  const countRes = await db.query(
    `SELECT COUNT(*) FROM stores ${where}`,
    params,
  );
  const dataRes = await db.query(
    `SELECT * FROM stores ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return {
    data: dataRes.rows,
    totalRecords: parseInt(countRes.rows[0].count, 10),
  };
};

const getTeamWorkload = async (tenantId, role, departmentId) => {
  let query = `SELECT u.id, u.name, u.email, u.role, u.active_ticket_count, d.name AS department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.tenant_id = $1 
        AND u.role IN ('BACK_OFFICE_MEMBER', 'BACK_OFFICE_MANAGER')`;

  let params = [tenantId];

  if (role === "BACK_OFFICE_MANAGER" || role === "BACK_OFFICE_MEMBER") {
    query += ` AND u.department_id = $2`;
    params.push(departmentId);
  }

  query += ` ORDER BY d.name ASC, u.active_ticket_count DESC`;
  const res = await db.query(query, params);
  return res.rows;
};

const getUsersWithDetails = async (
  tenantId,
  limit,
  offset,
  search,
  roleFilter,
) => {
  const queryParams = [tenantId];
  let whereClause = `WHERE u.tenant_id = $1`;
  let paramIndex = 2;

  if (search) {
    whereClause += ` AND (u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`;
    queryParams.push(`%${search}%`);
    paramIndex++;
  }

  if (roleFilter && roleFilter !== "ALL") {
    whereClause += ` AND u.role = $${paramIndex}`;
    queryParams.push(roleFilter);
    paramIndex++;
  }

  const countQuery = `SELECT COUNT(*) FROM users u ${whereClause}`;
  const countRes = await db.query(countQuery, queryParams);
  const totalRecords = parseInt(countRes.rows[0].count, 10);

  const dataQuery = `
    SELECT u.id, u.name, u.email, u.role, u.is_active, u.active_ticket_count, u.created_at,
           d.name as department_name, 
           m.name as market_name, 
           s.name as store_name
    FROM users u
    LEFT JOIN departments d ON u.department_id = d.id
    LEFT JOIN markets m ON u.market_id = m.id
    LEFT JOIN stores s ON u.store_id = s.id
    ${whereClause}
    ORDER BY u.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  const dataParams = [...queryParams, limit, offset];
  const dataRes = await db.query(dataQuery, dataParams);

  return {
    users: dataRes.rows,
    totalRecords,
  };
};

const toggleUserStatus = async (tenantId, userId, isActive) => {
  const query = `
    UPDATE users 
    SET is_active = $1 
    WHERE id = $2 AND tenant_id = $3 
    RETURNING id, name, email, is_active;
  `;
  const { rows } = await db.query(query, [isActive, userId, tenantId]);
  return rows[0];
};

module.exports = {
  createDepartment,
  createMarket,
  createStore,
  createUser,
  getDepartments,
  getMarkets,
  getStores,
  getDepartmentsPaginated,
  getMarketsPaginated,
  getStoresPaginated,
  getTeamWorkload,
  getUsersWithDetails,
  toggleUserStatus,
};
