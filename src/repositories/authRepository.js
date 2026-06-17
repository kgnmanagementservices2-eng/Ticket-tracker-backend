const db = require("../config/db");

const createCompanyAndCEO = async (
  companyName,
  ceoName,
  email,
  passwordHash,
  primaryColor = "#000000", // Default fallback
  secondaryColor = "#FFFFFF",
  logoUrl = null,
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

  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    // 1. Create the Tenant with Theme Colors and Logo
    const tenantRes = await dbClient.query(
      `INSERT INTO tenants (company_name, primary_color, secondary_color, logo_url) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [companyName, primaryColor, secondaryColor, logoUrl],
    );
    const tenantId = tenantRes.rows[0].id;

    // 2. Create the CEO User attached to that Tenant
    const userRes = await dbClient.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role) 
       VALUES ($1, $2, $3, $4, 'CEO') RETURNING id, role`,
      [tenantId, ceoName, email, passwordHash],
    );

    await dbClient.query("COMMIT");
    return { tenantId, user: userRes.rows[0] };
  } catch (error) {
    await dbClient.query("ROLLBACK");
    throw error;
  } finally {
    dbClient.release();
  }
};

const getUserByEmail = async (email) => {
  const res = await db.query(
    `SELECT u.id, u.tenant_id, u.name, u.email, u.password_hash, u.role, 
            u.department_id, u.market_id, u.store_id, u.is_active, 
            t.primary_color, t.secondary_color, t.logo_url
     FROM users u
     JOIN tenants t ON u.tenant_id = t.id
     WHERE u.email = $1`,
    [email],
  );
  return res.rows[0];
};

module.exports = {
  createCompanyAndCEO,
  getUserByEmail,
};
