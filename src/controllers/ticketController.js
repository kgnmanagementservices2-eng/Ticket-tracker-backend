const { z } = require("zod");
const ticketService = require("../services/ticketService");
const { getIO, getSocketIdForUser } = require("../config/socket");
const adminRepo = require("../repositories/adminRepository");
const ticketRepo = require("../repositories/ticketRepository");
const notificationRepo = require("../repositories/notificationRepository");

// The Zod Schema: The strict rules for incoming tickets
// The Zod Schema: The strict rules for incoming tickets
const ticketSchema = z.object({
  departmentId: z.string().uuid("Invalid Department ID"),
  categoryLevel1: z.string().min(1, "Category Level 1 is required"),
  categoryLevel2: z.string().min(1, "Category Level 2 is required"),
  userComments: z.string().optional(),
  generatedEmailBody: z.string().min(10, "Email body is too short"),
  priority: z.enum(["STANDARD", "IMPORTANT", "EMERGENCY"]),
  attachments: z.array(z.string().url()).optional(),

  // 🟢 THE CULPRIT: Zod was deleting these because they were missing here!
  store_id: z.string().optional().nullable(),
  market_id: z.string().optional().nullable(),
  storeId: z.string().optional().nullable(),
  marketId: z.string().optional().nullable(),
});

// const createTicket = async (req, res, next) => {
//   try {
//     const ticketData = req.body;
//     const tenantId = req.user.tenant_id;
//     const creatorId = req.user.userId || req.user.id;
//     const storeId = req.user.store_id;
//     const marketId = req.user.market_id || req.body.market_id; // Fallback to body

//     if (!storeId) {
//       return res.status(403).json({
//         status: "error",
//         message: "Only store employees can create tickets.",
//       });
//     }

//     // Hand the validated data over to the Brain (Service Layer)
//     const newTicket = await ticketService.processNewTicket(
//       tenantId,
//       creatorId,
//       ticketData.departmentId,
//       storeId,
//       marketId,
//       ticketData,
//     );

//     // 🟢 NEW: Persistent Notification for Auto-Assignment
//     if (newTicket && newTicket.assignee_id) {
//       await notificationRepo.createNotification(
//         tenantId,
//         newTicket.assignee_id,
//         "New Ticket Assigned",
//         `Ticket #${newTicket.id.substring(0, 8)} has been routed to your queue.`,
//         "TICKET_ASSIGNED",
//         newTicket.id,
//       );
//     }

//     res.status(201).json({
//       status: "success",
//       message: "Ticket created and routed successfully",
//       data: newTicket,
//     });
//   } catch (error) {
//     next(error);
//   }
// };
const createTicket = async (req, res, next) => {
  try {
    const ticketData = req.body;
    const tenantId = req.user.tenant_id;
    const creatorId = req.user.userId || req.user.id;

    // 🟢 FIX: Flip the priority!
    // 1. Grab the exact store/market selected in the form (checks both camelCase and snake_case)
    // 2. Fallback to the user's profile store/market if the form is empty
    const storeId =
      req.body.storeId || req.body.store_id || req.user.store_id || null;
    const marketId =
      req.body.marketId || req.body.market_id || req.user.market_id || null;

    // Clean up literal "null" strings just in case the database/token passes them
    const finalStoreId = storeId === "null" ? null : storeId;
    const finalMarketId = marketId === "null" ? null : marketId;

    // Check that they have AT LEAST ONE of these IDs
    if (!finalStoreId && !finalMarketId) {
      return res.status(403).json({
        status: "error",
        message: "Only store employees or market managers can create tickets.",
      });
    }

    // Hand the validated data over to the Brain (Service Layer)
    const newTicket = await ticketService.processNewTicket(
      tenantId,
      creatorId,
      ticketData.departmentId,
      finalStoreId,
      finalMarketId,
      ticketData,
    );

    // Persistent Notification for Auto-Assignment
    if (newTicket && newTicket.assignee_id) {
      await notificationRepo.createNotification(
        tenantId,
        newTicket.assignee_id,
        "New Ticket Assigned",
        `Ticket #${newTicket.id.substring(0, 8)} has been routed to your queue.`,
        "TICKET_ASSIGNED",
        newTicket.id,
      );
    }

    res.status(201).json({
      status: "success",
      message: "Ticket created and routed successfully",
      data: newTicket,
    });
  } catch (error) {
    next(error);
  }
};
const resolveTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, resolutionNotes } = req.body;
    const tenantId = req.user.tenant_id;

    if (!["IN_PROGRESS", "RESOLVED", "CLOSED"].includes(status)) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid status" });
    }

    await ticketRepo.updateTicketStatus(tenantId, id, status, resolutionNotes);

    res
      .status(200)
      .json({ status: "success", message: `Ticket marked as ${status}` });
  } catch (error) {
    next(error);
  }
};

