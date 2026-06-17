const notificationRepo = require("../repositories/notificationRepository");

const getMyNotifications = async (req, res, next) => {
  try {
    const { tenant_id, userId } = req.user;
    // Note: If your auth middleware uses 'id' instead of 'userId', swap it here!
    const id = userId || req.user.id;

    const notifications = await notificationRepo.getUnreadNotifications(
      tenant_id,
      id,
    );
    res.status(200).json({ status: "success", data: notifications });
  } catch (error) {
    next(error);
  }
};

const markNotificationRead = async (req, res, next) => {
  try {
    const { tenant_id, userId } = req.user;
    const { id: notificationId } = req.params;
    const id = userId || req.user.id;

    await notificationRepo.markAsRead(tenant_id, id, notificationId);
    res
      .status(200)
      .json({ status: "success", message: "Notification marked as read" });
  } catch (error) {
    next(error);
  }
};
// Add this new function
const markAllRead = async (req, res, next) => {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.userId || req.user.id;

    await notificationRepo.markAllAsRead(tenantId, userId);

    res
      .status(200)
      .json({ status: "success", message: "All notifications cleared" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMyNotifications,
  markNotificationRead,
  markAllRead,
};
