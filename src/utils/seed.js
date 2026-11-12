const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const Project = require("../models/Project");
const Ticket = require("../models/Ticket");
const Comment = require("../models/Comment");

const DEMO_USERS = [
  { name: "Alex Morgan", email: "alex@demo.dev", password: "demo1234" },
  { name: "Sam Rivera", email: "sam@demo.dev", password: "demo1234" },
  { name: "Taylor Brooks", email: "taylor@demo.dev", password: "demo1234" },
];

async function seed() {
  await connectDB();

  const demoEmails = DEMO_USERS.map((u) => u.email);
  const existingUsers = await User.find({ email: { $in: demoEmails } }).select("_id");
  const existingUserIds = existingUsers.map((u) => u._id);

  if (existingUserIds.length > 0) {
    const oldProjects = await Project.find({ owner: { $in: existingUserIds } }).select(
      "_id"
    );
    const oldProjectIds = oldProjects.map((p) => p._id);
    if (oldProjectIds.length > 0) {
      const oldTickets = await Ticket.find({
        project: { $in: oldProjectIds },
      }).select("_id");
      const oldTicketIds = oldTickets.map((t) => t._id);
      await Comment.deleteMany({ ticket: { $in: oldTicketIds } });
      await Ticket.deleteMany({ project: { $in: oldProjectIds } });
      await Project.deleteMany({ _id: { $in: oldProjectIds } });
    }
    await User.deleteMany({ _id: { $in: existingUserIds } });
  }

  const createdUsers = [];
  for (const userData of DEMO_USERS) {
    createdUsers.push(await User.create(userData));
  }
  const [owner, developer, viewer] = createdUsers;

  const project = await Project.create({
    title: "CloudPulse Web Platform",
    description:
      "Customer analytics dashboard, billing portal, and API gateway tracking.",
    owner: owner._id,
    members: [
      { user: developer._id, role: "developer" },
      { user: viewer._id, role: "viewer" },
    ],
  });

  const ticketSeeds = [
    // To Do (6)
    {
      title: "Fix OAuth callback redirect loop on Safari",
      description:
        "Users signing in via Safari 18 get redirected back to /login when third-party cookies are blocked.",
      type: "bug",
      priority: "critical",
      status: "todo",
      reporter: developer._id,
      assignee: developer._id,
    },
    {
      title: "Add CSV export for monthly usage report",
      description:
        "Allow workspace owners to export usage metrics filtered by date range as UTF-8 CSV.",
      type: "feature",
      priority: "medium",
      status: "todo",
      reporter: owner._id,
      assignee: owner._id,
    },
    {
      title: "Rate limit password reset endpoint",
      description:
        "Apply 5 requests per 15-minute IP window to prevent email flooding.",
      type: "task",
      priority: "high",
      status: "todo",
      reporter: owner._id,
      assignee: null,
    },
    {
      title: "Dashboard chart tooltip clips near viewport edge",
      description:
        "Hovering over the rightmost bar in the weekly chart clips the tooltip on 375px screens.",
      type: "bug",
      priority: "low",
      status: "todo",
      reporter: developer._id,
      assignee: developer._id,
    },
    {
      title: "Support keyboard shortcuts on Kanban cards",
      description:
        "Ensure focus outline and arrow-key reordering work seamlessly across all columns.",
      type: "feature",
      priority: "medium",
      status: "todo",
      reporter: owner._id,
      assignee: null,
    },
    {
      title: "Audit dependency versions before v2.1 release",
      description: "Run npm audit across server and client packages and patch advisories.",
      type: "task",
      priority: "low",
      status: "todo",
      reporter: owner._id,
      assignee: owner._id,
    },

    // In Progress (5)
    {
      title: "Memory spike during large CSV webhook imports",
      description:
        "Stream incoming payloads instead of buffering entire files in memory.",
      type: "bug",
      priority: "critical",
      status: "in-progress",
      reporter: owner._id,
      assignee: developer._id,
    },
    {
      title: "Implement dark-mode theme toggle in user menu",
      description: "Persist user preference in localStorage and respect OS prefers-color-scheme.",
      type: "feature",
      priority: "high",
      status: "in-progress",
      reporter: developer._id,
      assignee: developer._id,
    },
    {
      title: "Upgrade Node runtime and Mongoose connection pooling",
      description: "Configure maxPoolSize and graceful SIGTERM shutdown in production.",
      type: "task",
      priority: "medium",
      status: "in-progress",
      reporter: owner._id,
      assignee: owner._id,
    },
    {
      title: "Notification bell shows stale unread badge after read",
      description: "Clear unread count immediately when drawer closes.",
      type: "bug",
      priority: "medium",
      status: "in-progress",
      reporter: developer._id,
      assignee: null,
    },
    {
      title: "Add webhook retry backoff with dead-letter queue",
      description: "Retry failed webhook deliveries up to 5 times with exponential backoff.",
      type: "feature",
      priority: "high",
      status: "in-progress",
      reporter: owner._id,
      assignee: developer._id,
    },

    // Done (4)
    {
      title: "Configure Helmet security headers and strict CORS",
      description: "Restrict cross-origin access to CLIENT_URL and enable Helmet defaults.",
      type: "task",
      priority: "high",
      status: "done",
      reporter: owner._id,
      assignee: owner._id,
    },
    {
      title: "Fix broken avatar initials for hyphenated names",
      description: "Split on whitespace cleanly and fall back gracefully on single names.",
      type: "bug",
      priority: "low",
      status: "done",
      reporter: developer._id,
      assignee: developer._id,
    },
    {
      title: "Add project summary metrics endpoint",
      description: "Aggregate status, priority, and assigned-to-me ticket counts in one request.",
      type: "feature",
      priority: "medium",
      status: "done",
      reporter: owner._id,
      assignee: developer._id,
    },
    {
      title: "Set up automated API integration tests",
      description: "Cover auth, role access control, uploads, and Socket.io room authorization.",
      type: "task",
      priority: "high",
      status: "done",
      reporter: owner._id,
      assignee: owner._id,
    },
  ];

  const orderByStatus = { todo: 0, "in-progress": 0, done: 0 };
  const createdTickets = [];
  for (const item of ticketSeeds) {
    const order = orderByStatus[item.status]++;
    const doc = await Ticket.create({
      ...item,
      project: project._id,
      order,
    });
    createdTickets.push(doc);
  }

  // Add realistic comments & 1-level replies
  const firstBug = createdTickets[0];
  const c1 = await Comment.create({
    ticket: firstBug._id,
    author: developer._id,
    text: "Reproduced on Safari 18 with ITP enabled. Looks like the state cookie needs SameSite=Lax.",
  });
  await Comment.create({
    ticket: firstBug._id,
    author: owner._id,
    text: "Good catch! Let's also verify the mobile iOS Safari flow before merging.",
    parent: c1._id,
  });

  const memBug = createdTickets[6];
  const c2 = await Comment.create({
    ticket: memBug._id,
    author: owner._id,
    text: "Heap peaked at 1.4 GB during yesterday's 50k-row import.",
  });
  await Comment.create({
    ticket: memBug._id,
    author: developer._id,
    text: "Switching to a Transform stream now—initial benchmark stays under 180 MB.",
    parent: c2._id,
  });
  await Comment.create({
    ticket: memBug._id,
    author: owner._id,
    text: "Awesome, please attach the memory profile screenshot once complete.",
  });

  process.stdout.write(
    [
      "Seed completed successfully!",
      `Project: ${project.title} (${project._id})`,
      "Demo accounts (password for all: demo1234):",
      "  Owner:     alex@demo.dev",
      "  Developer: sam@demo.dev",
      "  Viewer:    taylor@demo.dev",
      `Tickets created: ${createdTickets.length}`,
      "",
    ].join("\n")
  );

  await mongoose.disconnect();
}

if (require.main === module) {
  seed().catch(async (err) => {
    process.stderr.write(`Seed failed: ${err.message}\n`);
    await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = seed;
