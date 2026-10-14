import { useState } from "react";
import "./App.css";

function App() {
  const [videoEnded, setVideoEnded] = useState(false);

  const startExperience = () => {
    window.location.href = "/multiplayer.html";
  };

  return (
    <div className="intro-page">
      <video
        className="intro-video"
        autoPlay
        muted
        playsInline
        onClick={() => setVideoEnded(true)}
        onEnded={() => setVideoEnded(true)}
      >
        <source src="/first-page.mp4" type="video/mp4" />
        Your browser does not support video.
      </video>

      <button
        type="button"
        className="skip-intro-btn"
        onClick={startExperience}
        title="Skip intro to multiplayer menu"
      >
        Skip Intro ⏩
      </button>

      {videoEnded && (
        <button
          className="start-button"
          onClick={startExperience}
          aria-label="Start Experience"
        />
      )}
    </div>
  );
}

export default App;
