const express = require("express");
const router = express.Router();
const categoryController = require("../controllers/categoryController");
const { authenticateToken, authorizeRoles } = require("../middlewares/auth");

router.use(authenticateToken);

// Public route (for employees creating tickets)
router.get("/:department", categoryController.getCategories);

// 🟢 Admin & Manager Routes (For the Settings Page)
// Using authorizeRoles to strictly lock this down!
const adminOnly = authorizeRoles("GLOBAL_ADMIN", "BACK_OFFICE_MANAGER");
// Get dynamically allowed departments
router.get(
  "/departments/allowed",
  authenticateToken,
  categoryController.getAllowedDepartments,
);
router.post("/", adminOnly, categoryController.addCategory);
router.post("/subcategory", adminOnly, categoryController.addSubcategory);
router.delete("/:id", adminOnly, categoryController.deleteCategory);
router.delete(
  "/subcategory/:id",
  adminOnly,
  categoryController.deleteSubcategory,
);

module.exports = router;
