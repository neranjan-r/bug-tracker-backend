process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_key_for_bug_tracker_suite";
process.env.CLIENT_URL = "http://localhost:5173";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { io: ClientSocket } = require("socket.io-client");

const app = require("../src/app");
const { initSocket } = require("../src/utils/socket");
const { UPLOADS_DIR } = require("../src/utils/storage");

// Minimal valid 1x1 PNG bytes
const VALID_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
);

describe("Bug Tracker API & Security Suite", () => {
  let mongod;
  let httpServer;
  let baseUrl;

  let ownerToken;
  let devToken;
  let viewerToken;
  let strangerToken;

  let ownerId;
  let devId;
  let viewerId;
  let strangerId;

  let projectId;
  let ownerTicketId;
  let devTicketId;
  let topCommentId;

  before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    httpServer = http.createServer(app);
    initSocket(httpServer);
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = httpServer.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    // Clean any test files left in uploads
    if (fs.existsSync(UPLOADS_DIR)) {
      for (const file of fs.readdirSync(UPLOADS_DIR)) {
        if (file !== ".gitkeep") {
          fs.rmSync(path.join(UPLOADS_DIR, file), { force: true });
        }
      }
    }
  });

  it("1. Health check & unauthenticated protection", async () => {
    const health = await request(app).get("/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { success: true, data: { status: "ok" } });

    const noAuthMe = await request(app).get("/api/auth/me");
    assert.equal(noAuthMe.status, 401);
    assert.equal(noAuthMe.body.success, false);

    const noAuthProjects = await request(app).get("/api/projects");
    assert.equal(noAuthProjects.status, 401);
  });

  it("2. Register users and test wrong password & fake/expired token", async () => {
    const ownerRes = await request(app).post("/api/auth/register").send({
      name: "Alice Owner",
      email: "owner@example.com",
      password: "password123",
    });
    assert.equal(ownerRes.status, 201);
    assert.equal(ownerRes.body.data.user.password, undefined);
    ownerToken = ownerRes.body.data.token;
    ownerId = ownerRes.body.data.user.id;

    const devRes = await request(app).post("/api/auth/register").send({
      name: "Bob Dev",
      email: "dev@example.com",
      password: "password123",
    });
    assert.equal(devRes.status, 201);
    devToken = devRes.body.data.token;
    devId = devRes.body.data.user.id;

    const viewerRes = await request(app).post("/api/auth/register").send({
      name: "Cara Viewer",
      email: "viewer@example.com",
      password: "password123",
    });
    assert.equal(viewerRes.status, 201);
    viewerToken = viewerRes.body.data.token;
    viewerId = viewerRes.body.data.user.id;

    const strangerRes = await request(app).post("/api/auth/register").send({
      name: "Dan Stranger",
      email: "stranger@example.com",
      password: "password123",
    });
    assert.equal(strangerRes.status, 201);
    strangerToken = strangerRes.body.data.token;
    strangerId = strangerRes.body.data.user.id;

    // Security Case: wrong password -> 401 generic message
    const badLogin = await request(app).post("/api/auth/login").send({
      email: "owner@example.com",
      password: "wrong_password",
    });
    assert.equal(badLogin.status, 401);
    assert.equal(badLogin.body.message, "Invalid email or password");

    // Security Case: unknown email -> same generic message
    const badEmailLogin = await request(app).post("/api/auth/login").send({
      email: "nobody@example.com",
      password: "password123",
    });
    assert.equal(badEmailLogin.status, 401);
    assert.equal(badEmailLogin.body.message, "Invalid email or password");

    // Security Case: fake/expired token -> 401
    const fakeTokenRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer invalid.jwt.token");
    assert.equal(fakeTokenRes.status, 401);
  });

  it("3. Create project, manage members, and verify stranger gets 404", async () => {
    const createProj = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Core API", description: "Main backend tracker" });
    assert.equal(createProj.status, 201);
    projectId = createProj.body.data.project._id;

    const addDev = await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "dev@example.com", role: "developer" });
    assert.equal(addDev.status, 201);

    const addViewer = await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "viewer@example.com", role: "viewer" });
    assert.equal(addViewer.status, 201);

    // Security Case: stranger opening a project by id -> 404 (not 403)
    const strangerGet = await request(app)
      .get(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${strangerToken}`);
    assert.equal(strangerGet.status, 404);

    // Invalid ObjectId -> 400
    const badIdGet = await request(app)
      .get("/api/projects/not-a-valid-id")
      .set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(badIdGet.status, 400);
  });

  it("4. Tickets CRUD, role enforcement, outside assignee rejection, and Kanban move", async () => {
    // Security Case: viewer trying to create a ticket -> 403
    const viewerCreate = await request(app)
      .post(`/api/projects/${projectId}/tickets`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ title: "Viewer should fail" });
    assert.equal(viewerCreate.status, 403);

    // Security Case: assignee outside the project -> 400
    const outsideAssignee = await request(app)
      .post(`/api/projects/${projectId}/tickets`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: "Outside assignee", assignee: strangerId });
    assert.equal(outsideAssignee.status, 400);

    // Owner creates ticket 1 & 2
    const t1 = await request(app)
      .post(`/api/projects/${projectId}/tickets`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        title: "Fix login crash",
        description: "Crash on empty token",
        type: "bug",
        priority: "critical",
        assignee: devId,
      });
    assert.equal(t1.status, 201);
    ownerTicketId = t1.body.data.ticket._id;
    assert.equal(t1.body.data.ticket.order, 0);

    const t2 = await request(app)
      .post(`/api/projects/${projectId}/tickets`)
      .set("Authorization", `Bearer ${devToken}`)
      .send({
        title: "Add dark mode",
        type: "feature",
        priority: "low",
      });
    assert.equal(t2.status, 201);
    devTicketId = t2.body.data.ticket._id;
    assert.equal(t2.body.data.ticket.order, 1);

    // Security Case: developer deleting someone else's ticket -> 403
    const devDeleteOwnerTicket = await request(app)
      .delete(`/api/tickets/${ownerTicketId}`)
      .set("Authorization", `Bearer ${devToken}`);
    assert.equal(devDeleteOwnerTicket.status, 403);

    // Move ticket to in-progress position 0
    const moveRes = await request(app)
      .patch(`/api/tickets/${ownerTicketId}/move`)
      .set("Authorization", `Bearer ${devToken}`)
      .send({ status: "in-progress", position: 0 });
    assert.equal(moveRes.status, 200);
    assert.equal(moveRes.body.data.ticket.status, "in-progress");
    assert.equal(moveRes.body.data.ticket.order, 0);

    // Filter & search
    const searchRes = await request(app)
      .get(`/api/projects/${projectId}/tickets?search=login&priority=critical`)
      .set("Authorization", `Bearer ${viewerToken}`);
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.body.data.tickets.length, 1);
    assert.equal(searchRes.body.data.tickets[0]._id, ownerTicketId);

    // Stats endpoint
    const statsRes = await request(app)
      .get(`/api/projects/${projectId}/stats`)
      .set("Authorization", `Bearer ${devToken}`);
    assert.equal(statsRes.status, 200);
    assert.equal(statsRes.body.data.stats.total, 2);
    assert.equal(statsRes.body.data.stats.byStatus["in-progress"], 1);
    assert.equal(statsRes.body.data.stats.assignedToMe, 1);
  });

  it("5. Comments, 1-level replies, and very long comment rejection", async () => {
    // Security Case: very long comment -> 400
    const longRes = await request(app)
      .post(`/api/tickets/${ownerTicketId}/comments`)
      .set("Authorization", `Bearer ${devToken}`)
      .send({ text: "a".repeat(2500) });
    assert.equal(longRes.status, 400);

    // Viewer cannot comment -> 403
    const viewerComment = await request(app)
      .post(`/api/tickets/${ownerTicketId}/comments`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ text: "Viewer trying to comment" });
    assert.equal(viewerComment.status, 403);

    // Post top-level comment
    const c1 = await request(app)
      .post(`/api/tickets/${ownerTicketId}/comments`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ text: "Investigating now" });
    assert.equal(c1.status, 201);
    topCommentId = c1.body.data.comment._id;

    // Reply level 1 succeeds
    const r1 = await request(app)
      .post(`/api/tickets/${ownerTicketId}/comments`)
      .set("Authorization", `Bearer ${devToken}`)
      .send({ text: "Reproduced locally", parent: topCommentId });
    assert.equal(r1.status, 201);

    // Reply level 2 blocked
    const r2 = await request(app)
      .post(`/api/tickets/${ownerTicketId}/comments`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ text: "Nested reply", parent: r1.body.data.comment._id });
    assert.equal(r2.status, 400);
  });

  it("6. Screenshot upload valid PNG vs rejected .pdf and spoofed .png", async () => {
    const validUpload = await request(app)
      .post(`/api/tickets/${ownerTicketId}/attachments`)
      .set("Authorization", `Bearer ${devToken}`)
      .attach("attachments", VALID_PNG, {
        filename: "screen.png",
        contentType: "image/png",
      });
    assert.equal(validUpload.status, 201);
    assert.equal(validUpload.body.data.ticket.attachments.length, 1);

    const pdfUpload = await request(app)
      .post(`/api/tickets/${ownerTicketId}/attachments`)
      .set("Authorization", `Bearer ${devToken}`)
      .attach("attachments", Buffer.from("%PDF-1.4"), {
        filename: "doc.pdf",
        contentType: "application/pdf",
      });
    assert.equal(pdfUpload.status, 400);

    const spoofedUpload = await request(app)
      .post(`/api/tickets/${ownerTicketId}/attachments`)
      .set("Authorization", `Bearer ${devToken}`)
      .attach("attachments", Buffer.from("%PDF-1.4-not-an-image"), {
        filename: "fake.png",
        contentType: "image/png",
      });
    assert.equal(spoofedUpload.status, 400);

    const deleteAtt = await request(app)
      .delete(`/api/tickets/${ownerTicketId}/attachments/0`)
      .set("Authorization", `Bearer ${devToken}`);
    assert.equal(deleteAtt.status, 200);
    assert.equal(deleteAtt.body.data.ticket.attachments.length, 0);
  });

  it("7. Socket.io rejects invalid token and authorizes project rooms", async () => {
    await new Promise((resolve, reject) => {
      const badSocket = ClientSocket(baseUrl, {
        auth: { token: "bad_token" },
        reconnection: false,
      });
      badSocket.on("connect_error", () => {
        badSocket.close();
        resolve();
      });
      badSocket.on("connect", () => {
        badSocket.close();
        reject(new Error("Should not connect with invalid token"));
      });
    });

    const devSocket = ClientSocket(baseUrl, {
      auth: { token: devToken },
      reconnection: false,
    });
    await new Promise((resolve) => devSocket.on("connect", resolve));

    const joinOk = await new Promise((resolve) =>
      devSocket.emit("project:join", projectId, resolve)
    );
    assert.equal(joinOk.ok, true);
    devSocket.close();

    const strangerSocket = ClientSocket(baseUrl, {
      auth: { token: strangerToken },
      reconnection: false,
    });
    await new Promise((resolve) => strangerSocket.on("connect", resolve));
    const joinDenied = await new Promise((resolve) =>
      strangerSocket.emit("project:join", projectId, resolve)
    );
    assert.equal(joinDenied.ok, false);
    strangerSocket.close();
  });
});

