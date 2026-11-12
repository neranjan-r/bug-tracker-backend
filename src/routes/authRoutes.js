const express = require("express");
const { body } = require("express-validator");
const rateLimit = require("express-rate-limit");
const auth = require("../middleware/auth");
const handleValidation = require("../middleware/validate");
const { register, login, getMe } = require("../controllers/authController");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again later.",
  },
});

router.post(
  "/register",
  authLimiter,
  [
    body("name")
      .isString()
      .withMessage("Name must be text")
      .trim()
      .notEmpty()
      .withMessage("Name is required")
      .isLength({ max: 100 })
      .withMessage("Name cannot exceed 100 characters"),
    body("email")
      .isString()
      .withMessage("Email must be text")
      .trim()
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Please provide a valid email address")
      .isLength({ max: 254 })
      .withMessage("Email cannot exceed 254 characters"),
    body("password")
      .isString()
      .withMessage("Password must be text")
      .notEmpty()
      .withMessage("Password is required")
      .isLength({ min: 6, max: 128 })
      .withMessage("Password must be between 6 and 128 characters"),
  ],
  handleValidation,
  register
);

router.post(
  "/login",
  authLimiter,
  [
    body("email")
      .isString()
      .withMessage("Email must be text")
      .trim()
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Please provide a valid email address"),
    body("password")
      .isString()
      .withMessage("Password must be text")
      .notEmpty()
      .withMessage("Password is required"),
  ],
  handleValidation,
  login
);

router.get("/me", auth, getMe);

module.exports = router;
