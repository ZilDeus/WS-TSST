export class WavPlayer {
  audioContext: AudioContext;
  chunks: Uint8Array[];
  isPlaying: boolean;
  currentTime: number;
  sources: AudioBufferSourceNode[];
  constructor() {
    this.audioContext = new window.AudioContext();
    this.chunks = [];
    this.isPlaying = false;
    this.currentTime = 0;
    this.sources = [];
  }

  async addAudioChunk(chunk: Uint8Array) {
    this.chunks.push(chunk);

    if (this.chunks.length % 5 === 0) {
      await this.tryProcessChunks();
    }
  }

  async tryProcessChunks() {
    const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of this.chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    try {
      const audioBuffer = await this.audioContext.decodeAudioData(combined.buffer.slice());

      this.playBuffer(audioBuffer);
      this.chunks = [];

    } catch (error) {
      console.log('Accumulating more audio data...');
    }
  }

  async finalizeAudio() {
    if (this.chunks.length > 0) {
      await this.tryProcessChunks();
    }
  }

  playBuffer(audioBuffer: AudioBuffer) {
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    const startTime = Math.max(this.audioContext.currentTime, this.currentTime);
    source.start(startTime);
    this.currentTime = startTime + audioBuffer.duration;

    this.sources.push(source);

    source.onended = () => {
      const index = this.sources.indexOf(source);
      if (index > -1) {
        this.sources.splice(index, 1);
      }
    };
  }

  stop() {
    this.sources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
      }
    });
    this.sources = [];
    this.chunks = [];
    this.currentTime = 0;
  }

  reset() {
    this.stop();
    this.isPlaying = false;
  }
}

export class PCMPlayer {

  audioContext: AudioContext
  sampleRate: number
  channels: number;
  audioQueue: Float32Array[]
  isPlaying: boolean
  currentPlaybackTime: number
  nextBufferTime: number
  bufferSize: number
  sources: AudioBufferSourceNode[]

  constructor(sampleRate = 24000, channels = 1) {
    this.audioContext = new window.AudioContext();
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.audioQueue = [];
    this.isPlaying = false;
    this.currentPlaybackTime = 0;
    this.nextBufferTime = 0;
    this.bufferSize = 4096; // Samples per buffer
    this.sources = [];

    console.log(`Audio context sample rate: ${this.audioContext.sampleRate}Hz`);
    console.log(`Target sample rate: ${this.sampleRate}Hz`);
    console.log(`OpenAI TTS PCM format: 24kHz, 16-bit signed, mono`);
  }

  async addPCMChunk(arrayBuffer: Int16Array) {
    console.log(`Received PCM chunk: ${arrayBuffer.byteLength} bytes`);

    // OpenAI TTS PCM format: 24kHz, 16-bit signed, mono
    const audioData = new Float32Array(arrayBuffer.length);

    for (let i = 0; i < arrayBuffer.length; i++) {
      audioData[i] = arrayBuffer[i] / 32768.0;
    }

    this.audioQueue.push(audioData);

    // Start playback if not already playing
    if (!this.isPlaying) {
      this.startPlayback();
    }

    // Process queued audio
    this.processAudioQueue();
  }

  startPlayback() {
    this.isPlaying = true;
    this.nextBufferTime = this.audioContext.currentTime;
  }

  processAudioQueue() {
    // Process audio queue and schedule playback
    while (this.audioQueue.length > 0) {
      const audioData = this.audioQueue.shift();
      this.scheduleAudioBuffer(audioData!);
    }
  }

  scheduleAudioBuffer(audioData: Float32Array) {
    // Create buffer with proper sample rate handling
    const targetSampleRate = this.audioContext.sampleRate;
    let processedData = audioData;

    // Resample if needed
    if (this.sampleRate !== targetSampleRate) {
      console.log(`Resampling from ${this.sampleRate}Hz to ${targetSampleRate}Hz`);
      processedData = this.resample(audioData, this.sampleRate, targetSampleRate);
    }

    const buffer = this.audioContext.createBuffer(
      this.channels,
      processedData.length,
      targetSampleRate
    );

    buffer.copyToChannel(processedData, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    // Add gain node for volume control and debugging
    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 1.0; // Adjust if too quiet/loud

    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    // Schedule playback at the right time
    const startTime = Math.max(this.audioContext.currentTime, this.nextBufferTime);
    source.start(startTime);

    // Update next buffer time
    this.nextBufferTime = startTime + buffer.duration;

    // Track sources for cleanup
    this.sources.push(source);

    source.onended = () => {
      const index = this.sources.indexOf(source);
      if (index > -1) {
        this.sources.splice(index, 1);
      }
    };
  }

  // Simple linear resampling
  resample(inputData: Float32Array, inputRate: number, outputRate: number) {
    const ratio = inputRate / outputRate;
    const outputLength = Math.round(inputData.length / ratio);
    const outputData = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
      const fraction = srcIndex - srcIndexFloor;

      outputData[i] = inputData[srcIndexFloor] * (1 - fraction) +
        inputData[srcIndexCeil] * fraction;
    }

    return outputData;
  }

  stop() {
    this.isPlaying = false;
    this.sources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Source might already be stopped
      }
    });
    this.sources = [];
    this.audioQueue = [];
    this.nextBufferTime = 0;
  }

  reset() {
    this.stop();
  }
}
