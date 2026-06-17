const groupRepo = require("../repositories/groupRepository");
const { getIO } = require("../config/socket");

const createNewGroup = async (req, res, next) => {
  try {
    const { name, description, memberIds } = req.body;
    const tenantId = req.user.tenant_id;
    const creatorId = req.user.userId || req.user.id;

    if (!name || !memberIds || memberIds.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Group name and at least one member are required.",
      });
    }

    // 1. Create the Group
    const newGroup = await groupRepo.createGroup(
      tenantId,
      name,
      description,
      creatorId,
    );

    // 2. Add the creator to the group automatically!
    const allMembers = [...new Set([...memberIds, creatorId])];

    // 3. Add everyone else
    await groupRepo.addMembersToGroup(newGroup.id, allMembers);

    res
      .status(201)
      .json({ status: "success", message: "Group created!", data: newGroup });
  } catch (error) {
    next(error);
  }
};

const getMyGroups = async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.userId || req.user.id;

    const groups = await groupRepo.getUserGroups(tenantId, userId);
    res.status(200).json({ status: "success", data: groups });
  } catch (error) {
    next(error);
  }
};

const getUsersForGroupCreation = async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const users = await groupRepo.getAvailableUsersForGroup(tenantId);
    res.status(200).json({ status: "success", data: users });
  } catch (error) {
    next(error);
  }
};
// Get Messages (UPDATED WITH PAGINATION)
const getMessages = async (req, res, next) => {
  try {
    const { id: groupId } = req.params;

    // Grab pagination variables from the URL, default to Page 1, Limit 50
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = (page - 1) * limit;

    const messages = await groupRepo.getGroupMessages(groupId, limit, offset);

    res.status(200).json({
      status: "success",
      data: messages,
      meta: {
        page,
        limit,
        hasMore: messages.length === limit, // If we got 50 back, there are probably more!
      },
    });
  } catch (error) {
    next(error);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const { id: groupId } = req.params;
    const { message, attachmentUrl, attachmentName } = req.body;
    const senderId = req.user.userId || req.user.id;
    const senderName = req.user.name || "Team Member";
    const tenantId = req.user.tenant_id;

    if ((!message || message.trim() === "") && !attachmentUrl) {
      return res.status(400).json({
        status: "error",
        message: "You must provide a message or an attachment.",
      });
    }

    // 1. Save to Database
    const savedMessage = await groupRepo.saveGroupMessage(
      groupId,
      senderId,
      message || null,
      attachmentUrl || null,
      attachmentName || null,
    );

    const fullMessage = {
      ...savedMessage,
      sender_name: senderName,
      sender_role: req.user.role,
    };

    // 2. Blast it over live WebSockets
    const io = getIO();
    io.to(`tenant_${tenantId}`).emit("new_group_message", fullMessage);

    // Notice: NO NOTIFICATION LOOP HERE ANYMORE! So clean.

    res.status(201).json({ status: "success", data: fullMessage });
  } catch (error) {
    next(error);
  }
};

// 🟢 NEW: Handles updating the watermark
const markGroupAsRead = async (req, res, next) => {
  try {
    const { id: groupId } = req.params;
    const userId = req.user.userId || req.user.id;

    await groupRepo.updateLastRead(groupId, userId);

    res.status(200).json({ status: "success", message: "Watermark updated" });
  } catch (error) {
    next(error);
  }
};

// 🟢 NEW: Get Members
const getGroupMembers = async (req, res, next) => {
  try {
    const members = await groupRepo.getGroupMembers(req.params.id);
    res.status(200).json({ status: "success", data: members });
  } catch (error) {
    next(error);
  }
};

// 🟢 NEW: Remove Member
const removeGroupMember = async (req, res, next) => {
  try {
    const { id: groupId, userId } = req.params;
    await groupRepo.removeMember(groupId, userId);
    res.status(200).json({ status: "success", message: "Member removed" });
  } catch (error) {
    next(error);
  }
};

// 🟢 NEW: Add Members
const addGroupMembers = async (req, res, next) => {
  try {
    const { id: groupId } = req.params;
    const { memberIds } = req.body;

    if (!memberIds || !Array.isArray(memberIds)) {
      return res.status(400).json({ message: "memberIds array is required" });
    }

    await groupRepo.addMembersToExistingGroup(groupId, memberIds);
    res.status(200).json({ status: "success", message: "Members added" });
  } catch (error) {
    next(error);
  }
};
const deleteGroup = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenant_id;

    await groupRepo.deleteGroup(tenantId, id);

    res
      .status(200)
      .json({ status: "success", message: "Group deleted successfully" });
  } catch (error) {
    next(error);
  }
};

const fetchGroupMembers = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    const { members, totalRecords } = await groupRepo.getGroupMembersPaginated(
      groupId,
      limit,
      offset,
      search,
    );

    const hasMore = page * limit < totalRecords;

    res.status(200).json({
      status: "success",
      data: members,
      pagination: {
        currentPage: page,
        totalRecords,
        hasMore,
      },
    });
  } catch (error) {
    next(error);
  }
};
const clearChat = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { role } = req.user; // Pulled from your JWT auth middleware

    // Security check: Only allow admins/managers to clear chats
    if (role !== "GLOBAL_ADMIN" && role !== "BACK_OFFICE_MANAGER") {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to clear group chats.",
      });
    }

    const deletedCount = await groupRepo.clearGroupChat(groupId);

    res.status(200).json({
      status: "success",
      message: `Chat cleared successfully. Removed ${deletedCount} messages.`,
    });
  } catch (error) {
    next(error);
  }
};
module.exports = {
  createNewGroup,
  getMyGroups,
  getUsersForGroupCreation,
  getMessages,
  sendMessage,
  markGroupAsRead,
  getGroupMembers,
  removeGroupMember,
  addGroupMembers,
  deleteGroup,
  fetchGroupMembers,
  clearChat,
};
