const mongoose = require("mongoose");
const Project = require("../models/Project");
const User = require("../models/User");
const { getProjectWithRole } = require("../utils/projectAccess");
const { deleteFile } = require("../utils/storage");
const {
  PROJECT_KEY_REGEX,
  generateUniqueProjectKey,
} = require("../utils/projectKeys");

/**
 * POST /api/projects
 */
async function createProject(req, res) {
  const { title, description = "", key } = req.body;

  let finalKey;
  if (key !== undefined && key !== "") {
    finalKey = String(key).trim().toUpperCase();
    if (!PROJECT_KEY_REGEX.test(finalKey)) {
      return res.status(400).json({
        success: false,
        message: "Project key must be 2 to 5 capital letters",
      });
    }
    const existing = await Project.exists({ key: finalKey });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Project key "${finalKey}" is already in use`,
      });
    }
  } else {
    finalKey = await generateUniqueProjectKey(title);
  }

  const project = await Project.create({
    key: finalKey,
    title: title.trim(),
    description: description.trim(),
    owner: req.user._id,
    members: [],
  });

  await project.populate("owner", "name email");

  return res.status(201).json({
    success: true,
    data: {
      project: {
        ...project.toObject(),
        role: "owner",
        ticketCount: 0,
        openTicketCount: 0,
      },
    },
  });
}

/**
 * GET /api/projects
 */
async function listProjects(req, res) {
  const userId = req.user._id;
  const projects = await Project.find({
    $or: [{ owner: userId }, { "members.user": userId }],
  })
    .populate("owner", "name email")
    .populate("members.user", "name email")
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const statsMap = new Map();
  if (mongoose.models.Ticket && projects.length > 0) {
    const projectIds = projects.map((p) => p._id);
    const counts = await mongoose.models.Ticket.aggregate([
      { $match: { project: { $in: projectIds } } },
      {
        $group: {
          _id: "$project",
          total: { $sum: 1 },
          open: {
            $sum: { $cond: [{ $ne: ["$status", "done"] }, 1, 0] },
          },
          lastTicketAt: { $max: "$updatedAt" },
        },
      },
    ]);
    counts.forEach((item) => {
      statsMap.set(item._id.toString(), item);
    });
  }

  const result = projects
    .map((project) => {
      const isOwner = project.owner?._id?.toString() === userId.toString();
      const memberEntry = (project.members || []).find(
        (m) => m.user?._id?.toString() === userId.toString()
      );
      const stats = statsMap.get(project._id.toString());
      const projectTs = new Date(project.updatedAt || project.createdAt).getTime();
      const ticketTs = stats?.lastTicketAt
        ? new Date(stats.lastTicketAt).getTime()
        : 0;
      const latestActivity = new Date(Math.max(projectTs, ticketTs));

      return {
        ...project,
        role: isOwner ? "owner" : memberEntry?.role || "viewer",
        ticketCount: stats?.total || 0,
        openTicketCount: stats?.open || 0,
        updatedAt: latestActivity,
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return res.json({
    success: true,
    data: { projects: result },
  });
}

/**
 * GET /api/projects/:id
 */
async function getProject(req, res) {
  const { status, message, project, role } = await getProjectWithRole(
    req.params.id,
    req.user._id,
    { populate: true }
  );

  if (!project) {
    return res.status(status).json({ success: false, message });
  }

  const ticketCount = mongoose.models.Ticket
    ? await mongoose.models.Ticket.countDocuments({ project: project._id })
    : 0;

  return res.json({
    success: true,
    data: {
      project: {
        ...project.toObject(),
        role,
        ticketCount,
      },
    },
  });
}

/**
 * PUT /api/projects/:id (owner only)
 */
async function updateProject(req, res) {
  const { title, description } = req.body;

  if (title !== undefined) {
    req.project.title = title.trim();
  }
  if (description !== undefined) {
    req.project.description = description.trim();
  }

  await req.project.save();
  await req.project.populate([
    { path: "owner", select: "name email" },
    { path: "members.user", select: "name email" },
  ]);

  return res.json({
    success: true,
    data: {
      project: {
        ...req.project.toObject(),
        role: req.projectRole,
      },
    },
  });
}

/**
 * DELETE /api/projects/:id (owner only)
 */
async function deleteProject(req, res) {
  const projectId = req.project._id;

  // Cascade delete tickets, comments, and uploaded attachment files if registered
  if (mongoose.models.Ticket) {
    const tickets = await mongoose.models.Ticket.find({ project: projectId }).select(
      "_id attachments"
    );
    const ticketIds = tickets.map((t) => t._id);

    if (mongoose.models.Comment && ticketIds.length > 0) {
      await mongoose.models.Comment.deleteMany({ ticket: { $in: ticketIds } });
    }

    for (const ticket of tickets) {
      for (const attachment of ticket.attachments || []) {
        await deleteFile(attachment).catch(() => {});
      }
    }

    await mongoose.models.Ticket.deleteMany({ project: projectId });
  }

  await Project.findByIdAndDelete(projectId);

  return res.json({
    success: true,
    data: { message: "Project deleted successfully" },
  });
}

/**
 * GET /api/projects/:id/members
 */
async function getMembers(req, res) {
  const { status, message, project, role } = await getProjectWithRole(
    req.params.id,
    req.user._id,
    { populate: true }
  );

  if (!project) {
    return res.status(status).json({ success: false, message });
  }

  const owner = project.owner
    ? {
        user: {
          _id: project.owner._id,
          name: project.owner.name,
          email: project.owner.email,
        },
        role: "owner",
      }
    : null;

  const members = (project.members || [])
    .filter((m) => m.user)
    .map((m) => ({
      user: {
        _id: m.user._id,
        name: m.user.name,
        email: m.user.email,
      },
      role: m.role,
    }));

  const all = owner ? [owner, ...members] : members;

  return res.json({
    success: true,
    data: {
      owner: owner ? owner.user : null,
      members,
      all,
      role,
    },
  });
}

/**
 * POST /api/projects/:id/members (owner only)
 */
async function addMember(req, res) {
  const email = req.body.email.toLowerCase().trim();
  const role = req.body.role;

  const userToAdd = await User.findOne({ email });
  if (!userToAdd) {
    return res.status(404).json({
      success: false,
      message: "No registered user found with that email",
    });
  }

  if (req.project.owner.toString() === userToAdd._id.toString()) {
    return res.status(400).json({
      success: false,
      message: "The project owner is already part of this project",
    });
  }

  const alreadyMember = req.project.members.some(
    (m) => m.user.toString() === userToAdd._id.toString()
  );
  if (alreadyMember) {
    return res.status(409).json({
      success: false,
      message: "This user is already a member of the project",
    });
  }

  req.project.members.push({ user: userToAdd._id, role });
  await req.project.save();
  await req.project.populate([
    { path: "owner", select: "name email" },
    { path: "members.user", select: "name email" },
  ]);

  return res.status(201).json({
    success: true,
    data: {
      project: {
        ...req.project.toObject(),
        role: req.projectRole,
      },
    },
  });
}

/**
 * PATCH /api/projects/:id/members/:userId (owner only)
 */
async function updateMemberRole(req, res) {
  const { userId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ success: false, message: "Invalid user ID" });
  }

  if (req.project.owner.toString() === userId) {
    return res.status(400).json({
      success: false,
      message: "Cannot change the role of the project owner",
    });
  }

  const member = req.project.members.find((m) => m.user.toString() === userId);
  if (!member) {
    return res.status(404).json({
      success: false,
      message: "Member not found in this project",
    });
  }

  member.role = req.body.role;
  await req.project.save();
  await req.project.populate([
    { path: "owner", select: "name email" },
    { path: "members.user", select: "name email" },
  ]);

  return res.json({
    success: true,
    data: {
      project: {
        ...req.project.toObject(),
        role: req.projectRole,
      },
    },
  });
}

/**
 * DELETE /api/projects/:id/members/:userId (owner only)
 */
async function removeMember(req, res) {
  const { userId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ success: false, message: "Invalid user ID" });
  }

  if (req.project.owner.toString() === userId) {
    return res.status(400).json({
      success: false,
      message: "Cannot remove the project owner",
    });
  }

  const prevLen = req.project.members.length;
  req.project.members = req.project.members.filter(
    (m) => m.user.toString() !== userId
  );

  if (req.project.members.length === prevLen) {
    return res.status(404).json({
      success: false,
      message: "Member not found in this project",
    });
  }

  await req.project.save();

  // Unassign this user from all tickets in this project
  if (mongoose.models.Ticket) {
    await mongoose.models.Ticket.updateMany(
      { project: req.project._id, assignee: userId },
      { $set: { assignee: null } }
    );
  }

  await req.project.populate([
    { path: "owner", select: "name email" },
    { path: "members.user", select: "name email" },
  ]);

  return res.json({
    success: true,
    data: {
      project: {
        ...req.project.toObject(),
        role: req.projectRole,
      },
    },
  });
}

/**
 * GET /api/projects/:id/stats (any member)
 */
async function getProjectStats(req, res) {
  const { status, message, project } = await getProjectWithRole(
    req.params.id,
    req.user._id
  );
  if (!project) {
    return res.status(status).json({ success: false, message });
  }

  const byStatus = { todo: 0, "in-progress": 0, done: 0 };
  const byPriority = { low: 0, medium: 0, high: 0, critical: 0 };
  let total = 0;
  let assignedToMe = 0;

  if (mongoose.models.Ticket) {
    const Ticket = mongoose.models.Ticket;
    const [summary] = await Ticket.aggregate([
      { $match: { project: project._id } },
      {
        $facet: {
          totals: [{ $count: "count" }],
          statuses: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
          priorities: [{ $group: { _id: "$priority", count: { $sum: 1 } } }],
          mine: [
            { $match: { assignee: req.user._id } },
            { $count: "count" },
          ],
        },
      },
    ]);

    total = summary?.totals?.[0]?.count || 0;
    assignedToMe = summary?.mine?.[0]?.count || 0;
    for (const s of summary?.statuses || []) {
      if (s._id in byStatus) byStatus[s._id] = s.count;
    }
    for (const p of summary?.priorities || []) {
      if (p._id in byPriority) byPriority[p._id] = p.count;
    }
  }

  return res.json({
    success: true,
    data: {
      stats: {
        total,
        byStatus,
        byPriority,
        assignedToMe,
      },
    },
  });
}

module.exports = {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  getMembers,
  addMember,
  updateMemberRole,
  removeMember,
  getProjectStats,
};
