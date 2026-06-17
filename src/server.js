require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

// Twilio
const { twiml, jwt } = require("twilio");
const VoiceResponse = twiml.VoiceResponse;
const AccessToken = jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

// Local Imports
const errorHandler = require("./middlewares/errorHandler");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const { initializeSocket } = require("./config/socket");

const app = express();

// Socket.IO
const server = http.createServer(app);
initializeSocket(server);

// Security
app.use(helmet());

// CORS
const allowedOrigins = ["http://localhost:5173", process.env.FRONTEND_URL];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

// Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Health Check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "OK",
    message: "SaaS Ticketing Server is running",
    timestamp: new Date().toISOString(),
  });
});

// ================= TWILIO =================

app.post("/api/token", (req, res) => {
  const { identity } = req.body;

  if (!identity) {
    return res.status(400).json({
      success: false,
      message: "Identity is required",
    });
  }

  try {
    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });

    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { identity },
    );

    token.addGrant(voiceGrant);

    res.json({
      success: true,
      token: token.toJwt(),
      identity,
    });
  } catch (err) {
    console.error("❌ Twilio Token Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to generate token",
    });
  }
});

app.post("/api/voice", (req, res) => {
  const response = new VoiceResponse();
  const { To: to } = req.body;

  if (to) {
    const dial = response.dial();
    dial.client(to);
  } else {
    response.say("Error: No destination client specified.");
  }

  res.type("text/xml");
  res.send(response.toString());
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/groups", require("./routes/groupRoutes"));
app.use("/api/categories", require("./routes/categoryRoutes"));


// Error Handler
app.use(errorHandler);

// --- ADD THIS CODE TO START THE SERVER ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server and WebSockets running on port ${PORT}`);
});

// Export for Vercel (optional, keep it if you need it)
module.exports = app;
