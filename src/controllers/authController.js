const jwt = require("jsonwebtoken");
const User = require("../models/User");

function signToken(userId) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign({ id: userId }, secret, { expiresIn: "7d" });
}

function formatUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
  };
}

/**
 * POST /api/auth/register
 */
async function register(req, res) {
  const { name, email, password } = req.body;
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: "An account with this email already exists",
    });
  }

  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    password,
  });

  const token = signToken(user._id);
  return res.status(201).json({
    success: true,
    data: {
      token,
      user: formatUser(user),
    },
  });
}

/**
 * POST /api/auth/login
 */
async function login(req, res) {
  const { email, password } = req.body;
  const normalizedEmail = email.toLowerCase().trim();

  // Select password explicitly because User.password has select: false
  const user = await User.findOne({ email: normalizedEmail }).select("+password");
  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password",
    });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password",
    });
  }

  const token = signToken(user._id);
  return res.json({
    success: true,
    data: {
      token,
      user: formatUser(user),
    },
  });
}

/**
 * GET /api/auth/me
 */
function getMe(req, res) {
  return res.json({
    success: true,
    data: {
      user: formatUser(req.user),
    },
  });
}

module.exports = {
  register,
  login,
  getMe,
};

