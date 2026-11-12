const path = require("path");
const zlib = require("zlib");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const Project = require("../models/Project");
const Ticket = require("../models/Ticket");
const Comment = require("../models/Comment");
const storage = require("./storage");

const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;

function hoursAgo(h) {
  return new Date(Date.now() - h * HOURS);
}

function daysAgo(d, extraHours = 0) {
  return new Date(Date.now() - d * DAYS - extraHours * HOURS);
}

// Build a valid lightweight raster PNG buffer for local seed screenshots without external dependencies
function buildSampleScreenshotPng(accentRgb = [201, 74, 30]) {
  const width = 320;
  const height = 180;
  const raw = Buffer.alloc(height * (1 + width * 4));

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 4;
      let r = 247;
      let g = 245;
      let b = 240;

      // Top header bar
      if (y < 28) {
        r = 239;
        g = 236;
        b = 228;
      } else if (y === 28 || x === 72) {
        r = 221;
        g = 216;
        b = 206;
      } else if (x > 96 && x < 296 && y > 48 && y < 74) {
        // Error banner highlight box
        r = 251;
        g = 239;
        b = 238;
      } else if (x > 96 && x < 164 && y > 92 && y < 110) {
        // Accent pill / bar
        [r, g, b] = accentRgb;
      } else if (x > 96 && x < 268 && y > 124 && y < 130) {
        r = 26;
        g = 25;
        b = 22;
      } else if (x > 96 && x < 224 && y > 140 && y < 145) {
        r = 102;
        g = 98;
        b = 91;
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = 255;
    }
  }

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", zlib.deflateSync(raw)),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

const DEMO_USERS = [
  { name: "Maya Lin", email: "maya.lin@tracebook.dev", password: "demo1234" },
  { name: "Devon Patel", email: "devon.patel@tracebook.dev", password: "demo1234" },
  { name: "Claire Okafor", email: "claire.okafor@tracebook.dev", password: "demo1234" },
  { name: "Jonah Berg", email: "jonah.berg@tracebook.dev", password: "demo1234" },
  { name: "Priya Nair", email: "priya.nair@tracebook.dev", password: "demo1234" },
];

const LEGACY_DEMO_EMAILS = [
  "alex@demo.dev",
  "sam@demo.dev",
  "taylor@demo.dev",
];

