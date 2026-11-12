const { validationResult } = require("express-validator");

/**
 * Middleware that runs after express-validator checks and returns the first
 * error message using the standard { success: false, message } format.
 */
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg,
    });
  }
  return next();
}

module.exports = handleValidation;

