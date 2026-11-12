const mongoose = require("mongoose");
const Ticket = require("../models/Ticket");
const storage = require("../utils/storage");
const { emitProjectEvent } = require("../utils/socket");
const { getProjectWithRole, resolveUserRole } = require("../utils/projectAccess");

const ALLOWED_TYPES = ["bug", "feature", "task"];
const ALLOWED_PRIORITIES = ["low", "medium", "high", "critical"];
const ALLOWED_STATUSES = ["todo", "in-progress", "done"];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function renumberColumn(projectId, status, orderedIds = null) {
  let ids = orderedIds;
  if (!ids) {
    const docs = await Ticket.find({ project: projectId, status })
      .sort({ order: 1, createdAt: 1 })
      .select("_id")
      .lean();
    ids = docs.map((d) => d._id);
  }

  if (ids.length === 0) return;

  await Ticket.bulkWrite(
    ids.map((id, idx) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { order: idx, status } },
      },
    }))
  );
}

async function getCommentCounts(ticketIds) {
  const map = new Map();
  if (!mongoose.models.Comment || ticketIds.length === 0) {
    return map;
  }

  const counts = await mongoose.models.Comment.aggregate([
    { $match: { ticket: { $in: ticketIds } } },
    { $group: { _id: "$ticket", count: { $sum: 1 } } },
  ]);
  counts.forEach((item) => {
    map.set(item._id.toString(), item.count);
  });
  return map;
}

/**
 * Validate and resolve an optional assignee ID within the given project.
 */
function validateAssigneeInProject(project, assignee) {
  if (assignee === undefined) {
    return { valid: true, value: undefined };
  }
  if (assignee === null || assignee === "") {
    return { valid: true, value: null };
  }
  if (typeof assignee !== "string" || !mongoose.Types.ObjectId.isValid(assignee)) {
    return { valid: false, message: "Invalid assignee ID" };
  }
  const role = resolveUserRole(project, assignee);
  if (!role) {
    return {
      valid: false,
      message: "Assignee must be the owner or a member of this project",
    };
  }
  return { valid: true, value: assignee };
}

/**
 * POST /api/projects/:projectId/tickets
 */
async function createTicket(req, res) {
  const { title, description = "", type = "bug", priority = "medium", assignee } =
    req.body;

  const assigneeCheck = validateAssigneeInProject(req.project, assignee);
  if (!assigneeCheck.valid) {
    return res.status(400).json({ success: false, message: assigneeCheck.message });
  }

  const lastTicket = await Ticket.findOne({
    project: req.project._id,
    status: "todo",
  })
    .sort({ order: -1 })
    .select("order")
    .lean();

  const nextOrder = lastTicket ? lastTicket.order + 1 : 0;

  const ticket = await Ticket.create({
    title: title.trim(),
    description: description.trim(),
    type,
    priority,
    status: "todo",
    project: req.project._id,
    reporter: req.user._id,
    assignee: assigneeCheck.value ?? null,
    order: nextOrder,
  });

  await ticket.populate([
    { path: "reporter", select: "name email" },
    { path: "assignee", select: "name email" },
  ]);

  const result = { ...ticket.toObject(), commentCount: 0 };

  emitProjectEvent(req.project._id, "ticket:created", {
    actorId: req.user._id.toString(),
    ticket: result,
  });

  return res.status(201).json({
    success: true,
    data: { ticket: result },
  });
}

/**
 * GET /api/projects/:projectId/tickets
 */
