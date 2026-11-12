const express = require("express");
const { body } = require("express-validator");
const auth = require("../middleware/auth");
const handleValidation = require("../middleware/validate");
const {
  listComments,
  createComment,
  updateComment,
  deleteComment,
} = require("../controllers/commentController");

const ticketCommentRouter = express.Router({ mergeParams: true });
ticketCommentRouter.use(auth);

ticketCommentRouter.get("/", listComments);

ticketCommentRouter.post(
  "/",
  [
    body("text")
      .isString()
      .withMessage("Comment text must be text")
      .trim()
      .notEmpty()
      .withMessage("Comment text is required")
      .isLength({ max: 2000 })
      .withMessage("Comment cannot exceed 2000 characters"),
  ],
  handleValidation,
  createComment
);

const commentRouter = express.Router();
commentRouter.use(auth);

commentRouter.put(
  "/:id",
  [
    body("text")
      .isString()
      .withMessage("Comment text must be text")
      .trim()
      .notEmpty()
      .withMessage("Comment text is required")
      .isLength({ max: 2000 })
      .withMessage("Comment cannot exceed 2000 characters"),
  ],
  handleValidation,
  updateComment
);

commentRouter.delete("/:id", deleteComment);

module.exports = {
  ticketCommentRouter,
  commentRouter,
};