const overrideAssignment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { oldAssigneeId, newAssigneeId } = req.body;
    const tenantId = req.user.tenant_id;

    if (!newAssigneeId) {
      return res
        .status(400)
        .json({ status: "error", message: "New Assignee ID is required" });
    }

    // 1. Update the database
    await ticketRepo.reassignTicket(tenantId, id, oldAssigneeId, newAssigneeId);

    // 🟢 NEW: Save the persistent notification in the database
    await notificationRepo.createNotification(
      tenantId,
      newAssigneeId,
      "Ticket Reassigned",
      `A manager manually reassigned Ticket #${id.substring(0, 8)} to your queue.`,
      "TICKET_ASSIGNED",
      id,
    );

    // 2. Ping the new agent via WebSockets if they happen to be online right now
    const targetSocketId = getSocketIdForUser(newAssigneeId);
    if (targetSocketId) {
      const io = getIO();
      io.to(targetSocketId).emit("ticket_reassigned_to_you", {
        message: "A manager has manually reassigned a ticket to your queue.",
        ticketId: id,
      });
    }

    res
      .status(200)
      .json({ status: "success", message: "Ticket reassigned successfully" });
  } catch (error) {
    next(error);
  }
};

const getTickets = async (req, res, next) => {
  try {
    const {
      tenant_id: tenantId,
      userId,
      role,
      department_id: departmentId,
      market_id: marketId, // We must extract this here
    } = req.user;

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;

    const assigneeId = req.query.assigneeId || null;
    const storeIdFilter = req.query.storeId || null; // 🟢 Extract Store ID

    const statusStr = req.query.status || "";
    const priorityStr = req.query.priority || "";

    const statusFilters = statusStr ? statusStr.split(",") : [];
    const priorityFilters = priorityStr ? priorityStr.split(",") : [];

    // 🟢 Ensure exactly 11 arguments are passed in this specific order!
    const { data, totalRecords } = await ticketRepo.getTickets(
      tenantId, // 1
      userId || req.user.id, // 2
      role, // 3
      departmentId, // 4
      marketId, // 5
      limit, // 6
      offset, // 7
      assigneeId, // 8
      statusFilters, // 9
      priorityFilters, // 10
      storeIdFilter, // 11
    );

    const totalPages = Math.ceil(totalRecords / limit);

    res.status(200).json({
      status: "success",
      data: data,
      meta: { currentPage: page, totalPages, totalRecords },
    });
  } catch (error) {
    next(error);
  }
};

const getTicket = async (req, res, next) => {
  try {
    const { tenant_id: tenantId } = req.user;
    const ticketId = req.params.id;

    const ticket = await ticketRepo.getTicketById(tenantId, ticketId);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const callLogs = await ticketRepo.getCallHistory(tenantId, ticketId);
    ticket.call_history = callLogs;

    res.status(200).json({ status: "success", data: ticket });
  } catch (error) {
    next(error);
  }
};

const getDepartmentsForDropdown = async (req, res, next) => {
  try {
    const departments = await adminRepo.getDepartments(req.user.tenant_id);
    res.status(200).json({ status: "success", data: departments });
  } catch (error) {
    next(error);
  }
};
const getStoresForDropdown = async (req, res, next) => {
  try {
    const stores = await adminRepo.getStores(req.user.tenant_id);
    res.status(200).json({ status: "success", data: stores });
  } catch (error) {
    next(error);
  }
};

const fetchActiveHuddles = async (req, res, next) => {
  try {
    const { tenant_id: tenantId, role, department_id: departmentId } = req.user;
    const activeHuddles = await ticketRepo.getActiveHuddles(
      tenantId,
      role,
      departmentId,
    );
    res.status(200).json({ status: "success", data: activeHuddles });
  } catch (error) {
    next(error);
  }
};

