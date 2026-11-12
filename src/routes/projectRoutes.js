const express = require("express");
const { body } = require("express-validator");
const auth = require("../middleware/auth");
const handleValidation = require("../middleware/validate");
const { requireProjectAccess } = require("../utils/projectAccess");
const {
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
} = require("../controllers/projectController");

const router = express.Router();

router.use(auth);

router.post(
  "/",
  [
    body("title")
      .isString()
      .withMessage("Project title must be text")
      .trim()
      .notEmpty()
      .withMessage("Project title is required")
      .isLength({ max: 120 })
      .withMessage("Project title cannot exceed 120 characters"),
    body("description")
      .optional()
      .isString()
      .withMessage("Description must be text")
      .trim()
      .isLength({ max: 2000 })
      .withMessage("Description cannot exceed 2000 characters"),
  ],
  handleValidation,
  createProject
);

router.get("/", listProjects);
router.get("/:id", getProject);
router.get("/:id/stats", getProjectStats);

router.put(
  "/:id",
  requireProjectAccess(["owner"]),
  [
    body("title")
      .optional()
      .isString()
      .withMessage("Project title must be text")
      .trim()
      .notEmpty()
      .withMessage("Project title cannot be empty")
      .isLength({ max: 120 })
      .withMessage("Project title cannot exceed 120 characters"),
    body("description")
      .optional()
      .isString()
      .withMessage("Description must be text")
      .trim()
      .isLength({ max: 2000 })
      .withMessage("Description cannot exceed 2000 characters"),
  ],
  handleValidation,
  updateProject
);

router.delete("/:id", requireProjectAccess(["owner"]), deleteProject);

router.get("/:id/members", getMembers);

router.post(
  "/:id/members",
  requireProjectAccess(["owner"]),
  [
    body("email")
      .trim()
      .notEmpty()
      .withMessage("Member email is required")
      .isEmail()
      .withMessage("Please provide a valid email address"),
    body("role")
      .isIn(["developer", "viewer"])
      .withMessage("Role must be either developer or viewer"),
  ],
  handleValidation,
  addMember
);

router.patch(
  "/:id/members/:userId",
  requireProjectAccess(["owner"]),
  [
    body("role")
      .isIn(["developer", "viewer"])
      .withMessage("Role must be either developer or viewer"),
  ],
  handleValidation,
  updateMemberRole
);

router.delete(
  "/:id/members/:userId",
  requireProjectAccess(["owner"]),
  removeMember
);

module.exports = router;
