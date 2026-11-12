const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { v2: cloudinary } = require("cloudinary");

const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function extractCloudinaryPublicId(url) {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i);
  return match ? match[1] : null;
}

/**
 * Save an uploaded image buffer to Cloudinary when configured, or fall back to
 * local disk storage when Cloudinary environment variables are unset.
 */
async function saveFile(file) {
  const safeOriginalName = path.basename(file.originalname || "screenshot.png");

  if (isCloudinaryConfigured()) {
    configureCloudinary();
    const publicId = crypto.randomUUID();

    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "bug-tracker",
          public_id: publicId,
          resource_type: "image",
        },
        (err, uploaded) => {
          if (err) reject(err);
          else resolve(uploaded);
        }
      );
      uploadStream.end(file.buffer);
    });

    return {
      url: result.secure_url,
      filename: safeOriginalName,
    };
  }

  ensureUploadsDir();
  const ext = path.extname(safeOriginalName).toLowerCase();
  const safeExt = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)
    ? ext
    : ".png";
  const storedName = `${crypto.randomUUID()}${safeExt}`;
  const targetPath = path.join(UPLOADS_DIR, storedName);

  await fs.promises.writeFile(targetPath, file.buffer);

  return {
    url: `/uploads/${storedName}`,
    filename: safeOriginalName,
  };
}

/**
 * Delete an attachment from Cloudinary or local disk storage.
 */
async function deleteFile(attachment) {
  if (!attachment?.url) return;

  if (attachment.url.startsWith("/uploads/")) {
    const storedName = path.basename(attachment.url);
    const targetPath = path.join(UPLOADS_DIR, storedName);
    try {
      await fs.promises.unlink(targetPath);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    return;
  }

  if (
    isCloudinaryConfigured() &&
    attachment.url.includes("res.cloudinary.com")
  ) {
    configureCloudinary();
    const publicId = extractCloudinaryPublicId(attachment.url);
    if (publicId) {
      await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    }
  }
}

module.exports = {
  UPLOADS_DIR,
  isCloudinaryConfigured,
  saveFile,
  deleteFile,
};
