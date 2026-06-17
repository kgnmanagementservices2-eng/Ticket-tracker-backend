const express = require("express");
const router = express.Router();
const groupController = require("../controllers/groupController");
const { authenticateToken, authorizeRoles } = require("../middlewares/auth");

router.use(authenticateToken);

router.post(
  "/",
  authorizeRoles("GLOBAL_ADMIN"),
  groupController.createNewGroup,
);
router.delete(
  "/:id",
  authorizeRoles("GLOBAL_ADMIN"),
  groupController.deleteGroup,
); // NEW ROUTE!

// 🟢 STRICT SECURITY: Only Global Admins can Add/Remove Members
router.post(
  "/:id/members",
  authorizeRoles("GLOBAL_ADMIN"),
  groupController.addGroupMembers,
);
router.delete(
  "/:id/members/:userId",
  authorizeRoles("GLOBAL_ADMIN"),
  groupController.removeGroupMember,
);

// Everyone can read messages and send messages
router.get("/", groupController.getMyGroups);
router.get("/users", groupController.getUsersForGroupCreation);
router.get("/:id/messages", groupController.getMessages);
router.post("/:id/messages", groupController.sendMessage);
router.get("/:id/members", groupController.getGroupMembers);
router.put("/:id/read", groupController.markGroupAsRead);
router.delete("/:groupId/messages", groupController.clearChat);
module.exports = router;
