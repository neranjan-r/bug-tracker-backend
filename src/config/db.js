const mongoose = require("mongoose");

/**
 * Connect to MongoDB using MONGO_URI from environment variables.
 */
async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI is not defined in environment variables");
  }

  const conn = await mongoose.connect(uri);
  return conn;
}

module.exports = connectDB;

