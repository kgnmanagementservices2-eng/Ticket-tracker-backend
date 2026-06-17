const { z } = require("zod");

// This middleware takes a Zod schema and checks the incoming request body against it.
const validateBody = (schema) => {
  return (req, res, next) => {
    try {
      // If the data is valid, it replaces req.body with the cleaned data
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      return res.status(400).json({
        status: "error",
        message: "Invalid request data",
        // This maps Zod's detailed errors into a clean array for the frontend
        errors: error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }
  };
};

module.exports = { validateBody };
