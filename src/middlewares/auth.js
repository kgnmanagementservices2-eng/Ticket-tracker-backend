const jwt = require("jsonwebtoken");

// ================= AUTHENTICATE =================
const authenticateToken = (req, res, next) => {
  try {
    // ✅ NEW: Get token from cookies instead of headers
    const token = req.cookies?.token;

    if (!token) {
      return res.status(401).json({
        status: "error",
        message: "Access denied. No token provided.",
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user data to request
    req.user = decoded;

    next();
  } catch (error) {
    return res.status(403).json({
      status: "error",
      message: "Invalid or expired token.",
    });
  }
};

// ================= AUTHORIZE =================
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        status: "error",
        message:
          "Forbidden. You do not have permission to perform this action.",
      });
    }
    next();
  };
};

module.exports = { authenticateToken, authorizeRoles };
