const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { getProjectWithRole } = require("./projectAccess");

let ioInstance = null;

/**
 * Initialize Socket.io on the HTTP server with JWT auth and project room checks.
 */
function initSocket(httpServer) {
  const allowedOrigin = process.env.CLIENT_URL || "http://localhost:5173";

  ioInstance = new Server(httpServer, {
    cors: {
      origin: allowedOrigin,
      credentials: true,
    },
  });

  ioInstance.use(async (socket, next) => {
    try {
      const authToken =
        socket.handshake.auth?.token ||
        (socket.handshake.headers?.authorization || "").replace(/^Bearer\s+/i, "");

      if (!authToken) {
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(authToken, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (!user) {
        return next(new Error("Invalid or expired token"));
      }

      socket.user = user;
      return next();
    } catch {
      return next(new Error("Invalid or expired token"));
    }
  });

  ioInstance.on("connection", (socket) => {
    socket.on("project:join", async (projectId, callback) => {
      try {
        const access = await getProjectWithRole(projectId, socket.user._id);
        if (!access.project) {
          if (typeof callback === "function") {
            callback({ ok: false, message: "Project not found" });
          }
          return;
        }

        socket.join(`project:${access.project._id.toString()}`);
        if (typeof callback === "function") {
          callback({ ok: true });
        }
      } catch {
        if (typeof callback === "function") {
          callback({ ok: false, message: "Could not join project room" });
        }
      }
    });

    socket.on("project:leave", (projectId) => {
      if (projectId) {
        socket.leave(`project:${String(projectId)}`);
      }
    });
  });

  return ioInstance;
}

function getIO() {
  return ioInstance;
}

/**
 * Emit a real-time event to every authenticated member in the project room.
 */
function emitProjectEvent(projectId, event, payload) {
  if (!ioInstance || !projectId) return;
  ioInstance.to(`project:${projectId.toString()}`).emit(event, payload);
}

module.exports = {
  initSocket,
  getIO,
  emitProjectEvent,
};

