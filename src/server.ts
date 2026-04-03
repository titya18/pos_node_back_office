import "dotenv/config";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import app from "./app"; // Import the Express app
import { startVatSyncRetryJob } from "./jobs/vatSyncRetry.job";

// I used socket io for real time update user role permission that effect sidebar componen or other components
// For Socket IO
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  path: "/socket.io",
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Socket IO Events
io.on("connection", (socket) => {

  socket.on("upsertRole", (roleData) => {
    if (
      !roleData ||
      typeof roleData.id === "undefined" ||
      !Array.isArray(roleData.permissions)
    ) {
      return;
    }
    io.emit("permissionsUpdated", {
      id: roleData.id,
      permissions: roleData.permissions.map(String),
    });
  });

  socket.on("disconnect", () => {});
});
// End Socket IO Events

// Start the server
const PORT = process.env.APP_PORT || 4000;
server.listen(PORT, () => {
  console.log(`Backend server is running at http://localhost:${PORT}`);

  // START VAT SYNC RETRY CRON HERE
  startVatSyncRetryJob();
}).on("error", (err) => {
  console.error("Server failed to start:", err);
});

// // Use it when deploy on server
// server.listen(4000, '0.0.0.0', () => {
//   console.log('Backend server is running on port 4000');
// });