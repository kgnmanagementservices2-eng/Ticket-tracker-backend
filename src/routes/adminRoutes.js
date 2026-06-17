const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { authenticateToken, authorizeRoles } = require("../middlewares/auth");

// Apply the token check to all routes in this file
router.use(authenticateToken);

const requireAdmin = authorizeRoles("CEO", "GLOBAL_ADMIN");
router.put(
  "/users/:id/status",
  authorizeRoles("GLOBAL_ADMIN", "CEO"),
  adminController.updateUserStatus,
);
// POST /api/admin/departments
router.post("/departments", requireAdmin, adminController.addDepartment);

// POST /api/admin/markets
router.post("/markets", requireAdmin, adminController.addMarket);

// POST /api/admin/stores
router.post("/stores", requireAdmin, adminController.addStore);

// POST /api/admin/users
router.post("/users", requireAdmin, adminController.provisionUser);

router.get("/departments", requireAdmin, adminController.fetchDepartments);
router.get("/markets", requireAdmin, adminController.fetchMarkets);
router.get("/stores", adminController.fetchStores);

router.get(
  "/workload",
  authorizeRoles(
    "CEO",
    "GLOBAL_ADMIN",
    "BACK_OFFICE_MANAGER",
    "BACK_OFFICE_MEMBER",
  ),
  adminController.fetchWorkload,
);
router.get("/users", requireAdmin, adminController.fetchUsers);
module.exports = router;
