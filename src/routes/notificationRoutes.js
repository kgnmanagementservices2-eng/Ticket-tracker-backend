const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { authenticateToken } = require("../middlewares/auth");

router.use(authenticateToken); // Lock it down

router.get("/", notificationController.getMyNotifications);
router.put("/read-all", notificationController.markAllRead);
router.put("/:id/read", notificationController.markNotificationRead);

module.exports = router;
