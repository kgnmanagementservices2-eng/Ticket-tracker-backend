const db = require("../config/db");

// 1. Fetch Categories & Subcategories for a specific department
const getCategoriesByDepartment = async (tenantId, department) => {
  const query = `
    SELECT 
      c.id AS category_id, 
      c.name AS category_name,
      s.id AS subcategory_id, 
      s.name AS subcategory_name
    FROM ticket_categories c
    LEFT JOIN ticket_subcategories s ON c.id = s.category_id
    WHERE c.tenant_id = $1 AND c.department = $2
    ORDER BY c.name, s.name;
  `;

  const { rows } = await db.query(query, [tenantId, department]);

  // 🟢 Format the flat SQL rows into a beautiful nested React-friendly array!
  const categoriesMap = new Map();

  rows.forEach((row) => {
    if (!categoriesMap.has(row.category_id)) {
      categoriesMap.set(row.category_id, {
        id: row.category_id,
        name: row.category_name,
        subcategories: [],
      });
    }

    // If this category has a subcategory, push it into the array
    if (row.subcategory_id) {
      categoriesMap.get(row.category_id).subcategories.push({
        id: row.subcategory_id,
        name: row.subcategory_name,
      });
    }
  });

  return Array.from(categoriesMap.values());
};

// Admin Functions (We will use these later for the Admin Settings page)
const createCategory = async (tenantId, department, name) => {
  const { rows } = await db.query(
    `INSERT INTO ticket_categories (tenant_id, department, name) VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, department, name],
  );
  return rows[0];
};

const createSubcategory = async (categoryId, name) => {
  const { rows } = await db.query(
    `INSERT INTO ticket_subcategories (category_id, name) VALUES ($1, $2) RETURNING *`,
    [categoryId, name],
  );
  return rows[0];
};
const getDepartments = async (tenantId) => {
  const { rows } = await db.query(
    `SELECT name FROM departments WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  return rows.map((r) => r.name);
};
module.exports = {
  getCategoriesByDepartment,
  createCategory,
  createSubcategory,
  getDepartments,
};
