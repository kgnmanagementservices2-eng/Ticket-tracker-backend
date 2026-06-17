const ticketRepo = require("../repositories/ticketRepository");
// NEW: Import our Socket engine helpers
const { getIO, getSocketIdForUser } = require("../config/socket");

const processNewTicket = async (
  tenantId,
  creatorId,
  departmentId,
  storeId,
  marketId,
  ticketData,
) => {
  // 1. Get the department details to check our "HR Exception" rule
  const department = await ticketRepo.getDepartmentById(tenantId, departmentId);
  if (!department) throw new Error("Invalid Department");

  const isHR = department.name.toUpperCase() === "HR";
  const isEscalated =
    ticketData.priority === "IMPORTANT" || ticketData.priority === "EMERGENCY";

  let assigneeId = null;

  // 2. The Routing Matrix
  if (isHR || isEscalated) {
    const manager = await ticketRepo.getManagerForDepartment(
      tenantId,
      departmentId,
    );
    if (manager) assigneeId = manager.id;
  } else {
    const member = await ticketRepo.getLeastLoadedMember(
      tenantId,
      departmentId,
    );
    if (member) {
      assigneeId = member.id;
    } else {
      const manager = await ticketRepo.getManagerForDepartment(
        tenantId,
        departmentId,
      );
      if (manager) assigneeId = manager.id;
    }
  }

  // 3. Save the ticket and update the agent's workload in the Database
  const newTicket = await ticketRepo.createAndAssignTicket(
    tenantId,
    creatorId,
    assigneeId,
    departmentId,
    storeId,
    marketId,
    ticketData,
  );

  // 🟢 NEW: 4. The Real-Time Notification Trigger
  if (assigneeId) {
    // Look up if the assigned agent is currently online
    const targetSocketId = getSocketIdForUser(assigneeId);

    if (targetSocketId) {
      const io = getIO();
      // Emit only to that specific agent's computer
      io.to(targetSocketId).emit("new_ticket_assigned", {
        message: "You have a new ticket assigned to you.",
        ticket: newTicket,
      });
      console.log(
        `📡 Alert sent to agent ${assigneeId} via socket ${targetSocketId}`,
      );
    } else {
      console.log(
        `Agent ${assigneeId} is offline. They will see the ticket on their dashboard when they log in.`,
      );
    }
  }

  return newTicket;
};

module.exports = { processNewTicket };
