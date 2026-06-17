const errorHandler = (err, req, res, next) => {
  // Log the error to your server console for debugging
  console.error(`❌ Server Error: ${err.message}`);

  // If the status code wasn't already set to an error code, default to 500
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

  res.status(statusCode).json({
    status: "error",
    message: err.message,
    // In production, hide the stack trace so hackers can't see your folder structure
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  });
};

module.exports = errorHandler;
