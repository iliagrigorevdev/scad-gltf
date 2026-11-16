import { downloadBlob, updateCameraAspect } from "./shared.js";

function selectRecorderOptions(targetBitrate = 2_500_000) {
  const candidates = [
    { mimeType: "video/mp4;codecs=avc1", extension: "mp4" },
    { mimeType: "video/mp4", extension: "mp4" },
    { mimeType: "video/webm;codecs=vp9", extension: "webm" },
    { mimeType: "video/webm;codecs=vp8", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
  ];

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) {
      return {
        extension: candidate.extension,
        options: {
          mimeType: candidate.mimeType,
          videoBitsPerSecond: targetBitrate,
        },
      };
    }
  }
  return {
    extension: "webm",
    options: { mimeType: "video/webm", videoBitsPerSecond: targetBitrate },
  };
}

/**
 * Records the currently playing animation clip to an MP4/WebM video file.
 * Returns a controller `{ stop() }` or null if MediaRecorder is unavailable.
 */
export function startAnimationVideoRecording({
  activeCamera,
  viewerCtx,
  viewerEl,
  mixer,
  currentAction,
  isPathTracing,
  showGrid,
  sceneHasLights,
  useCustomLights,
  getBaseFilename,
  onFinished,
}) {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  const { renderer, composer, pathTracer, scene } = viewerCtx;
  const targetW = 512;
  const targetH = 512;

  currentAction.time = 0;
  if (mixer) mixer.update(0);

  updateCameraAspect(activeCamera, targetW, targetH);
  renderer.setSize(targetW, targetH, false);
  composer.setSize(targetW, targetH);
  if (isPathTracing && pathTracer) {
    pathTracer.updateCamera();
  }

  const srcCanvas = renderer.domElement;
  const recordCanvas = document.createElement("canvas");
  recordCanvas.width = targetW;
  recordCanvas.height = targetH;
  const recordCtx = recordCanvas.getContext("2d");

  const stream = recordCanvas.captureStream(30);
  const { extension, options } = selectRecorderOptions();

  let mediaRecorder = null;
  let drawInterval = null;
  let stopRequested = false;

  const restoreViewport = () => {
    viewerCtx.resize(viewerEl.clientWidth, viewerEl.clientHeight, activeCamera);
    if (isPathTracing && pathTracer) {
      pathTracer.setScene(scene, activeCamera);
      pathTracer.updateCamera();
    }
  };

  const ptSamplesTarget = 100;
  const fps = 30;
  const duration = currentAction.getClip().duration;
  const totalFrames = Math.round(duration * fps);
  let currentFrame = 0;
  const renderedFrames = [];

  const captureFrameCanvas = () => {
    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = targetW;
    frameCanvas.height = targetH;
    frameCanvas.getContext("2d").drawImage(srcCanvas, 0, 0, targetW, targetH);
    renderedFrames.push(frameCanvas);
  };

  const encodeFrames = () => {
    if (renderedFrames.length === 0) {
      restoreViewport();
      if (onFinished) onFinished();
      return;
    }

    stopRequested = false;
    mediaRecorder = new MediaRecorder(stream, options);
    const recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      if (drawInterval) clearTimeout(drawInterval);
      const blob = new Blob(recordedChunks, {
        type: options.mimeType.split(";")[0],
      });
      const dlName = getBaseFilename();
      downloadBlob(blob, `${dlName}.${extension}`);
      restoreViewport();
      if (onFinished) onFinished();
    };

    recordCtx.drawImage(renderedFrames[0], 0, 0, targetW, targetH);
    mediaRecorder.start();

    let frameIndex = 0;
    const startTime = performance.now();

    const playLoop = () => {
      if (stopRequested) {
        mediaRecorder.stop();
        return;
      }

      if (frameIndex < renderedFrames.length) {
        recordCtx.drawImage(renderedFrames[frameIndex], 0, 0, targetW, targetH);
        frameIndex++;
        const nextTime = startTime + frameIndex * (1000 / fps);
        const delay = Math.max(0, nextTime - performance.now());
        drawInterval = setTimeout(playLoop, delay);
      } else {
        drawInterval = setTimeout(() => mediaRecorder.stop(), 50);
      }
    };

    drawInterval = setTimeout(playLoop, 0);
  };

  const renderNextFrame = () => {
    if (stopRequested || currentFrame >= totalFrames) {
      encodeFrames();
      return;
    }

    currentAction.time = currentFrame / fps;
    if (mixer) {
      mixer.update(0);
    }

    if (isPathTracing && pathTracer) {
      viewerCtx.syncEnvironmentVisibility({ isPathTracing: true });
      pathTracer.setScene(scene, activeCamera);

      const waitForSamples = () => {
        if (stopRequested) {
          renderNextFrame();
          return;
        }

        let samplesThisFrame = 0;
        const maxSamplesPerFrame = 5;
        while (
          pathTracer.samples < ptSamplesTarget &&
          samplesThisFrame < maxSamplesPerFrame
        ) {
          pathTracer.renderSample();
          samplesThisFrame++;
        }

        if (pathTracer.samples >= ptSamplesTarget) {
          captureFrameCanvas();
          currentFrame++;
          setTimeout(renderNextFrame, 0);
        } else {
          requestAnimationFrame(waitForSamples);
        }
      };
      waitForSamples();
    } else {
      viewerCtx.syncEnvironmentVisibility({
        isPathTracing: false,
        showGrid,
        sceneHasLights,
        useCustomLights,
      });
      composer.render();
      captureFrameCanvas();
      currentFrame++;
      setTimeout(renderNextFrame, 0);
    }
  };

  renderNextFrame();

  return {
    stop() {
      stopRequested = true;
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    },
  };
}
