/**
 * OSS Upload Signature Service
 * 
 * Generates pre-signed PUT URLs for direct browser-to-OSS upload.
 * Runs on ECS alongside nginx, accessed via /api/oss/sign
 * 
 * AK/SK stay on server, never exposed to frontend.
 */

const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const PORT = process.env.OSS_SIGN_PORT || 3002;

// OSS config
const OSS_CONFIG = {
  accessKeyId: process.env.OSS_AK,
  accessKeySecret: process.env.OSS_SK,
  bucket: 'biof3-uploads',
  region: 'oss-cn-hangzhou',
  endpoint: 'oss-cn-hangzhou.aliyuncs.com',
};

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({status: 'ok'});
});

/**
 * Generate a pre-signed PUT URL for direct upload
 * POST /sign
 * Body: { filename: "data.csv", contentType: "text/csv" }
 * Returns: { uploadUrl, fileUrl, key }
 */
app.post('/sign', (req, res) => {
  const {filename, contentType} = req.body;
  if (!filename) {
    return res.status(400).json({error: '缺少 filename'});
  }

  // Generate unique key: uploads/{timestamp}-{random}-{filename}
  const ts = Date.now();
  const rand = crypto.randomBytes(4).toString('hex');
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `uploads/${ts}-${rand}-${safeFilename}`;

  const expires = Math.floor(Date.now() / 1000) + 300; // 5 min expiry
  const host = `https://${OSS_CONFIG.bucket}.${OSS_CONFIG.endpoint}`;

  // Generate signature for PUT request (OSS V1 signature)
  const mimeType = contentType || 'application/octet-stream';
  const stringToSign = `PUT\n\n${mimeType}\n${expires}\n/${OSS_CONFIG.bucket}/${key}`;
  const signature = crypto
    .createHmac('sha1', OSS_CONFIG.accessKeySecret)
    .update(stringToSign)
    .digest('base64');

  const uploadUrl = `${host}/${key}?OSSAccessKeyId=${encodeURIComponent(OSS_CONFIG.accessKeyId)}&Expires=${expires}&Signature=${encodeURIComponent(signature)}`;
  const fileUrl = `${host}/${key}`;

  res.json({uploadUrl, fileUrl, key});
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`🔐 OSS Sign Service running on port ${PORT}`);
});
