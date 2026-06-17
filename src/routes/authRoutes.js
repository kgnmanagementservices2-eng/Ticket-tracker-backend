const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authenticateToken, authorizeRoles } = require("../middlewares/auth");

// POST /api/auth/register
router.post("/register", authController.registerCompany);

// POST /api/auth/login
router.post("/login", authController.login);
router.get("/me", authenticateToken, authController.getMe);
router.put(
  "/change-password",
  authenticateToken,
  authController.changePassword,
);
router.post("/logout", authController.logout);
module.exports = router;
