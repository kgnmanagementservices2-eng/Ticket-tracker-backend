const categoryRepo = require("../repositories/categoryRepository");
const db = require("../config/db"); // We need the DB to verify the department ID

// 🟢 FIX 1: Secure the dropdown list in the UI
const getAllowedDepartments = async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    let depts = await categoryRepo.getDepartments(tenantId);

    // If they are not a GLOBAL_ADMIN, force filter to their specific department
    if (req.user.role !== "GLOBAL_ADMIN" && req.user.department_id) {
      // Look up their exact department name using their ID
      const deptRes = await db.query(
        "SELECT name FROM departments WHERE id = $1",
        [req.user.department_id],
      );
      const myDeptName = deptRes.rows[0]?.name;

      // Filter the list so they ONLY see their own department
      depts = depts.filter((d) => d === myDeptName);
    }

    res.status(200).json({ status: "success", data: depts });
  } catch (error) {
    next(error);
  }
};

const getCategories = async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const { department } = req.params;
    const categories = await categoryRepo.getCategoriesByDepartment(
      tenantId,
      department,
    );
    res.status(200).json({ status: "success", data: categories });
  } catch (error) {
    next(error);
  }
};

// 🟢 FIX 2: Secure the Category Creation
const addCategory = async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const { department, name } = req.body;

    if (!department || !name)
      return res.status(400).json({ message: "Department and name required" });

    // BULLETPROOF SECURITY CHECK
    if (req.user.role !== "GLOBAL_ADMIN") {
      const deptRes = await db.query(
        "SELECT name FROM departments WHERE id = $1",
        [req.user.department_id],
      );
      const myDeptName = deptRes.rows[0]?.name;

      if (department !== myDeptName) {
        return res
          .status(403)
          .json({
            status: "error",
            message:
              "Forbidden: You can only add categories to your own department.",
          });
      }
    }

    const newCategory = await categoryRepo.createCategory(
      tenantId,
      department,
      name,
    );
    res.status(201).json({ status: "success", data: newCategory });
  } catch (error) {
    next(error);
  }
};

// 🟢 FIX 3: Secure the Subcategory Creation
const addSubcategory = async (req, res, next) => {
  try {
    const { categoryId, name } = req.body;
    if (!categoryId || !name)
      return res.status(400).json({ message: "Category ID and name required" });

    // BULLETPROOF SECURITY CHECK
    if (req.user.role !== "GLOBAL_ADMIN") {
      // 1. Get the department of the category they are trying to add a subcategory to
      const catRes = await db.query(
        "SELECT department FROM ticket_categories WHERE id = $1",
        [categoryId],
      );
      const targetDepartment = catRes.rows[0]?.department;

      // 2. Get the user's actual department name
      const deptRes = await db.query(
        "SELECT name FROM departments WHERE id = $1",
        [req.user.department_id],
      );
      const myDeptName = deptRes.rows[0]?.name;

      if (targetDepartment !== myDeptName) {
        return res
          .status(403)
          .json({
            status: "error",
            message:
              "Forbidden: You cannot modify other departments' categories.",
          });
      }
    }

    const newSub = await categoryRepo.createSubcategory(categoryId, name);
    res.status(201).json({ status: "success", data: newSub });
  } catch (error) {
    next(error);
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check ownership before deleting
    if (req.user.role !== "GLOBAL_ADMIN") {
      const catRes = await db.query(
        "SELECT department FROM ticket_categories WHERE id = $1",
        [id],
      );
      const deptRes = await db.query(
        "SELECT name FROM departments WHERE id = $1",
        [req.user.department_id],
      );
      if (catRes.rows[0]?.department !== deptRes.rows[0]?.name) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    await db.query(
      `DELETE FROM ticket_categories WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenant_id],
    );
    res.status(200).json({ status: "success", message: "Category deleted" });
  } catch (error) {
    next(error);
  }
};

const deleteSubcategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check ownership before deleting
    if (req.user.role !== "GLOBAL_ADMIN") {
      const checkRes = await db.query(
        `
          SELECT tc.department FROM ticket_subcategories ts
          JOIN ticket_categories tc ON ts.category_id = tc.id
          WHERE ts.id = $1
        `,
        [id],
      );
      const deptRes = await db.query(
        "SELECT name FROM departments WHERE id = $1",
        [req.user.department_id],
      );
      if (checkRes.rows[0]?.department !== deptRes.rows[0]?.name) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    await db.query(
      `
      DELETE FROM ticket_subcategories 
      USING ticket_categories 
      WHERE ticket_subcategories.category_id = ticket_categories.id 
      AND ticket_subcategories.id = $1 
      AND ticket_categories.tenant_id = $2
    `,
      [id, req.user.tenant_id],
    );

    res.status(200).json({ status: "success", message: "Subcategory deleted" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllowedDepartments,
  getCategories,
  addCategory,
  addSubcategory,
  deleteCategory,
  deleteSubcategory,
};