async function listTickets(req, res) {
  const {
    status,
    priority,
    type,
    assignee,
    search,
    sort = "newest",
    page = "1",
    limit = "20",
  } = req.query;

  const filter = { project: req.project._id };

  if (status) {
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status filter" });
    }
    filter.status = status;
  }

  if (priority) {
    if (!ALLOWED_PRIORITIES.includes(priority)) {
      return res.status(400).json({ success: false, message: "Invalid priority filter" });
    }
    filter.priority = priority;
  }

  if (type) {
    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid type filter" });
    }
    filter.type = type;
  }

  if (assignee) {
    if (assignee === "me") {
      filter.assignee = req.user._id;
    } else if (assignee === "unassigned") {
      filter.assignee = null;
    } else if (mongoose.Types.ObjectId.isValid(assignee)) {
      filter.assignee = new mongoose.Types.ObjectId(assignee);
    } else {
      return res.status(400).json({ success: false, message: "Invalid assignee filter" });
    }
  }

  if (typeof search === "string" && search.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim()), "i");
    filter.$or = [{ title: pattern }, { description: pattern }];
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const total = await Ticket.countDocuments(filter);

  let tickets;
  if (sort === "priority") {
    const rawDocs = await Ticket.aggregate([
      { $match: filter },
      {
        $addFields: {
          priorityRank: {
            $switch: {
              branches: [
                { case: { $eq: ["$priority", "critical"] }, then: 4 },
                { case: { $eq: ["$priority", "high"] }, then: 3 },
                { case: { $eq: ["$priority", "medium"] }, then: 2 },
                { case: { $eq: ["$priority", "low"] }, then: 1 },
              ],
              default: 0,
            },
          },
        },
      },
      { $sort: { priorityRank: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
      { $project: { priorityRank: 0 } },
    ]);

    tickets = await Ticket.populate(rawDocs, [
      { path: "reporter", select: "name email" },
      { path: "assignee", select: "name email" },
    ]);
  } else {
    let sortSpec = { createdAt: -1 };
    if (sort === "oldest") {
      sortSpec = { createdAt: 1 };
    } else if (sort === "order") {
      sortSpec = { order: 1, createdAt: 1 };
    }

    tickets = await Ticket.find(filter)
      .sort(sortSpec)
      .skip(skip)
      .limit(limitNum)
      .populate("reporter", "name email")
      .populate("assignee", "name email")
      .lean();
  }

  const commentCounts = await getCommentCounts(tickets.map((t) => t._id));
  const enrichedTickets = tickets.map((t) => ({
    ...t,
    commentCount: commentCounts.get(t._id.toString()) || 0,
  }));

  return res.json({
    success: true,
    data: {
      tickets: enrichedTickets,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
      },
    },
  });
}

/**
 * Helper to load a ticket and verify user's role in its project.
 */
async function loadAuthorizedTicket(ticketId, userId, allowedRoles = ["owner", "developer", "viewer"]) {
  if (!mongoose.Types.ObjectId.isValid(ticketId)) {
    return { status: 400, message: "Invalid ticket ID", ticket: null, project: null, role: null };
  }

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) {
    return { status: 404, message: "Ticket not found", ticket: null, project: null, role: null };
  }

  const access = await getProjectWithRole(ticket.project, userId);
  if (!access.project) {
    // Return 404 when caller does not belong to the ticket's project
    return { status: 404, message: "Ticket not found", ticket: null, project: null, role: null };
  }

  if (!allowedRoles.includes(access.role)) {
    return {
      status: 403,
      message: "You do not have permission to perform this action",
      ticket: null,
      project: null,
      role: null,
    };
  }

  return { status: 200, message: null, ticket, project: access.project, role: access.role };
}

/**
 * GET /api/tickets/:id
 */
async function getTicket(req, res) {
  const { status, message, ticket, role } = await loadAuthorizedTicket(
    req.params.id,
    req.user._id
  );
  if (!ticket) {
    return res.status(status).json({ success: false, message });
  }

  await ticket.populate([
    { path: "reporter", select: "name email" },
    { path: "assignee", select: "name email" },
  ]);

  const commentCounts = await getCommentCounts([ticket._id]);

  return res.json({
    success: true,
    data: {
      ticket: {
        ...ticket.toObject(),
        commentCount: commentCounts.get(ticket._id.toString()) || 0,
      },
      role,
    },
  });
}

/**
 * PUT /api/tickets/:id (owner or developer)
 */
