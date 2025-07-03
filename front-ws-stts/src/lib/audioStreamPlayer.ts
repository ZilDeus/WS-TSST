export class WavAudioStreamPlayer {
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
export class PCMAudioStreamPlayer {
  audioContext: AudioContext;
  sampleRate: number
  channels: number
  currentPlaybackTime: number
  bufferSize: number
  sources: AudioBufferSourceNode[]
  audioQueue: Float32Array[]
  isPlaying: boolean
  nextBufferTime: number
  constructor(sampleRate = 24000, channels = 1) {
    this.audioContext = new AudioContext();
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.audioQueue = [];
    this.isPlaying = false;
    this.currentPlaybackTime = 0;
    this.nextBufferTime = 0;
    this.bufferSize = 4096; // Samples per buffer
    this.sources = [];
  }

  async addPCMChunk(arrayBuffer: ArrayBuffer) {
    const int16Array = new Int16Array(arrayBuffer);
    const float32Array = new Float32Array(int16Array.length);

    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    this.audioQueue.push(float32Array);

    if (!this.isPlaying) {
      this.startPlayback();
    }

    this.processAudioQueue();
  }

  startPlayback() {
    this.isPlaying = true;
    this.nextBufferTime = this.audioContext.currentTime;
  }

  processAudioQueue() {
    while (this.audioQueue.length > 0) {
      const audioData = this.audioQueue.shift();
      this.scheduleAudioBuffer(audioData!);
    }
  }

  scheduleAudioBuffer(audioData: Float32Array) {
    const buffer = this.audioContext.createBuffer(
      this.channels,
      audioData.length,
      this.sampleRate
    );

    buffer.copyToChannel(audioData, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const startTime = Math.max(this.audioContext.currentTime, this.nextBufferTime);
    source.start(startTime);

    this.nextBufferTime = startTime + buffer.duration;

    this.sources.push(source);

    source.onended = () => {
      const index = this.sources.indexOf(source);
      if (index > -1) {
        this.sources.splice(index, 1);
      }
    };
  }

  stop() {
    this.isPlaying = false;
    this.sources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
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
