const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["developer", "viewer"],
      default: "developer",
    },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, "Project key is required"],
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z]{2,5}$/, "Project key must be 2 to 5 capital letters"],
    },
    title: {
      type: String,
      required: [true, "Project title is required"],
      trim: true,
      maxlength: [120, "Project title cannot exceed 120 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, "Description cannot exceed 2000 characters"],
      default: "",
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: [memberSchema],
    ticketCounter: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

projectSchema.index({ owner: 1 });
projectSchema.index({ "members.user": 1 });

module.exports = mongoose.model("Project", projectSchema);