async function updateTicket(req, res) {
  const { status: authStatus, message, ticket, project } = await loadAuthorizedTicket(
    req.params.id,
    req.user._id,
    ["owner", "developer"]
  );
  if (!ticket) {
    return res.status(authStatus).json({ success: false, message });
  }

  const { title, description, type, priority, assignee, status } = req.body;

  const assigneeCheck = validateAssigneeInProject(project, assignee);
  if (!assigneeCheck.valid) {
    return res.status(400).json({ success: false, message: assigneeCheck.message });
  }

  if (title !== undefined) ticket.title = title.trim();
  if (description !== undefined) ticket.description = description.trim();
  if (type !== undefined) ticket.type = type;
  if (priority !== undefined) ticket.priority = priority;
  if (assigneeCheck.value !== undefined) ticket.assignee = assigneeCheck.value;

  const previousStatus = ticket.status;
  if (status !== undefined && status !== previousStatus) {
    const lastInTarget = await Ticket.findOne({
      project: project._id,
      status,
    })
      .sort({ order: -1 })
      .select("order")
      .lean();
    ticket.status = status;
    ticket.order = lastInTarget ? lastInTarget.order + 1 : 0;
  }

  await ticket.save();

  if (status !== undefined && status !== previousStatus) {
    await renumberColumn(project._id, previousStatus);
  }

  await ticket.populate([
    { path: "reporter", select: "name email" },
    { path: "assignee", select: "name email" },
  ]);

  const commentCounts = await getCommentCounts([ticket._id]);
  const updatedTicket = {
    ...ticket.toObject(),
    commentCount: commentCounts.get(ticket._id.toString()) || 0,
  };

  emitProjectEvent(ticket.project, "ticket:updated", {
    actorId: req.user._id.toString(),
    ticket: updatedTicket,
  });

  return res.json({
    success: true,
    data: {
      ticket: updatedTicket,
    },
  });
}

/**
 * PATCH /api/tickets/:id/move (owner or developer)
 */
async function moveTicket(req, res) {
  const { status: authStatus, message, ticket, project } = await loadAuthorizedTicket(
    req.params.id,
    req.user._id,
    ["owner", "developer"]
  );
  if (!ticket) {
    return res.status(authStatus).json({ success: false, message });
  }

  const targetStatus = req.body.status;
  const rawPosition = Number(req.body.position);
  const sourceStatus = ticket.status;

  if (sourceStatus === targetStatus) {
    const columnDocs = await Ticket.find({
      project: project._id,
      status: targetStatus,
    })
      .sort({ order: 1, createdAt: 1 })
      .select("_id")
      .lean();

    const remainingIds = columnDocs
      .map((d) => d._id)
      .filter((id) => id.toString() !== ticket._id.toString());

    const clampedPos = Math.max(0, Math.min(rawPosition, remainingIds.length));
    remainingIds.splice(clampedPos, 0, ticket._id);
    await renumberColumn(project._id, targetStatus, remainingIds);
  } else {
    const sourceDocs = await Ticket.find({
      project: project._id,
      status: sourceStatus,
    })
      .sort({ order: 1, createdAt: 1 })
      .select("_id")
      .lean();

    const sourceIds = sourceDocs
      .map((d) => d._id)
      .filter((id) => id.toString() !== ticket._id.toString());

    const targetDocs = await Ticket.find({
      project: project._id,
      status: targetStatus,
    })
      .sort({ order: 1, createdAt: 1 })
      .select("_id")
      .lean();

    const targetIds = targetDocs
      .map((d) => d._id)
      .filter((id) => id.toString() !== ticket._id.toString());

    const clampedPos = Math.max(0, Math.min(rawPosition, targetIds.length));
    targetIds.splice(clampedPos, 0, ticket._id);

    await renumberColumn(project._id, sourceStatus, sourceIds);
    await renumberColumn(project._id, targetStatus, targetIds);
  }

  const updated = await Ticket.findById(ticket._id)
    .populate("reporter", "name email")
    .populate("assignee", "name email")
    .lean();

  const commentCounts = await getCommentCounts([ticket._id]);
  const movedTicket = {
    ...updated,
    commentCount: commentCounts.get(ticket._id.toString()) || 0,
  };

  emitProjectEvent(project._id, "ticket:moved", {
    actorId: req.user._id.toString(),
    ticket: movedTicket,
  });

  return res.json({
    success: true,
    data: {
      ticket: movedTicket,
    },
  });
}

/**
 * DELETE /api/tickets/:id (owner: any, developer: own reported only)
 */
