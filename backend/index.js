// backend/index.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const path = require("path");
const fs = require("fs");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// Folders
const uploadFolder = path.join(__dirname, "uploads");
const tempFolder = path.join(__dirname, "temp");
const outputFolder = path.join(__dirname, "outputs");

[uploadFolder, tempFolder, outputFolder].forEach((folder) => {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);
});

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadFolder);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

// Helper: create video from image (3 seconds)
function createVideoFromImage(inputPath, index) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(tempFolder, `img-${Date.now()}-${index}.mp4`);

    ffmpeg(inputPath)
      .inputOptions(["-loop 1"])
      .outputOptions(["-t 3", "-r 30"])
      .videoFilters("scale=1280:720,format=yuv420p")
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

// Helper: normalize video to uniform format/size
function normalizeVideo(inputPath, index) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(tempFolder, `vid-${Date.now()}-${index}.mp4`);

    ffmpeg(inputPath)
      .outputOptions(["-r 30"])
      .videoFilters("scale=1280:720,format=yuv420p")
      .audioCodec("aac")
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

// POST /create-video
app.post(
  "/create-video",
  upload.fields([
    { name: "media", maxCount: 50 }, // many photos/videos
    { name: "audio", maxCount: 1 }, // one recorded audio
  ]),
  async (req, res) => {
    const mediaFiles = req.files["media"];
    const audioFiles = req.files["audio"];

    if (!mediaFiles || mediaFiles.length === 0) {
      return res.status(400).json({ error: "No media files received." });
    }
    if (!audioFiles || audioFiles.length === 0) {
      return res.status(400).json({ error: "No audio file received." });
    }

    const audioFile = audioFiles[0];

    try {
      // 1. Convert each image to video, normalize each video
      const segmentPaths = [];
      for (let i = 0; i < mediaFiles.length; i++) {
        const file = mediaFiles[i];
        const mime = file.mimetype || "";

        if (mime.startsWith("image/")) {
          const seg = await createVideoFromImage(file.path, i);
          segmentPaths.push(seg);
        } else if (mime.startsWith("video/")) {
          const seg = await normalizeVideo(file.path, i);
          segmentPaths.push(seg);
        } else {
          console.log("Skipping unsupported file type:", mime);
        }
      }

      if (!segmentPaths.length) {
        return res
          .status(400)
          .json({ error: "No valid media (image/video) files to process." });
      }

      // 2. Create a concat list file for FFmpeg
      const concatListPath = path.join(
        tempFolder,
        `concat-list-${Date.now()}.txt`
      );
      const concatFileContent = segmentPaths
        .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
        .join("\n");
      fs.writeFileSync(concatListPath, concatFileContent);

      // 3. Concatenate all segments into one video
      const mergedVideoPath = path.join(
        tempFolder,
        `merged-${Date.now()}.mp4`
      );

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(["-f concat", "-safe 0"])
          .outputOptions(["-c:v libx264", "-pix_fmt yuv420p", "-r 30"])
          .on("start", (cmd) => {
            console.log("FFmpeg concat cmd:", cmd);
          })
          .on("end", () => {
            console.log("Concatenation finished:", mergedVideoPath);
            resolve();
          })
          .on("error", (err) => {
            console.error("FFmpeg concat error:", err);
            reject(err);
          })
          .save(mergedVideoPath);
      });

      // 4. Merge concatenated video + recorded audio
      const outputFileName = `final-${Date.now()}.mp4`;
      const outputPath = path.join(outputFolder, outputFileName);

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(mergedVideoPath)
          .input(audioFile.path)
          .outputOptions(["-c:v copy", "-c:a aac", "-shortest"])
          .on("start", (cmd) => {
            console.log("FFmpeg merge cmd:", cmd);
          })
          .on("end", () => {
            console.log("Final merge finished:", outputPath);
            resolve();
          })
          .on("error", (err) => {
            console.error("FFmpeg merge error:", err);
            reject(err);
          })
          .save(outputPath);
      });

      // 5. Send final video as download
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="final-video.mp4"`
      );

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);

      // Optional cleanup after response
      readStream.on("close", () => {
        try {
          // remove temp files if you want
          fs.unlinkSync(audioFile.path);
          mediaFiles.forEach((f) => {
            fs.existsSync(f.path) && fs.unlinkSync(f.path);
          });
          segmentPaths.forEach((p) => {
            fs.existsSync(p) && fs.unlinkSync(p);
          });
          fs.existsSync(concatListPath) && fs.unlinkSync(concatListPath);
          // fs.unlinkSync(mergedVideoPath); // if you don't want to keep merged
        } catch (e) {
          console.error("Cleanup error:", e);
        }
      });
    } catch (err) {
      console.error("Error in /create-video:", err);
      return res.status(500).json({ error: "Failed to create video." });
    }
  }
);

app.get("/", (req, res) => {
  res.send("Video Maker Backend is running (multi-media mode)");
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
