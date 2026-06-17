const callService = require("../services/callService");
const ticketRepo = require("../repositories/ticketRepository");
const { getIO, getSocketIdForUser } = require("../config/socket");
const notificationRepo = require("../repositories/notificationRepository");

const getCallToken = async (req, res, next) => {
  try {
    const { id: ticketId } = req.params;
    const rawUserId = req.user?.id || req.user?.userId;

    const existingCall = await ticketRepo.getActiveCallForTicket(ticketId);

    // Check if the person asking for a token is the SECOND person joining
    if (
      existingCall &&
      String(existingCall.initiator_id) !== String(rawUserId)
    ) {
      // 1. Mark as answered in the database
      await ticketRepo.markCallAsAnswered(existingCall.id);

      // 🟢 2. NEW: Fire a Socket event back to the original caller telling them to connect!
      const initiatorSocketId = getSocketIdForUser(existingCall.initiator_id);
      if (initiatorSocketId) {
        const io = getIO();
        io.to(initiatorSocketId).emit("call_answered", {
          ticketId: ticketId,
          message: "The agent accepted the call!",
        });
        console.log(
          `✅ Sent 'call_answered' signal back to initiator ${existingCall.initiator_id}`,
        );
      }
    }

    const safeIdentity = rawUserId
      ? `${String(rawUserId)}_${Date.now()}`
      : `guest_${Date.now()}`;
    const token = callService.generateCallToken(safeIdentity, ticketId);

    res.status(200).json({
      status: "success",
      token: token,
      roomName: `ticket_huddle_${ticketId}`,
    });
  } catch (error) {
    console.error("Twilio Token Error:", error);
    res.status(500).json({
      status: "error",
      message: "Could not generate secure voice token.",
    });
  }
};

// 🟢 UPDATED: Initiate the call, ring the agent, AND start the stopwatch
const initiateCall = async (req, res, next) => {
  try {
    const { id: ticketId } = req.params;
    const tenantId = req.user.tenant_id;
    const userId = req.user.userId || req.user.id;
    const roomName = `ticket_huddle_${ticketId}`;

    let callId;

    // 🟢 1. Check if the other person is already waiting in the room
    const existingCall = await ticketRepo.getActiveCallForTicket(ticketId);

    if (existingCall) {
      // A call is already active! Join it instead of starting a new one.
      callId = existingCall.id;

      // If the person joining isn't the person who started it, it's an ANSWERED call!
      if (String(existingCall.initiator_id) !== String(userId)) {
        await ticketRepo.markCallAsAnswered(callId);
      }
    } else {
      // 🟢 2. No active call. Sweep ghosts and start a brand new one.
      await ticketRepo.closeAllActiveCallsForTicket(ticketId);
      await ticketRepo.updateCallStatus(tenantId, ticketId, true, roomName);

      const callLog = await ticketRepo.logCallStart(tenantId, ticketId, userId);
      callId = callLog.id;

      // 🟢 3. Trigger the Ring Signal (BIDIRECTIONAL ROUTING)
      const updatedTicket = await ticketRepo.getTicketById(tenantId, ticketId);

      if (updatedTicket) {
        let targetUserId = null;
        let callerTitle = "";

        // Determine who is making the call to ring the other person
        if (String(userId) === String(updatedTicket.creator_id)) {
          // Employee is calling -> Ring the Assigned Agent
          targetUserId = updatedTicket.assignee_id;
          callerTitle = "Employee";
        } else {
          // Agent is calling -> Ring the Employee who created the ticket
          targetUserId = updatedTicket.creator_id;
          callerTitle = "Support Team";
        }

        // Send the socket ping to the target user
        if (targetUserId) {
          const targetSocketId = getSocketIdForUser(targetUserId);

          if (targetSocketId) {
            const io = getIO();
            io.to(targetSocketId).emit("incoming_huddle", {
              ticketId: updatedTicket.id,
              roomName: roomName,
              message: `Incoming Voice Huddle from ${callerTitle}`,
            });
            console.log(`☎️ Ring signal sent to user ${targetUserId}`);
          } else {
            console.log(
              `User ${targetUserId} is offline. They missed the call.`,
            );
          }
        }
      }
    }

    res.status(200).json({
      status: "success",
      message: existingCall ? "Joined active call." : "Call initiated.",
      roomName: roomName,
      callId: callId,
    });
  } catch (error) {
    next(error);
  }
};

const endCall = async (req, res, next) => {
  try {
    const { id: ticketId } = req.params;
    const tenantId = req.user.tenant_id;
    const { callId, isAnswered } = req.body;

    const currentUserId = req.user.userId || req.user.id;
    const currentUserName =
      req.user.name || req.user.first_name || "A team member";

    // 1. Mark the ticket as no longer on an active call
    await ticketRepo.updateCallStatus(tenantId, ticketId, false, null);

    // 2. Stop the stopwatch and calculate the duration!
    if (callId) {
      await ticketRepo.logCallEnd(callId);
    }

    // 🟢 3. NEW: Persistent Notification for Missed Calls
    if (isAnswered === false || isAnswered === "false") {
      const ticket = await ticketRepo.getTicketById(tenantId, ticketId);

      if (ticket) {
        let missedUserId = null;

        if (String(currentUserId) === String(ticket.creator_id)) {
          missedUserId = ticket.assignee_id;
        } else {
          missedUserId = ticket.creator_id;
        }

        if (missedUserId) {
          try {
            await notificationRepo.createNotification(
              tenantId,
              missedUserId,
              "Missed Voice Huddle ☎️",
              `${currentUserName} tried to start a live voice huddle for Ticket #${ticketId.substring(0, 8)}.`,
              "MISSED_CALL",
              ticketId,
            );
          } catch (notifError) {
            console.error(
              "Failed to save missed call notification:",
              notifError,
            );
          }
        }
      }
    }

    res.status(200).json({
      status: "success",
      message: "Call ended and duration logged.",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCallToken,
  initiateCall,
  endCall,
};