async function deleteTicket(req, res) {
  const { status, message, ticket, project, role } = await loadAuthorizedTicket(
    req.params.id,
    req.user._id,
    ["owner", "developer"]
  );
  if (!ticket) {
    return res.status(status).json({ success: false, message });
  }

  if (
    role === "developer" &&
    ticket.reporter.toString() !== req.user._id.toString()
  ) {
    return res.status(403).json({
      success: false,
      message: "Developers can only delete tickets they reported",
    });
  }

  const prevStatus = ticket.status;

  if (mongoose.models.Comment) {
    await mongoose.models.Comment.deleteMany({ ticket: ticket._id });
  }

  for (const attachment of ticket.attachments || []) {
    await storage.deleteFile(attachment);
  }

  await Ticket.findByIdAndDelete(ticket._id);
  await renumberColumn(project._id, prevStatus);

  emitProjectEvent(project._id, "ticket:deleted", {
    actorId: req.user._id.toString(),
    ticketId: ticket._id.toString(),
    projectId: project._id.toString(),
  });

  return res.json({
    success: true,
    data: {
      message: "Ticket deleted successfully",
      ticketId: ticket._id,
      projectId: project._id,
    },
  });
}

/**
 * Middleware verifying ticket write access before processing file uploads.
 */
async function requireTicketUploadAccess(req, res, next) {
  const { status, message, ticket, project } = await loadAuthorizedTicket(
    req.params.id,
    req.user._id,
    ["owner", "developer"]
  );
  if (!ticket) {
    return res.status(status).json({ success: false, message });
  }
  req.authorizedTicket = ticket;
  req.authorizedProject = project;
  return next();
}

/**
 * POST /api/tickets/:id/attachments (owner or developer)
 */
async function uploadAttachments(req, res) {
  const files = req.uploadedImages || [];
  if (files.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Please select at least one image file to upload",
    });
  }

  const savedAttachments = [];
  for (const file of files) {
    const saved = await storage.saveFile(file);
    savedAttachments.push(saved);
  }

  req.authorizedTicket.attachments.push(...savedAttachments);
  await req.authorizedTicket.save();
  await req.authorizedTicket.populate([
    { path: "reporter", select: "name email" },
    { path: "assignee", select: "name email" },
  ]);

  const commentCounts = await getCommentCounts([req.authorizedTicket._id]);
  const updatedTicket = {
    ...req.authorizedTicket.toObject(),
    commentCount: commentCounts.get(req.authorizedTicket._id.toString()) || 0,
  };

  emitProjectEvent(req.authorizedProject._id, "ticket:updated", {
    actorId: req.user._id.toString(),
    ticket: updatedTicket,
  });

  return res.status(201).json({
    success: true,
    data: {
      ticket: updatedTicket,
    },
  });
}

/**
 * DELETE /api/tickets/:id/attachments/:index (owner or developer)
 */
async function deleteAttachment(req, res) {
  const { status, message, ticket } = await loadAuthorizedTicket(
    req.params.id,
    req.user._id,
    ["owner", "developer"]
  );
  if (!ticket) {
    return res.status(status).json({ success: false, message });
  }

  const index = Number(req.params.index);
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= ticket.attachments.length
  ) {
    return res.status(404).json({
      success: false,
      message: "Attachment not found",
    });
  }

  const [removed] = ticket.attachments.splice(index, 1);
  await storage.deleteFile(removed);
  await ticket.save();

  await ticket.populate([
    { path: "reporter", select: "name email" },
    { path: "assignee", select: "name email" },
  ]);

  const commentCounts = await getCommentCounts([ticket._id]);
  const updatedTicket = {
    ...ticket.toObject(),
    commentCount: commentCounts.get(ticket._id.toString()) || 0,
  };

  emitProjectEvent(ticket.project, "ticket:updated", {
    actorId: req.user._id.toString(),
    ticket: updatedTicket,
  });

  return res.json({
    success: true,
    data: {
      ticket: updatedTicket,
    },
  });
}

module.exports = {
  ALLOWED_TYPES,
  ALLOWED_PRIORITIES,
  ALLOWED_STATUSES,
  loadAuthorizedTicket,
  createTicket,
  listTickets,
  getTicket,
  updateTicket,
  moveTicket,
  deleteTicket,
  requireTicketUploadAccess,
  uploadAttachments,
  deleteAttachment,
};
