var mediaRecorder = null;
var capturedStream = null;
var chunks = [];
var context = new AudioContext();
var pageTitle = "recording";
let playbackTimeoutId = null;
var connectedNodes = [];

document.getElementById('startRecording').addEventListener('click', function() {
  if (mediaRecorder) {
    alert('recoding already started...');
    return;
  }
  chunks = [];
  timer.innerText = "00:00:000";
  startTime = Date.now();
  timerId = setInterval(()=>{
    const elapsedTime = Date.now() - startTime;
    const milliseconds = Math.floor(elapsedTime % 1000);
    const seconds = Math.floor(elapsedTime / 1000) % 60;
    const minutes = Math.floor(elapsedTime / 1000 / 60);
    timer.innerText = `${padNumber(minutes)}:${padNumber(seconds)}:${padNumber(milliseconds, 3)}`;

  }, 1);
  
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    pageTitle = tabs[0].title;
    chrome.tabCapture.capture({ audio: true, video: false }, function(stream) {
      
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
        return;
      }
      capturedStream = stream
      if (stream) {
        let mediaStreamSourceNode = context.createMediaStreamSource(stream)
        let mediaStreamDestination = context.createMediaStreamDestination();
        mediaStreamSourceNode.connect(context.destination);
        mediaStreamSourceNode.connect(mediaStreamDestination);
        mediaRecorder = new MediaRecorder(mediaStreamDestination.stream);
        // 处理录制数据
        mediaRecorder.ondataavailable = function(event) {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        mediaRecorder.start();
      }
    });
  });
});

document.getElementById('stopRecording').addEventListener('click', async function() {
  if (!mediaRecorder) {
    alert('not recoding...');
    return;
  }
  clearInterval(timerId);
  await context.close();
  context = new AudioContext();
  mediaRecorder.stop();
  mediaRecorder = null;
});

document.getElementById('play').addEventListener('click', async function() {
  if (connectedNodes.length > 0) {
    connectedNodes.forEach(node => node.disconnect());
    connectedNodes = [];
  }

  let audioBlob = new Blob(chunks, {
    mimeType: 'audio/wav'
  });
  const audioUrl = URL.createObjectURL(audioBlob);

  fetch(audioUrl)
  .then(response => response.arrayBuffer())
  .then(data => context.decodeAudioData(data))
  .then(buffer => {
    const loopStartPercentage = parseFloat(document.getElementById('startPoint').value);
    const loopEndPercentage = parseFloat(document.getElementById('endPoint').value);
    const duration = buffer.duration;
    const loopStart = duration * loopStartPercentage;
    const loopEnd = duration * loopEndPercentage;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = loopStart;
    source.loopEnd = loopEnd;
    source.connect(context.destination);
    connectedNodes.push(source);
    source.start(0, loopStart);
  });

});

document.getElementById('saveRecording').addEventListener('click', function() {
  
  let audioBlob = new Blob(chunks, {
    mimeType: 'audio/wav'
  });
  const audioUrl = URL.createObjectURL(audioBlob);
  fetch(audioUrl)
  .then(response => response.arrayBuffer())
  .then(data => context.decodeAudioData(data))
  .then(buffer => {
    const loopStartPercentage = parseFloat(document.getElementById('startPoint').value);
    const loopEndPercentage = parseFloat(document.getElementById('endPoint').value);
    const fadeInMillisecond = parseFloat(document.getElementById('fadeInMillisecond').value);
    const fadeOutMillisecond = parseFloat(document.getElementById('fadeOutMillisecond').value);

    const duration = buffer.duration;
    const loopStart = duration * loopStartPercentage;
    const loopEnd = duration * loopEndPercentage;
    applyFade(buffer, fadeInMillisecond, fadeOutMillisecond);
    saveAsWav(buffer, loopStart, loopEnd);
  });
  chunks = []
  capturedStream.getTracks().forEach(track => track.stop());
  capturedStream = null;
});

function padNumber(num, length = 2) {
  return num.toString().padStart(length, "0");
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodeWAV(audioBuffer, startSample, endSample) {
  const numOfChan = audioBuffer.numberOfChannels;
  const length = endSample - startSample;
  const buffer = new ArrayBuffer(44 + length * numOfChan * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 32 + length * numOfChan * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * 2 * numOfChan, true);
  view.setUint16(32, numOfChan * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length * numOfChan * 2, true);

  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numOfChan; channel++) {
      const sample = audioBuffer.getChannelData(channel)[i + startSample];
      const value = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + i * 2 * numOfChan + channel * 2, value * 0x7FFF, true);
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}

function saveAsWav(buffer, loopStart, loopEnd) {
  const startSample = Math.round(loopStart * buffer.sampleRate);
  const endSample = Math.round(loopEnd * buffer.sampleRate);
  const wavBlob = encodeWAV(buffer, startSample, endSample);
  const downloadUrl = URL.createObjectURL(wavBlob);
  const anchor = document.createElement('a');

  anchor.href = downloadUrl;
  anchor.download = `${pageTitle.toLowerCase().replaceAll(" ", "_").replaceAll("#", "_sharp_").replaceAll("-", "_").replace(/_{2,}/g, '_')}.wav`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(downloadUrl);
  }, 100);
}

function applyFade(buffer, fadeInMs, fadeOutMs) {
  const length = buffer.length;
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const fadeInSamples = Math.round(sampleRate * (fadeInMs / 1000));
  const fadeOutSamples = Math.round(sampleRate * (fadeOutMs / 1000));

  for (let channel = 0; channel < channels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < fadeInSamples; i++) {
      channelData[i] *= i / fadeInSamples;
    }
    for (let i = 0; i < fadeOutSamples; i++) {
      channelData[length - 1 - i] *= i / fadeOutSamples;
    }
  }
}