const mongoose = require("mongoose");
const Comment = require("../models/Comment");
const { emitProjectEvent } = require("../utils/socket");
const { loadAuthorizedTicket } = require("./ticketController");

/**
 * GET /api/tickets/:ticketId/comments
 */
async function listComments(req, res) {
  const { status, message, ticket } = await loadAuthorizedTicket(
    req.params.ticketId,
    req.user._id
  );
  if (!ticket) {
    return res.status(status).json({ success: false, message });
  }

  const comments = await Comment.find({ ticket: ticket._id })
    .sort({ createdAt: 1 })
    .populate("author", "name email")
    .lean();

  return res.json({
    success: true,
    data: { comments },
  });
}

/**
 * POST /api/tickets/:ticketId/comments (owner or developer)
 */
async function createComment(req, res) {
  const { status, message, ticket, project } = await loadAuthorizedTicket(
    req.params.ticketId,
    req.user._id,
    ["owner", "developer"]
  );
  if (!ticket) {
    return res.status(status).json({ success: false, message });
  }

  const { text, parent } = req.body;
  let parentId = null;

  if (parent) {
    if (typeof parent !== "string" || !mongoose.Types.ObjectId.isValid(parent)) {
      return res.status(400).json({ success: false, message: "Invalid parent comment ID" });
    }
    const parentComment = await Comment.findById(parent);
    if (!parentComment || parentComment.ticket.toString() !== ticket._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Parent comment must belong to this same ticket",
      });
    }
    if (parentComment.parent) {
      return res.status(400).json({
        success: false,
        message: "Replies are only allowed one level deep",
      });
    }
    parentId = parentComment._id;
  }

  const comment = await Comment.create({
    ticket: ticket._id,
    author: req.user._id,
    text: text.trim(),
    parent: parentId,
  });

  await comment.populate("author", "name email");

  emitProjectEvent(project._id, "comment:created", {
    actorId: req.user._id.toString(),
    ticketId: ticket._id.toString(),
    comment: comment.toObject(),
  });

  return res.status(201).json({
    success: true,
    data: {
      comment,
      projectId: project._id,
    },
  });
}

/**
 * PUT /api/comments/:id (author only, non-viewer)
 */
async function updateComment(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid comment ID" });
  }

  const comment = await Comment.findById(req.params.id);
  if (!comment) {
    return res.status(404).json({ success: false, message: "Comment not found" });
  }

  const { status, message, ticket, project, role } = await loadAuthorizedTicket(
    comment.ticket,
    req.user._id
  );
  if (!ticket) {
    return res.status(status).json({ success: false, message });
  }

  if (role === "viewer") {
    return res.status(403).json({
      success: false,
      message: "Viewers cannot edit comments",
    });
  }

  if (comment.author.toString() !== req.user._id.toString()) {
    return res.status(403).json({
      success: false,
      message: "You can only edit your own comments",
    });
  }

  comment.text = req.body.text.trim();
  await comment.save();
  await comment.populate("author", "name email");

  emitProjectEvent(project._id, "comment:updated", {
    actorId: req.user._id.toString(),
    ticketId: ticket._id.toString(),
    comment: comment.toObject(),
  });

  return res.json({
    success: true,
    data: { comment },
  });
}

/**
 * DELETE /api/comments/:id (author or project owner)
 */
async function deleteComment(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: "Invalid comment ID" });
  }

  const comment = await Comment.findById(req.params.id);
  if (!comment) {
    return res.status(404).json({ success: false, message: "Comment not found" });
  }

  const { status, message, ticket, project, role } = await loadAuthorizedTicket(
    comment.ticket,
    req.user._id
  );
  if (!ticket) {
    return res.status(status).json({ success: false, message });
  }

  const isAuthor = comment.author.toString() === req.user._id.toString();
  if (!isAuthor && role !== "owner") {
    return res.status(403).json({
      success: false,
      message: "You do not have permission to delete this comment",
    });
  }

  // Delete nested replies if deleting a top-level comment
  if (!comment.parent) {
    await Comment.deleteMany({ parent: comment._id });
  }

  await Comment.findByIdAndDelete(comment._id);

  emitProjectEvent(project._id, "comment:deleted", {
    actorId: req.user._id.toString(),
    ticketId: ticket._id.toString(),
    commentId: comment._id.toString(),
  });

  return res.json({
    success: true,
    data: {
      message: "Comment deleted successfully",
      commentId: comment._id,
      ticketId: ticket._id,
      projectId: project._id,
    },
  });
}

module.exports = {
  listComments,
  createComment,
  updateComment,
  deleteComment,
};
