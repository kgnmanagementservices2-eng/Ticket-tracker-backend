const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto"); // Built into Node.js, used for random names
const s3Client = require("../config/s3");

const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ status: "error", message: "No file uploaded" });
    }

    // 1. Generate a unique file name (e.g., "b8a9f...-broken-screen.jpg")
    const uniqueFileName = `${crypto.randomUUID()}-${req.file.originalname.replace(/\s+/g, "-")}`;

    // 2. Prepare the command for AWS S3
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: uniqueFileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      // (Optional) If your bucket enforces private ACLs, you might need to adjust bucket policies,
      // but for public read access to attachments, standard configuration works.
    });

    // 3. Send the file to S3
    await s3Client.send(command);

    // 4. Construct the public URL
    const fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${uniqueFileName}`;

    res.status(200).json({
      status: "success",
      message: "File uploaded successfully",
      data: { url: fileUrl },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { uploadFile };
