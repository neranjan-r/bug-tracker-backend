const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const { UPLOADS_DIR } = require("./utils/storage");
const authRoutes = require("./routes/authRoutes");
const projectRoutes = require("./routes/projectRoutes");
const { projectTicketRouter, ticketRouter } = require("./routes/ticketRoutes");
const { ticketCommentRouter, commentRouter } = require("./routes/commentRoutes");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();
app.set("trust proxy", 1);

// Allow configured client origin only
const allowedOrigin = (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no Origin header (e.g. curl/Postman/server health checks)
      if (!origin || origin === allowedOrigin) {
        return callback(null, true);
      }
      const err = new Error("Not allowed by CORS");
      err.statusCode = 403;
      return callback(err);
    },
    credentials: true,
  })
);

if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    data: { status: "ok" },
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/projects/:projectId/tickets", projectTicketRouter);
app.use("/api/tickets/:ticketId/comments", ticketCommentRouter);
app.use("/api/tickets", ticketRouter);
app.use("/api/comments", commentRouter);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