const getTicketStats = async (req, res, next) => {
  try {
    const {
      tenant_id: tenantId,
      userId,
      role,
      department_id: departmentId,
      market_id: marketId,
    } = req.user;

    const stats = await ticketRepo.getTicketStats(
      tenantId,
      userId || req.user.id,
      role,
      departmentId,
      marketId,
    );

    const formattedStats = {
      OPEN: 0,
      IN_PROGRESS: 0,
      RESOLVED: 0,
      CLOSED: 0,
      total: 0,

      distribution: stats.distribution.map((item) => ({
        name: item.name,
        value: Number(item.value),
      })),

      timeSeries: stats.timeSeries.map((item) => ({
        month: item.month,
        total_created: Number(item.total_created),
        total_resolved: Number(item.total_resolved),
      })),

      recent: stats.recent,

      // 🟢 NEW: Structure the Detailed breakdowns
      detailed: {
        // 🟢 Add 'stores: []' to each array
        OPEN: { departments: [], markets: [], stores: [] },
        IN_PROGRESS: { departments: [], markets: [], stores: [] },
        RESOLVED: { departments: [], markets: [], stores: [] },
        CLOSED: { departments: [], markets: [], stores: [] },
      },
    };

    // Overall Status Totals
    stats.statuses.forEach((row) => {
      const count = Number(row.count);
      formattedStats[row.status] = count;
      formattedStats.total += count;
    });

    // 🟢 Group Department Stats
    stats.departmentStats.forEach((row) => {
      if (formattedStats.detailed[row.status]) {
        formattedStats.detailed[row.status].departments.push({
          name: row.department_name || "Unassigned",
          count: Number(row.count),
        });
      }
    });

    // 🟢 Group Market Stats
    stats.marketStats.forEach((row) => {
      if (formattedStats.detailed[row.status]) {
        formattedStats.detailed[row.status].markets.push({
          name: row.market_name || "Global HQ / Unassigned",
          count: Number(row.count),
        });
      }
    });
    stats.storeStats.forEach((row) => {
      if (formattedStats.detailed[row.status]) {
        formattedStats.detailed[row.status].stores.push({
          id: row.store_id,
          name: row.store_name || "Unassigned Store",
          marketName: row.market_name || "Global HQ / Unassigned",
          count: Number(row.count),
        });
      }
    });

    res.status(200).json({ status: "success", data: formattedStats });
  } catch (error) {
    next(error);
  }
};

const getGlobalCallHistory = async (req, res, next) => {
  try {
    const { tenant_id } = req.user;
    const history = await ticketRepo.getGlobalCallHistory(tenant_id);
    res.status(200).json({ status: "success", data: history });
  } catch (error) {
    next(error);
  }
};

const getMessages = async (req, res, next) => {
  try {
    const { tenant_id } = req.user;
    const { id: ticketId } = req.params;

    const messages = await ticketRepo.getTicketMessages(tenant_id, ticketId);
    res.status(200).json({ status: "success", data: messages });
  } catch (error) {
    next(error);
  }
};

const addMessage = async (req, res, next) => {
  try {
    const { tenant_id, userId, name, role } = req.user;
    const currentUserId = userId || req.user.id;
    const { id: ticketId } = req.params;
    const { message, attachmentUrl, attachmentName } = req.body;

    if ((!message || message.trim() === "") && !attachmentUrl) {
      return res.status(400).json({
        status: "error",
        message: "You must provide a message or an attachment.",
      });
    }

    // 1. Save the actual chat message to the DB
    const savedMessage = await ticketRepo.addTicketMessage(
      tenant_id,
      ticketId,
      currentUserId,
      message || null,
      attachmentUrl || null,
      attachmentName || null,
    );

    const formattedMessage = {
      ...savedMessage,
      sender_name: name,
      sender_role: role,
    };

    // 2. Broadcast the live socket ping
    const io = getIO();
    io.emit("new_ticket_message", formattedMessage);

    // 🟢 THE FIX: 3. Save a Persistent Notification for the offline user!
    try {
      // Fetch the ticket to see who should get the notification
      const ticket = await ticketRepo.getTicketById(tenant_id, ticketId);

      if (ticket) {
        let recipientId = null;

        // If the Employee sent it -> Notify the Agent
        if (String(currentUserId) === String(ticket.creator_id)) {
          recipientId = ticket.assignee_id;
        }
        // If the Agent sent it -> Notify the Employee
        else {
          recipientId = ticket.creator_id;
        }

        // If someone is assigned, save it to their Notification Bell!
        if (recipientId) {
          let previewText = message
            ? message.length > 40
              ? message.substring(0, 40) + "..."
              : message
            : "Sent an attachment 📎";

          await notificationRepo.createNotification(
            tenant_id,
            recipientId, // Send to the OTHER person
            `New Message from ${name}`,
            previewText,
            "NEW_MESSAGE",
            ticketId,
          );
        }
      }
    } catch (notifError) {
      console.error("Failed to save message notification:", notifError);
      // We don't want to crash the whole chat app just because a notification failed
    }

    res.status(201).json({ status: "success", data: formattedMessage });
  } catch (error) {
    next(error);
  }
};
module.exports = {
  ticketSchema,
  createTicket,
  resolveTicket,
  overrideAssignment,
  getTickets,
  getTicket,
  getDepartmentsForDropdown,
  getStoresForDropdown,
  fetchActiveHuddles,
  getTicketStats,
  getGlobalCallHistory,
  getMessages,
  addMessage,
};
