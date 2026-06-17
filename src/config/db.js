const { Pool } = require("pg");
require("dotenv").config();
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,

  ssl: {
    rejectUnauthorized: false,
  },

  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.connect((err, client, release) => {
  if (err) {
    console.error("Error acquiring client from AWS RDS database:", err.stack);
  } else {
    console.log("Successfully connected to AWS RDS PostgreSQL");
  }
  if (client) release();
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
