const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
  ticket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Ticket",
    required: true,
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  text: {
    type: String,
    required: [true, "Comment text is required"],
    trim: true,
    maxlength: [2000, "Comment cannot exceed 2000 characters"],
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Comment",
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

commentSchema.index({ ticket: 1, createdAt: 1 });
commentSchema.index({ parent: 1 });

module.exports = mongoose.model("Comment", commentSchema);

