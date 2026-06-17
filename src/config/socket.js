const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let io;
const connectedUsers = new Map();

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      // 🔥 FIX 1: Explicitly list your frontend URLs instead of "*"
      origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
      methods: ["GET", "POST"],
      // 🔥 FIX 2: Explicitly tell Socket.IO to accept cookies
      credentials: true,
    },
  });

  // 🛡️ The Socket Gatekeeper (JWT Handshake via Cookie)
  io.use((socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie;
    let token = null;

    if (cookieHeader) {
      const cookies = cookieHeader.split(";").reduce((acc, current) => {
        const [name, ...value] = current.trim().split("=");
        acc[name] = value.join("=");
        return acc;
      }, {});

      token = cookies.token;
    }

    if (!token) {
      return next(
        new Error("Authentication error: No token provided in cookies"),
      );
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (error) {
      return next(new Error("Authentication error: Invalid or expired token"));
    }
  });

  // 🟢 Handle Verified Connections
  io.on("connection", (socket) => {
    // Fallback to id if userId isn't structured exactly as expected
    const userId = socket.user.userId || socket.user.id;
    const tenantId = socket.user.tenant_id;

    console.log(`🟢 User Connected: ${userId} (Socket: ${socket.id})`);

    // 1. Register the user in our live map so we can find them later
    connectedUsers.set(String(userId), socket.id);

    // 2. Securely isolate the user by forcing them to join a room specific to their company
    socket.join(`tenant_${tenantId}`);

    // ==========================================
    // 🟢 WEBRTC SIGNALING FOR FREE VOICE HUDDLES
    // ==========================================

    // 1. Join a specific call room
    socket.on("join_huddle_room", ({ roomName }) => {
      socket.join(roomName);
      console.log(`🎙️ User ${userId} joined huddle room: ${roomName}`);

      // Tell others in the room that someone arrived so they can start the WebRTC handshake
      socket.to(roomName).emit("user_joined_huddle", { userId });
    });

    // 2. Relay WebRTC Offer (Caller -> Callee)
    socket.on("webrtc_offer", ({ offer, roomName }) => {
      socket.to(roomName).emit("webrtc_offer", {
        offer,
        senderId: userId,
      });
    });

    // 3. Relay WebRTC Answer (Callee -> Caller)
    socket.on("webrtc_answer", ({ answer, roomName }) => {
      socket.to(roomName).emit("webrtc_answer", {
        answer,
        senderId: userId,
      });
    });

    // 4. Relay ICE Candidates (Network routing coordinates)
    socket.on("webrtc_ice_candidate", ({ candidate, roomName }) => {
      socket.to(roomName).emit("webrtc_ice_candidate", {
        candidate,
        senderId: userId,
      });
    });

    // 5. Handle someone leaving the call early
    socket.on("leave_huddle_room", ({ roomName }) => {
      socket.leave(roomName);
      console.log(`👋 User ${userId} left huddle room: ${roomName}`);
      socket.to(roomName).emit("user_left_huddle", { userId });
    });

    // ==========================================

    // 🔴 Handle Disconnection
    socket.on("disconnect", () => {
      console.log(`🔴 User Disconnected: ${userId}`);
      connectedUsers.delete(String(userId)); // Remove them from the live registry
    });
  });
};

// --- Helper Functions for the rest of your app to use ---

// Gets the specific Socket ID for a user so we can send them a direct message
const getSocketIdForUser = (userId) => {
  return connectedUsers.get(String(userId));
};

// Gets the global IO object so we can broadcast messages from our Controllers/Services
const getIO = () => {
  if (!io) throw new Error("Socket.io has not been initialized!");
  return io;
};

module.exports = {
  initializeSocket,
  getSocketIdForUser,
  getIO,
};
