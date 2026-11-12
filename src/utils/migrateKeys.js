const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Project = require("../models/Project");
const Ticket = require("../models/Ticket");
const {
  PROJECT_KEY_REGEX,
  generateUniqueProjectKey,
} = require("./projectKeys");

/**
 * Backfill project keys and per-project sequential ticket numbers/keys
 * for existing database records without overwriting already-assigned values.
 */
async function migrateKeys() {
  await connectDB();

  let projectsUpdated = 0;
  let ticketsUpdated = 0;

  const projects = await Project.find().sort({ createdAt: 1, _id: 1 });
  for (const project of projects) {
    let changed = false;

    if (!project.key || !PROJECT_KEY_REGEX.test(project.key)) {
      project.key = await generateUniqueProjectKey(project.title);
      changed = true;
      projectsUpdated += 1;
    }

    const tickets = await Ticket.find({ project: project._id }).sort({
      createdAt: 1,
      _id: 1,
    });

    let maxNumber = project.ticketCounter || 0;
    const usedNumbers = new Set();

    for (const ticket of tickets) {
      if (typeof ticket.number === "number" && ticket.number >= 1) {
        usedNumbers.add(ticket.number);
        if (ticket.number > maxNumber) maxNumber = ticket.number;
      }
    }

    let nextNumber = maxNumber + 1;
    for (const ticket of tickets) {
      let ticketChanged = false;
      if (!ticket.number || ticket.number < 1) {
        while (usedNumbers.has(nextNumber)) {
          nextNumber += 1;
        }
        ticket.number = nextNumber;
        usedNumbers.add(nextNumber);
        if (nextNumber > maxNumber) maxNumber = nextNumber;
        nextNumber += 1;
        ticketChanged = true;
      }

      const expectedKey = `${project.key}-${ticket.number}`;
      if (ticket.key !== expectedKey) {
        ticket.key = expectedKey;
        ticketChanged = true;
      }

      if (ticketChanged) {
        await Ticket.collection.updateOne(
          { _id: ticket._id },
          { $set: { number: ticket.number, key: ticket.key } }
        );
        ticketsUpdated += 1;
      }
    }

    if ((project.ticketCounter || 0) !== maxNumber) {
      project.ticketCounter = maxNumber;
      changed = true;
    }

    if (changed) {
      await project.save();
    }
  }

  console.log(
    `Migration complete: ${projectsUpdated} projects updated, ${ticketsUpdated} tickets updated.`
  );
  await mongoose.disconnect();
}

migrateKeys().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
