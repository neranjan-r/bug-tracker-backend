const path = require("path");
const multer = require("multer");

const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3 MB
const MAX_FILES = 5;

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const ALLOWED_MIMETYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function hasValidImageSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return true;
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }
  // GIF: GIF87a / GIF89a
  const gifHeader = buffer.slice(0, 6).toString("ascii");
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
    return true;
  }
  // WEBP: RIFF....WEBP
  if (
    buffer.slice(0, 4).toString("ascii") === "RIFF" &&
    buffer.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return true;
  }
  return false;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mimeOk = ALLOWED_MIMETYPES.has(file.mimetype);
    const extOk = ALLOWED_EXTENSIONS.has(ext);

    if (!mimeOk || !extOk) {
      const err = new Error(
        "Only image files (png, jpg, jpeg, webp, gif) are allowed"
      );
      err.statusCode = 400;
      return cb(err);
    }

    return cb(null, true);
  },
});

const uploadHandler = upload.fields([
  { name: "attachments", maxCount: MAX_FILES },
  { name: "files", maxCount: MAX_FILES },
  { name: "file", maxCount: MAX_FILES },
]);

/**
 * Parse up to 5 uploaded image files with clear, standardized error messages.
 */
function handleImageUpload(req, res, next) {
  uploadHandler(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            message: "Each image must be 3 MB or smaller",
          });
        }
        if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
          return res.status(400).json({
            success: false,
            message: "You can upload a maximum of 5 images per request",
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message,
        });
      }

      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message || "Invalid file upload",
      });
    }

    const combined = [
      ...(req.files?.attachments || []),
      ...(req.files?.files || []),
      ...(req.files?.file || []),
    ];

    if (combined.length > MAX_FILES) {
      return res.status(400).json({
        success: false,
        message: "You can upload a maximum of 5 images per request",
      });
    }

    for (const file of combined) {
      if (!hasValidImageSignature(file.buffer)) {
        return res.status(400).json({
          success: false,
          message: "Uploaded file content is not a valid image",
        });
      }
    }

    req.uploadedImages = combined;
    return next();
  });
}

module.exports = {
  handleImageUpload,
  MAX_FILE_SIZE,
  MAX_FILES,
};
