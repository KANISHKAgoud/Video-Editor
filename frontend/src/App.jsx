// frontend/src/App.jsx
import { useEffect, useRef, useState } from "react";
import "./App.css";

function App() {
  const [mediaFiles, setMediaFiles] = useState([]); // {id, file, previewUrl, type}
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [recordingStatus, setRecordingStatus] = useState("Not recording");

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const [isCreating, setIsCreating] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      mediaFiles.forEach((m) => URL.revokeObjectURL(m.previewUrl));
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMediaChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // revoke old previews
    mediaFiles.forEach((m) => URL.revokeObjectURL(m.previewUrl));

    const newMedia = files.map((file, index) => ({
      id: Date.now() + "-" + index,
      file,
      type: file.type.startsWith("image") ? "image" : "video",
      previewUrl: URL.createObjectURL(file),
    }));

    setMediaFiles(newMedia);
    setErrorMessage("");
  };

  const moveItem = (index, direction) => {
    setMediaFiles((prev) => {
      const newArr = [...prev];
      const swapIndex = index + direction;
      if (swapIndex < 0 || swapIndex >= newArr.length) return prev;
      const temp = newArr[index];
      newArr[index] = newArr[swapIndex];
      newArr[swapIndex] = temp;
      return newArr;
    });
  };

  const removeItem = (index) => {
    setMediaFiles((prev) => {
      const newArr = [...prev];
      const [removed] = newArr.splice(index, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return newArr;
    });
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Your browser does not support audio recording.");
        return;
      }

      setRecordedAudio(null);
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setRecordedAudio(blob);
        setRecordingStatus("Recording finished");
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingStatus("Recording...");
    } catch (err) {
      console.error(err);
      alert("Could not start recording. Check microphone permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleCreateVideo = async () => {
    setErrorMessage("");
    setDownloadUrl(null);

    if (!mediaFiles.length) {
      setErrorMessage("Please select at least one photo or video.");
      return;
    }
    if (!recordedAudio) {
      setErrorMessage("Please record background audio first.");
      return;
    }

    const formData = new FormData();
    // Append in the order shown in the list (sequence chosen by user)
    mediaFiles.forEach((m) => {
      formData.append("media", m.file);
    });
    formData.append("audio", recordedAudio, "background-audio.webm");

    try {
      setIsCreating(true);

      const res = await fetch("http://localhost:5000/create-video", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to create video.");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
    } catch (err) {
      console.error(err);
      setErrorMessage(err.message || "Something went wrong.");
    } finally {
      setIsCreating(false);
    }
  };

  // ...rest of imports & logic stay the same

  return (
    <div className="app">
      <div className="app-inner">
        <header className="app-header">
          <h1>Video Story Maker</h1>
          <p className="app-subtitle">
            Combine multiple photos & videos, record your own background sound, and download the final video.
          </p>
        </header>

        {/* STEP 1: Select Media */}
        <section className="card">
          <h2>1. Select Photos / Videos</h2>
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={handleMediaChange}
          />
          <p className="hint">
            You can select <strong>multiple images and videos</strong>. We will
            stitch them together in the order shown below.
          </p>

          {mediaFiles.length > 0 && (
            <div className="media-list">
              {mediaFiles.map((m, index) => (
                <div key={m.id} className="media-item">
                  <span className="media-index">{index + 1}.</span>
                  {m.type === "image" ? (
                    <img
                      src={m.previewUrl}
                      alt={`img-${index}`}
                      className="preview-thumb"
                    />
                  ) : (
                    <video
                      src={m.previewUrl}
                      className="preview-thumb"
                      muted
                    />
                  )}
                  <div className="media-info">
                    <p className="media-name">{m.file.name}</p>
                    <p className="media-type">({m.type})</p>
                  </div>
                  <div className="media-actions">
                    <button onClick={() => moveItem(index, -1)}>↑</button>
                    <button onClick={() => moveItem(index, 1)}>↓</button>
                    <button onClick={() => removeItem(index)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* STEP 2: Record Audio */}
        <section className="card">
          <h2>2. Record Background Sound (Mic)</h2>
          <p className="status">Status: {recordingStatus}</p>
          <div className="buttons">
            <button onClick={startRecording} disabled={isRecording}>
              Start Recording
            </button>
            <button onClick={stopRecording} disabled={!isRecording}>
              Stop Recording
            </button>
          </div>
          {recordedAudio && (
            <audio
              controls
              src={URL.createObjectURL(recordedAudio)}
            />
          )}
          <p className="hint">
            Speak, play music, or record any surrounding sound. This becomes the{" "}
            <strong>background music</strong> of the final video.
          </p>
        </section>

        {/* STEP 3: Create Final Video */}
        <section className="card">
          <h2>3. Create Final Video with Background Music</h2>
          <button onClick={handleCreateVideo} disabled={isCreating}>
            {isCreating ? "Creating..." : "Create & Download Video"}
          </button>

          {errorMessage && <p className="error">{errorMessage}</p>}

          {downloadUrl && (
            <div className="download-section">
              <p>Final video is ready!</p>
              <a href={downloadUrl} download="final-video.mp4">
                ⬇ Download Final Video
              </a>
              <video
                src={downloadUrl}
                controls
                className="preview-video"
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;
