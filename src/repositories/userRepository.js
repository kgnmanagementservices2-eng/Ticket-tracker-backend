const db = require("../config/db");

// 1. Fetch just the password hash for a specific user
const getPasswordHashById = async (userId) => {
  const res = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [
    userId,
  ]);
  return res.rows[0]; // Returns { password_hash: "..." }
};

// 2. Update the password hash
const updatePassword = async (userId, newHash) => {
  await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
    newHash,
    userId,
  ]);
};

module.exports = {
  getPasswordHashById,
  updatePassword,
};
