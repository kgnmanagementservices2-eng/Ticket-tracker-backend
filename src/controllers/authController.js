const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authRepo = require("../repositories/authRepository");
const userRepo = require("../repositories/userRepository");

// 🔥 COMMON COOKIE CONFIG
const getCookieOptions = () => {
  const isProd = process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProd, // false in localhost
    sameSite: isProd ? "none" : "lax", // 🔥 FIX
    maxAge: 64 * 60 * 60 * 1000,
    path: "/", // important for clearing
  };
};

// ================= REGISTER =================
const registerCompany = async (req, res, next) => {
  try {
    const {
      companyName,
      ceoName,
      email,
      password,
      primaryColor,
      secondaryColor,
      logoUrl,
    } = req.body;

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const { tenantId, user } = await authRepo.createCompanyAndCEO(
      companyName,
      ceoName,
      email,
      passwordHash,
      primaryColor,
      secondaryColor,
      logoUrl,
    );

    const token = jwt.sign(
      {
        userId: user.id,
        tenant_id: tenantId,
        role: user.role,
        name: ceoName,
        email: email,
        primary_color: primaryColor || "#4f46e5",
        secondary_color: secondaryColor || "#ffffff",
        logo_url: logoUrl,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    // ✅ SET COOKIE
    res.cookie("token", token, getCookieOptions());

    res.status(201).json({
      status: "success",
      message: "Company registered successfully",
      data: {
        id: user.id,
        name: ceoName,
        email,
        role: user.role,
        tenant_id: tenantId,
      },
    });
  } catch (error) {
    if (error.code === "23505") {
      res.status(400);
      next(new Error("Email is already registered."));
    } else {
      next(error);
    }
  }
};

// ================= LOGIN =================
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await authRepo.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user.is_active === false) {
      return res.status(403).json({
        status: "error",
        message:
          "Your account has been deactivated. Please contact your administrator.",
      });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
        name: user.name,
        email: user.email,
        department_id: user.department_id,
        market_id: user.market_id,
        store_id: user.store_id,
        primary_color: user.primary_color || "#4f46e5",
        secondary_color: user.secondary_color || "#ffffff",
        logo_url: user.logo_url,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    // ✅ SET COOKIE
    res.cookie("token", token, getCookieOptions());

    res.status(200).json({
      status: "success",
      message: "Logged in successfully",
      data: {
        id: user.id,
        name: user.name,
        role: user.role,
        tenant_id: user.tenant_id,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ================= LOGOUT =================
const logout = async (req, res, next) => {
  try {
    const isProd = process.env.NODE_ENV === "production";

    res.clearCookie("token", {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      path: "/", // MUST match
    });

    // 🔥 EXTRA SAFETY (forces delete)
    res.cookie("token", "", {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      expires: new Date(0),
      path: "/",
    });

    res.status(200).json({
      status: "success",
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ================= CHANGE PASSWORD =================
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id || req.user.userId;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        status: "error",
        message: "Current and new passwords are required.",
      });
    }

    const userRecord = await userRepo.getPasswordHashById(userId);
    if (!userRecord) {
      return res.status(404).json({
        status: "error",
        message: "User not found.",
      });
    }

    const isMatch = await bcrypt.compare(
      currentPassword,
      userRecord.password_hash,
    );

    if (!isMatch) {
      return res.status(401).json({
        status: "error",
        message: "Incorrect current password.",
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await userRepo.updatePassword(userId, newPasswordHash);

    res.status(200).json({
      status: "success",
      message: "Password updated successfully.",
    });
  } catch (error) {
    console.error("Change Password Error:", error);
    next(error);
  }
};

// ================= GET ME =================
const getMe = async (req, res, next) => {
  try {
    res.status(200).json({
      status: "success",
      data: req.user,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerCompany,
  login,
  logout,
  changePassword,
  getMe,
};
