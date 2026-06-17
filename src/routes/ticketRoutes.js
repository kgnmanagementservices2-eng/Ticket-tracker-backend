const express = require("express");
const router = express.Router();
const ticketController = require("../controllers/ticketController");
const callController = require("../controllers/callController");
const { authenticateToken, authorizeRoles } = require("../middlewares/auth");
const { validateBody } = require("../middlewares/validate");

router.use(authenticateToken); // Lock down the whole file

// ==========================================
// 1. STATIC ROUTES (Must go before /:id)
// ==========================================

router.post(
  "/",
  authorizeRoles("EMPLOYEE", "MARKET_MANAGER"),
  validateBody(ticketController.ticketSchema),
  ticketController.createTicket,
);

router.get("/", ticketController.getTickets);
router.get("/stats", ticketController.getTicketStats);
router.get("/departments", ticketController.getDepartmentsForDropdown);
router.get("/stores", ticketController.getStoresForDropdown);

// Use ticketController for history (assuming you left the function in that file)
router.get("/global-call-history", ticketController.getGlobalCallHistory);

router.get(
  "/active-huddles",
  authorizeRoles(
    "CEO",
    "GLOBAL_ADMIN",
    "BACK_OFFICE_MANAGER",
    "BACK_OFFICE_MEMBER",
  ),
  ticketController.fetchActiveHuddles,
);

// ==========================================
// 2. DYNAMIC ROUTES (/:id)
// ==========================================

router.get("/:id", ticketController.getTicket);

router.put(
  "/:id/status",
  authorizeRoles("BACK_OFFICE_MANAGER", "BACK_OFFICE_MEMBER"),
  ticketController.resolveTicket,
);

router.put(
  "/:id/reassign",
  authorizeRoles("BACK_OFFICE_MANAGER", "GLOBAL_ADMIN", "BACK_OFFICE_MEMBER"),
  ticketController.overrideAssignment,
);

// ==========================================
// 3. VOICE HUDDLE ROUTES
// ==========================================
// 🟢 NEW: Chat Message Routes
router.get("/:id/messages", ticketController.getMessages);
router.post("/:id/messages", ticketController.addMessage);

router.get(
  "/:id/call-token",
  authorizeRoles("EMPLOYEE", "BACK_OFFICE_MANAGER", "BACK_OFFICE_MEMBER"),
  callController.getCallToken,
);

// 🟢 THE FIX: We added the Back Office roles so they are legally allowed to click the Call button!
router.post(
  "/:id/initiate-call",
  authorizeRoles("EMPLOYEE", "BACK_OFFICE_MANAGER", "BACK_OFFICE_MEMBER"),
  callController.initiateCall,
);

router.post(
  "/:id/end-call",
  authorizeRoles("EMPLOYEE", "BACK_OFFICE_MANAGER", "BACK_OFFICE_MEMBER"),
  callController.endCall,
);

module.exports = router;
