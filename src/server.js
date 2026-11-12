require("dotenv").config();
const http = require("http");
const app = require("./app");
const connectDB = require("./config/db");
const { initSocket } = require("./utils/socket");

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();
    const server = http.createServer(app);
    initSocket(server);
    server.listen(PORT, () => {
      process.stdout.write(`Server listening on port ${PORT}\n`);
    });
  } catch (err) {
    process.stderr.write(`Failed to start server: ${err.message}\n`);
    process.exit(1);
  }
}

startServer();
