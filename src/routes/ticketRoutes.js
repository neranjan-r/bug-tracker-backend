const express = require("express");
const { body } = require("express-validator");
const auth = require("../middleware/auth");
const handleValidation = require("../middleware/validate");
const { handleImageUpload } = require("../middleware/upload");
const { requireProjectAccess } = require("../utils/projectAccess");
const {
  ALLOWED_TYPES,
  ALLOWED_PRIORITIES,
  ALLOWED_STATUSES,
  createTicket,
  listTickets,
  getTicket,
  updateTicket,
  moveTicket,
  deleteTicket,
  requireTicketUploadAccess,
  uploadAttachments,
  deleteAttachment,
} = require("../controllers/ticketController");

const projectTicketRouter = express.Router({ mergeParams: true });
projectTicketRouter.use(auth);

projectTicketRouter.post(
  "/",
  requireProjectAccess(["owner", "developer"], "projectId"),
  [
    body("title")
      .isString()
      .withMessage("Ticket title must be text")
      .trim()
      .notEmpty()
      .withMessage("Ticket title is required")
      .isLength({ max: 200 })
      .withMessage("Ticket title cannot exceed 200 characters"),
    body("description")
      .optional()
      .isString()
      .withMessage("Description must be text")
      .trim()
      .isLength({ max: 5000 })
      .withMessage("Description cannot exceed 5000 characters"),
    body("type")
      .optional()
      .isIn(ALLOWED_TYPES)
      .withMessage("Type must be bug, feature, or task"),
    body("priority")
      .optional()
      .isIn(ALLOWED_PRIORITIES)
      .withMessage("Priority must be low, medium, high, or critical"),
  ],
  handleValidation,
  createTicket
);

projectTicketRouter.get(
  "/",
  requireProjectAccess(["owner", "developer", "viewer"], "projectId"),
  listTickets
);

const ticketRouter = express.Router();
ticketRouter.use(auth);

ticketRouter.get("/:id", getTicket);

ticketRouter.put(
  "/:id",
  [
    body("title")
      .optional()
      .isString()
      .withMessage("Ticket title must be text")
      .trim()
      .notEmpty()
      .withMessage("Ticket title cannot be empty")
      .isLength({ max: 200 })
      .withMessage("Ticket title cannot exceed 200 characters"),
    body("description")
      .optional()
      .isString()
      .withMessage("Description must be text")
      .trim()
      .isLength({ max: 5000 })
      .withMessage("Description cannot exceed 5000 characters"),
    body("type")
      .optional()
      .isIn(ALLOWED_TYPES)
      .withMessage("Type must be bug, feature, or task"),
    body("priority")
      .optional()
      .isIn(ALLOWED_PRIORITIES)
      .withMessage("Priority must be low, medium, high, or critical"),
    body("status")
      .optional()
      .isIn(ALLOWED_STATUSES)
      .withMessage("Status must be todo, in-progress, or done"),
  ],
  handleValidation,
  updateTicket
);

ticketRouter.patch(
  "/:id/move",
  [
    body("status")
      .isIn(ALLOWED_STATUSES)
      .withMessage("Status must be todo, in-progress, or done"),
    body("position")
      .isInt({ min: 0 })
      .withMessage("Position must be a non-negative integer"),
  ],
  handleValidation,
  moveTicket
);

ticketRouter.delete("/:id", deleteTicket);

ticketRouter.post(
  "/:id/attachments",
  requireTicketUploadAccess,
  handleImageUpload,
  uploadAttachments
);

ticketRouter.delete("/:id/attachments/:index", deleteAttachment);

module.exports = {
  projectTicketRouter,
  ticketRouter,
};
