const express = require("express");
const router = express.Router();
const uploadController = require("../controllers/uploadController");
const { authenticateToken } = require("../middlewares/auth");
const upload = require("../middlewares/upload");

// Protect the route
router.use(authenticateToken);

// POST /api/upload
router.post("/", upload.single("file"), uploadController.uploadFile);

module.exports = router;