async function seed() {
  await connectDB();

  const cleanupEmails = [...DEMO_USERS.map((u) => u.email), ...LEGACY_DEMO_EMAILS];
  const existingUsers = await User.find({ email: { $in: cleanupEmails } }).select(
    "_id"
  );
  const existingUserIds = existingUsers.map((u) => u._id);

  if (existingUserIds.length > 0) {
    const oldProjects = await Project.find({
      $or: [
        { owner: { $in: existingUserIds } },
        { "members.user": { $in: existingUserIds } },
      ],
    }).select("_id");
    const oldProjectIds = oldProjects.map((p) => p._id);

    if (oldProjectIds.length > 0) {
      const oldTickets = await Ticket.find({
        project: { $in: oldProjectIds },
      }).select("_id attachments");
      for (const t of oldTickets) {
        for (const att of t.attachments || []) {
          await storage.deleteFile(att);
        }
      }
      const oldTicketIds = oldTickets.map((t) => t._id);
      await Comment.deleteMany({ ticket: { $in: oldTicketIds } });
      await Ticket.deleteMany({ project: { $in: oldProjectIds } });
      await Project.deleteMany({ _id: { $in: oldProjectIds } });
    }
    await User.deleteMany({ _id: { $in: existingUserIds } });
  }

  const [maya, devon, claire, jonah, priya] = await Promise.all(
    DEMO_USERS.map((u) => User.create(u))
  );

  // Create 2 small realistic raster PNG screenshots cleanly if local storage works
  const screenshot1 = await storage.saveFile({
    originalname: "safari-oauth-loop.png",
    mimetype: "image/png",
    buffer: buildSampleScreenshotPng([201, 74, 30]),
  });
  const screenshot2 = await storage.saveFile({
    originalname: "ios-receipt-crop.png",
    mimetype: "image/png",
    buffer: buildSampleScreenshotPng([185, 56, 44]),
  });

  const projectDefs = [
    {
      key: "PAY",
      title: "PulsePay API",
      description:
        "Checkout endpoints, idempotency locks, and webhook retry ledger.",
      owner: maya._id,
      members: [
        { user: devon._id, role: "developer" },
        { user: claire._id, role: "developer" },
        { user: priya._id, role: "developer" },
        { user: jonah._id, role: "viewer" },
      ],
      createdAt: daysAgo(21),
      updatedAt: hoursAgo(2),
      tickets: [
        {
          title: "Idempotency lock expires early on slow 3DS card challenges",
          description:
            "Steps:\n1. Start a checkout with a 3DS-challenged card and hold the challenge screen for 95 seconds.\n2. Complete verification and submit the confirmation callback.\n\nExpected: Original payment intent resumes.\nActual: API mints a duplicate charge attempt because Redis lock TTL is 60s.",
          type: "bug",
          priority: "critical",
          status: "in-progress",
          reporter: devon._id,
          assignee: maya._id,
          createdAt: daysAgo(3, 5),
          updatedAt: hoursAgo(2),
        },
        {
          title: "Safari 17 ignores Enter key on OAuth payout setup form",
          description:
            "Steps:\n1. Open Connect Payout Account on Safari 17.5.\n2. Fill routing and account fields, then press Enter.\n\nExpected: Form submits once.\nActual: Page reloads without triggering fetch because the submit button sits outside the form tag.",
          type: "bug",
          priority: "high",
          status: "todo",
          reporter: claire._id,
          assignee: devon._id,
          attachments: [screenshot1],
          createdAt: daysAgo(5, 2),
          updatedAt: hoursAgo(6),
        },
        {
          title: "Webhook retry jitter ignores 429 Retry-After header",
          description:
            "When a merchant endpoint returns 429 with Retry-After: 120, our worker still retries after 15 seconds and burns through 3 of 5 attempts.",
          type: "bug",
          priority: "high",
          status: "todo",
          reporter: maya._id,
          assignee: claire._id,
          createdAt: daysAgo(8),
          updatedAt: daysAgo(1, 3),
        },
        {
          title: "Add cursor pagination to /v1/settlements endpoint",
          description:
            "Large merchants timing out on offset=5000 queries during month-end reconciliation. Switch to created_at + id keyset cursor.",
          type: "feature",
          priority: "medium",
          status: "in-progress",
          reporter: maya._id,
          assignee: priya._id,
          createdAt: daysAgo(10),
          updatedAt: daysAgo(1, 8),
        },
        {
          title: "Store raw gateway decline code alongside mapped error key",
          description:
            "Support reps cannot tell issuer code 51 vs 65 apart without querying raw logs. Persist gateway_code on PaymentAttempt.",
          type: "task",
          priority: "medium",
          status: "todo",
          reporter: devon._id,
          assignee: null,
          createdAt: daysAgo(6),
          updatedAt: daysAgo(6),
        },
        {
          title: "Zero-decimal JPY amounts multiplied by 100 in invoice PDF",
          description:
            "Steps:\n1. Charge 4,200 JPY via invoice flow.\n2. Open generated receipt PDF.\n\nExpected: 4,200 JPY.\nActual: Shows 420,000 JPY because formatter skips currency precision map.",
          type: "bug",
          priority: "critical",
          status: "todo",
          reporter: priya._id,
          assignee: devon._id,
          createdAt: daysAgo(2, 4),
          updatedAt: hoursAgo(9),
        },
        {
          title: "Verify HMAC signature against raw request buffer",
          description:
            "Express JSON parser re-stringifies keys on nested metadata objects. Move webhook verification before json middleware.",
          type: "task",
          priority: "high",
          status: "done",
          reporter: maya._id,
          assignee: maya._id,
          createdAt: daysAgo(19),
          updatedAt: daysAgo(12),
        },
        {
          title: "Expose test-mode webhook replay button for failed deliveries",
          description:
            "Developers testing staging endpoints need one-click replay of the exact signed payload from delivery logs.",
          type: "feature",
          priority: "medium",
          status: "done",
          reporter: claire._id,
          assignee: claire._id,
          createdAt: daysAgo(17),
          updatedAt: daysAgo(9),
        },
        {
          title: "Partial refund modal accepts negative fee adjustment",
          description:
            "Validation allows entering -5.00 in platform_fee override input before server rejects with generic 400.",
          type: "bug",
          priority: "low",
          status: "todo",
          reporter: devon._id,
          assignee: null,
          createdAt: daysAgo(11),
          updatedAt: daysAgo(7),
        },
        {
          title: "Emit settlement.failed alert to Slack ops channel",
          description:
            "Post summary payload with merchant id, batch reference, and ACH return code whenever daily sweep fails.",
          type: "feature",
          priority: "medium",
          status: "in-progress",
          reporter: priya._id,
          assignee: priya._id,
          createdAt: daysAgo(7),
          updatedAt: daysAgo(2),
        },
        {
          title: "Rotate staging Stripe test webhook signing secret",
          description:
            "Update Secrets Manager staging entry and document rotation steps in runbook.",
          type: "task",
          priority: "low",
          status: "done",
          reporter: maya._id,
          assignee: maya._id,
          createdAt: daysAgo(18),
          updatedAt: daysAgo(15),
        },
      ],
    },
    {
      key: "FK",
      title: "FieldKit Mobile",
      description:
        "Offline work-order iOS client, photo compression queue, and SQLite sync.",
      owner: devon._id,
      members: [
        { user: claire._id, role: "developer" },
        { user: jonah._id, role: "developer" },
        { user: maya._id, role: "viewer" },
        { user: priya._id, role: "viewer" },
      ],
      createdAt: daysAgo(20),
      updatedAt: hoursAgo(5),
      tickets: [
        {
          title: "App crashes resuming photo upload queue after airplane mode",
          description:
            "Steps:\n1. Capture 3 inspection photos offline.\n2. Background the app for 10 minutes, toggle cellular back on, and tap Sync.\n\nExpected: Pending uploads resume cleanly.\nActual: Swift task throws NSFileReadNoSuchFileError because temp cache URLs rotated.",
          type: "bug",
          priority: "critical",
          status: "in-progress",
          reporter: jonah._id,
          assignee: devon._id,
          createdAt: daysAgo(4),
          updatedAt: hoursAgo(5),
        },
        {
          title: "Customer signature pad clips right edge on iPhone SE",
          description:
            "Horizontal scroll container inside the inspection modal trims 24px off the canvas width on 375px screens.",
          type: "bug",
          priority: "medium",
          status: "todo",
          reporter: claire._id,
          assignee: claire._id,
          attachments: [screenshot2],
          createdAt: daysAgo(9),
          updatedAt: daysAgo(3),
        },
        {
          title: "Downscale 12MP HEIC photos to 1600px JPEG before sync",
          description:
            "Technicians on 1-bar LTE sites spend 4+ minutes uploading a single work order with 6 raw HEIC originals.",
          type: "feature",
          priority: "high",
          status: "in-progress",
          reporter: devon._id,
          assignee: jonah._id,
          createdAt: daysAgo(12),
          updatedAt: daysAgo(1, 5),
        },
        {
          title: "SQLite WAL checkpoint spikes launch time past 3 seconds",
          description:
            "Run incremental passive checkpoint during background refresh instead of blocking main thread on app open.",
          type: "bug",
          priority: "high",
          status: "todo",
          reporter: devon._id,
          assignee: devon._id,
          createdAt: daysAgo(6),
          updatedAt: daysAgo(2),
        },
        {
          title: "Show last synced timestamp in job list header",
          description:
            "Display relative sync age ('Synced 4m ago') and warning state when offline queue has unsent changes.",
          type: "feature",
          priority: "medium",
          status: "todo",
          reporter: claire._id,
          assignee: null,
          createdAt: daysAgo(8),
          updatedAt: daysAgo(8),
        },
        {
          title: "Barcode scanner stays active after backing out of parts lookup",
          description:
            "AVCaptureSession remains open in background until tab switch or screen lock.",
          type: "bug",
          priority: "medium",
          status: "todo",
          reporter: jonah._id,
          assignee: jonah._id,
          createdAt: daysAgo(13),
          updatedAt: daysAgo(4),
        },
        {
          title: "Persist checklist draft automatically every 5 seconds",
          description:
            "Prevent data loss if iOS jetsams the app while technician switches to call dispatch.",
          type: "feature",
          priority: "high",
          status: "done",
          reporter: devon._id,
          assignee: claire._id,
          createdAt: daysAgo(16),
          updatedAt: daysAgo(7),
        },
        {
          title: "Drop unused CoreLocation background permission prompt",
          description:
            "App Store review flagged Always location key; Always authorization is not needed once check-in happens foreground-only.",
          type: "task",
          priority: "medium",
          status: "done",
          reporter: claire._id,
          assignee: devon._id,
          createdAt: daysAgo(18),
          updatedAt: daysAgo(11),
        },
        {
          title: "Keyboard covers notes textarea on bottom inspection item",
          description:
            "KeyboardAvoidance padding falls short by ~30pt on iOS 17 when predictive bar is expanded.",
          type: "bug",
          priority: "low",
          status: "todo",
          reporter: jonah._id,
          assignee: null,
          createdAt: daysAgo(7),
          updatedAt: daysAgo(7),
        },
        {
          title: "Add TestFlight crash symbol upload step to CI workflow",
          description:
            "Upload dSYMs automatically on tagged release builds in GitHub Actions.",
          type: "task",
          priority: "low",
          status: "done",
          reporter: devon._id,
          assignee: jonah._id,
          createdAt: daysAgo(19),
          updatedAt: daysAgo(14),
        },
      ],
    },
    {
      key: "OPS",
      title: "OpsConsole",
      description:
        "Support queue triage, customer feature flags, and audit log viewer.",
      owner: claire._id,
      members: [
        { user: maya._id, role: "developer" },
        { user: devon._id, role: "developer" },
        { user: jonah._id, role: "viewer" },
      ],
      createdAt: daysAgo(16),
      updatedAt: daysAgo(1),
      tickets: [
        {
          title: "CSV export drops rows when company name contains commas",
          description:
            "Steps:\n1. Filter customers with active billing holds.\n2. Click Export CSV and open in Excel.\n\nExpected: Quoted fields remain intact.\nActual: Unescaped commas in organization_name split values into shifted columns.",
          type: "bug",
          priority: "high",
          status: "in-progress",
          reporter: claire._id,
          assignee: maya._id,
          createdAt: daysAgo(4),
          updatedAt: daysAgo(1),
        },
        {
          title: "Audit log date range filter shifts by local timezone offset",
          description:
            "Selecting Oct 14 to Oct 14 queries 18:30 UTC previous day in IST and hides morning entries.",
          type: "bug",
          priority: "medium",
          status: "todo",
          reporter: maya._id,
          assignee: devon._id,
          createdAt: daysAgo(6),
          updatedAt: daysAgo(2),
        },
        {
          title: "Require confirmation text when disabling a production flag",
          description:
            "Operators accidentally clicked off billing_v2 toggle with one click during call handling. Add flag key confirmation modal.",
          type: "feature",
          priority: "high",
          status: "todo",
          reporter: claire._id,
          assignee: claire._id,
          createdAt: daysAgo(5),
          updatedAt: daysAgo(1, 6),
        },
        {
          title: "Account search returns 500 on queries ending with backslash",
          description:
            "Raw search input reaches RegExp without escaping special characters.",
          type: "bug",
          priority: "medium",
          status: "done",
          reporter: devon._id,
          assignee: maya._id,
          createdAt: daysAgo(14),
          updatedAt: daysAgo(8),
        },
        {
          title: "Add keyboard shortcut J/K to step through support queue rows",
          description:
            "Support leads triage 100+ items daily and asked for list row focus navigation plus Enter to open.",
          type: "feature",
          priority: "medium",
          status: "todo",
          reporter: claire._id,
          assignee: null,
          createdAt: daysAgo(9),
          updatedAt: daysAgo(5),
        },
        {
          title: "Flag stale impersonation sessions older than 30 minutes",
          description:
            "Auto-revoke read-only support impersonation tokens after 30 minutes and record end timestamp in audit stream.",
          type: "task",
          priority: "medium",
          status: "in-progress",
          reporter: maya._id,
          assignee: devon._id,
          createdAt: daysAgo(7),
          updatedAt: daysAgo(1, 10),
        },
        {
          title: "Queue badge count fails to update after bulk archive",
          description:
            "Sidebar counter remains stale until full reload because batch archive invalidates list query only.",
          type: "bug",
          priority: "low",
          status: "todo",
          reporter: devon._id,
          assignee: null,
          createdAt: daysAgo(10),
          updatedAt: daysAgo(6),
        },
        {
          title: "Index audit_events on (actor_id, created_at)",
          description:
            "Filtering compliance view by operator email takes ~1.8s on 4M rows without compound index.",
          type: "task",
          priority: "medium",
          status: "done",
          reporter: claire._id,
          assignee: claire._id,
          createdAt: daysAgo(15),
          updatedAt: daysAgo(10),
        },
        {
          title: "Document SOP for granting temporary feature flag access",
          description:
            "Add short internal checklist covering approval thread and rollback window.",
          type: "task",
          priority: "medium",
          status: "done",
          reporter: claire._id,
          assignee: maya._id,
          createdAt: daysAgo(15),
          updatedAt: daysAgo(12),
        },
      ],
    },
  ];

  const createdProjects = [];
  const createdTicketsByKey = new Map();

  for (const projDef of projectDefs) {
    const project = await Project.create({
      key: projDef.key,
      title: projDef.title,
      description: projDef.description,
      owner: projDef.owner,
      members: projDef.members,
      ticketCounter: projDef.tickets.length,
    });

    await Project.collection.updateOne(
      { _id: project._id },
      { $set: { createdAt: projDef.createdAt, updatedAt: projDef.updatedAt } }
    );

    const orderByStatus = { todo: 0, "in-progress": 0, done: 0 };
    for (let idx = 0; idx < projDef.tickets.length; idx += 1) {
      const tDef = projDef.tickets[idx];
      const num = idx + 1;
      const key = `${projDef.key}-${num}`;
      const order = orderByStatus[tDef.status];
      orderByStatus[tDef.status] += 1;

      const doc = await Ticket.create({
        key,
        number: num,
        title: tDef.title,
        description: tDef.description,
        type: tDef.type,
        priority: tDef.priority,
        status: tDef.status,
        project: project._id,
        reporter: tDef.reporter,
        assignee: tDef.assignee,
        attachments: tDef.attachments || [],
        order,
      });

      await Ticket.collection.updateOne(
        { _id: doc._id },
        { $set: { createdAt: tDef.createdAt, updatedAt: tDef.updatedAt } }
      );
      createdTicketsByKey.set(key, doc);
    }

    createdProjects.push(project);
  }

  // Add ~25 realistic comments + replies with staggered timestamps
  const commentThreads = [
    {
      ticketKey: "PAY-1",
      entries: [
        {
          author: maya._id,
          text: "Checked prod logs from last night — 4 customers hit this when their bank app took over 75s on 2FA.",
          at: daysAgo(2, 18),
        },
        {
          author: devon._id,
          text: "Reproduced locally by sleeping in the mock ACS callback. Raising the lock TTL to 10 minutes with lease renewal while pending.",
          replyToLast: true,
          at: daysAgo(2, 12),
        },
        {
          author: priya._id,
          text: "Worth returning the existing pending intent id if the same idempotency key arrives mid-challenge.",
          at: daysAgo(1, 20),
        },
        {
          author: maya._id,
          text: "Agreed, let's handle both lock TTL and returning the existing intent in the same PR.",
          replyToLast: true,
          at: hoursAgo(2),
        },
      ],
    },
    {
      ticketKey: "PAY-2",
      entries: [
        {
          author: claire._id,
          text: "Confirmed on Safari 17.5 and iOS Safari. Chrome submits normally because button[form=...] works slightly differently there.",
          at: daysAgo(4, 10),
        },
        {
          author: devon._id,
          text: "Moving the submit footer back inside <form> and wiring Enter key handling cleanly.",
          replyToLast: true,
          at: hoursAgo(6),
        },
      ],
    },
    {
      ticketKey: "PAY-3",
      entries: [
        {
          author: maya._id,
          text: "Seen this most with Shopify merchants behind Cloudflare rate limits.",
          at: daysAgo(6),
        },
        {
          author: claire._id,
          text: "Note that Retry-After can be either integer seconds or an HTTP date header, so parser needs to handle both.",
          at: daysAgo(1, 3),
        },
      ],
    },
    {
      ticketKey: "PAY-4",
      entries: [
        {
          author: priya._id,
          text: "Index (merchant_id, created_at desc, _id desc) cut p95 query time from 1.9s down to 28ms on staging snapshot.",
          at: daysAgo(3),
        },
        {
          author: maya._id,
          text: "Nice speedup. Remember to keep page=1 legacy offset supported for v1 SDK users until Q2.",
          replyToLast: true,
          at: daysAgo(1, 8),
        },
      ],
    },
    {
      ticketKey: "PAY-6",
      entries: [
        {
          author: priya._id,
          text: "Reproduced on staging with both JPY and KRW invoices.",
          at: daysAgo(2),
        },
        {
          author: devon._id,
          text: "Found it in formatMinorUnits(): divisor was hardcoded to 100 regardless of currency. Adding ISO-4217 exponent table.",
          at: hoursAgo(9),
        },
      ],
    },
    {
      ticketKey: "PAY-7",
      entries: [
        {
          author: maya._id,
          text: "Rolled out to prod and verified Stripe + Adyen live webhook signatures both verify on rawBuffer.",
          at: daysAgo(12),
        },
      ],
    },
    {
      ticketKey: "FK-1",
      entries: [
        {
          author: jonah._id,
          text: "Captured stack trace from two field iPads in TestFlight build 412.",
          at: daysAgo(3, 14),
        },
        {
          author: devon._id,
          text: "Root cause: picker writes to tmp/ instead of Application Support/UploadQueue. Moving pending files before queuing.",
          at: daysAgo(1, 4),
        },
        {
          author: jonah._id,
          text: "Also need a fallback skip if a file was already purged by the OS so the rest of the queue does not stall.",
          replyToLast: true,
          at: hoursAgo(5),
        },
      ],
    },
    {
      ticketKey: "FK-2",
      entries: [
        {
          author: claire._id,
          text: "Attached a screenshot from iPhone SE simulator showing the Reset button hugging the right edge.",
          at: daysAgo(3),
        },
      ],
    },
    {
      ticketKey: "FK-3",
      entries: [
        {
          author: jonah._id,
          text: "Tested 0.78 JPEG quality at 1600px max dimension — shrinks 4.8 MB photos down to ~260 KB with readable meter serials.",
          at: daysAgo(4),
        },
        {
          author: devon._id,
          text: "260 KB looks solid. Make sure EXIF orientation gets baked in during resize so portrait shots stay upright.",
          replyToLast: true,
          at: daysAgo(1, 5),
        },
      ],
    },
    {
      ticketKey: "OPS-1",
      entries: [
        {
          author: claire._id,
          text: "Sample customer row that broke export: 'Northwind Logistics, LLC'.",
          at: daysAgo(3, 6),
        },
        {
          author: maya._id,
          text: "Reproduced on staging, looks like a missing quote wrapper when fields contain commas or newlines.",
          at: daysAgo(1, 14),
        },
        {
          author: devon._id,
          text: "Also prepend UTF-8 BOM only once on the header chunk so Excel opens accents cleanly.",
          replyToLast: true,
          at: daysAgo(1),
        },
      ],
    },
    {
      ticketKey: "OPS-3",
      entries: [
        {
          author: claire._id,
          text: "Let's reuse the same confirm dialog pattern we use for project deletion.",
          at: daysAgo(1, 6),
        },
      ],
    },
    {
      ticketKey: "OPS-4",
      entries: [
        {
          author: maya._id,
          text: "Added escapeRegex() helper and regression test for trailing slashes and brackets.",
          at: daysAgo(8),
        },
      ],
    },
    {
      ticketKey: "OPS-6",
      entries: [
        {
          author: devon._id,
          text: "Token TTL is now 30m in Redis and UI shows a countdown strip in the header.",
          at: daysAgo(1, 10),
        },
      ],
    },
  ];

  let totalComments = 0;
  for (const thread of commentThreads) {
    const ticket = createdTicketsByKey.get(thread.ticketKey);
    if (!ticket) continue;

    let lastTopId = null;
    for (const entry of thread.entries) {
      const comment = await Comment.create({
        ticket: ticket._id,
        author: entry.author,
        text: entry.text,
        parent: entry.replyToLast && lastTopId ? lastTopId : null,
      });

      await Comment.collection.updateOne(
        { _id: comment._id },
        { $set: { createdAt: entry.at, updatedAt: entry.at } }
      );

      if (!entry.replyToLast) {
        lastTopId = comment._id;
      }
      totalComments += 1;
    }
  }

  process.stdout.write(
    [
      "Seed completed.",
      `Projects created: ${createdProjects.map((p) => `${p.key} (${p.title})`).join(", ")}`,
      `Users created (${DEMO_USERS.length}, password for all: demo1234):`,
      "  maya.lin@tracebook.dev      (Owner: PAY, Dev: OPS, Viewer: FK)",
      "  devon.patel@tracebook.dev   (Owner: FK, Dev: PAY & OPS)",
      "  claire.okafor@tracebook.dev (Owner: OPS, Dev: PAY & FK)",
      "  jonah.berg@tracebook.dev    (Dev: FK, Viewer: PAY & OPS)",
      "  priya.nair@tracebook.dev    (Dev: PAY, Viewer: FK)",
      `Tickets created: ${createdTicketsByKey.size}`,
      `Comments created: ${totalComments}`,
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
