const mongoose = require("mongoose");
const Project = require("../models/Project");
const { PROJECT_KEY_REGEX } = require("./projectKeys");

/**
 * Resolve a user's role within a project ("owner", "developer", "viewer")
 * or return null if the user does not belong to the project.
 */
function resolveUserRole(project, userId) {
  if (!project || !userId) return null;
  const uid = userId.toString();

  const ownerId = project.owner?._id
    ? project.owner._id.toString()
    : project.owner.toString();
  if (ownerId === uid) {
    return "owner";
  }

  const membership = (project.members || []).find((m) => {
    const memberId = m.user?._id ? m.user._id.toString() : m.user.toString();
    return memberId === uid;
  });

  return membership ? membership.role : null;
}

/**
 * Load a project by ObjectId or project key and verify membership.
 * Returns 404 for missing projects and non-members so private projects stay hidden.
 */
async function getProjectWithRole(projectIdOrKey, userId, { populate = false } = {}) {
  const isObjectId = mongoose.Types.ObjectId.isValid(projectIdOrKey);
  const upperKey = typeof projectIdOrKey === "string" ? projectIdOrKey.trim().toUpperCase() : "";
  const isKey = PROJECT_KEY_REGEX.test(upperKey);

  if (!isObjectId && !isKey) {
    return { status: 400, message: "Invalid project ID", project: null, role: null };
  }

  let query = isObjectId
    ? Project.findById(projectIdOrKey)
    : Project.findOne({ key: upperKey });

  if (populate) {
    query = query
      .populate("owner", "name email")
      .populate("members.user", "name email");
  }

  const project = await query;
  if (!project) {
    return { status: 404, message: "Project not found", project: null, role: null };
  }

  const role = resolveUserRole(project, userId);
  if (!role) {
    return { status: 404, message: "Project not found", project: null, role: null };
  }

  return { status: 200, message: null, project, role };
}

/**
 * Middleware factory enforcing project membership and optional role restrictions.
 */
function requireProjectAccess(allowedRoles = ["owner", "developer", "viewer"], paramName = "id") {
  return async function projectAccessMiddleware(req, res, next) {
    const projectIdOrKey = req.params[paramName];
    const { status, message, project, role } = await getProjectWithRole(
      projectIdOrKey,
      req.user._id
    );

    if (!project) {
      return res.status(status).json({ success: false, message });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    }

    req.project = project;
    req.projectRole = role;
    return next();
  };
}

module.exports = {
  resolveUserRole,
  getProjectWithRole,
  requireProjectAccess,
};
