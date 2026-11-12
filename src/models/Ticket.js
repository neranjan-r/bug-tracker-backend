const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
    },
    filename: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const ticketSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    number: {
      type: Number,
      required: true,
      min: 1,
    },
    title: {
      type: String,
      required: [true, "Ticket title is required"],
      trim: true,
      maxlength: [200, "Ticket title cannot exceed 200 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [5000, "Description cannot exceed 5000 characters"],
      default: "",
    },
    type: {
      type: String,
      enum: ["bug", "feature", "task"],
      default: "bug",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    status: {
      type: String,
      enum: ["todo", "in-progress", "done"],
      default: "todo",
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    attachments: [attachmentSchema],
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

ticketSchema.index({ project: 1, status: 1, order: 1 });
ticketSchema.index({ project: 1, number: 1 }, { unique: true });
ticketSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model("Ticket", ticketSchema);
