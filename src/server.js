require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

// Twilio (WebRTC + Tokens)
const { twiml, jwt } = require("twilio");
const VoiceResponse = twiml.VoiceResponse;
const AccessToken = jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

// Local Imports
const db = require("./config/db");
const errorHandler = require("./middlewares/errorHandler");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const ticketRoutes = require("./routes/ticketRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const { initializeSocket } = require("./config/socket");

const app = express();
const server = http.createServer(app);

// ✅ Initialize Socket.IO
initializeSocket(server);

// 🔒 Security
app.use(helmet());

// ✅ ✅ FIXED: SINGLE CORS CONFIG (VERY IMPORTANT)
app.use(
  cors({
    origin: "http://localhost:5173", // frontend URL
    credentials: true, // 🔥 REQUIRED for cookies
  }),
);

// ✅ Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ✅ Cookie Parser (MUST come before routes)
app.use(cookieParser());

// ✅ Health Check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "SaaS Ticketing Server is running",
  });
});

// ================= TWILIO =================

// 🎟️ Generate Access Token
app.post("/api/token", (req, res) => {
  const identity = req.body.identity;

  if (!identity) {
    return res.status(400).send("Identity is required");
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
      token: token.toJwt(),
      identity,
    });
  } catch (err) {
    console.error("❌ Twilio Token Error:", err.message);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

// 📞 Voice Webhook
app.post("/api/voice", (req, res) => {
  const response = new VoiceResponse();
  const to = req.body.To;

  if (to) {
    const dial = response.dial();
    dial.client(to);
  } else {
    response.say("Error: No destination client specified.");
  }

  res.type("text/xml");
  res.send(response.toString());
});

// ================= ROUTES =================

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/groups", require("./routes/groupRoutes"));
app.use("/api/categories", require("./routes/categoryRoutes"));

// ================= ERROR HANDLER =================

app.use(errorHandler);

// ================= SERVER START =================

const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
