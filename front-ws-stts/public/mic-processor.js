class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4800; // 200ms at 24kHz
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (input.length > 0) {
      const inputChannel = input[0];

      for (let i = 0; i < inputChannel.length; i++) {
        // Add sample to buffer
        this.buffer[this.bufferIndex] = inputChannel[i];
        this.bufferIndex++;

        // When buffer is full, convert to Int16 and send
        if (this.bufferIndex >= this.bufferSize) {
          // Convert Float32 to Int16
          const int16Buffer = new Int16Array(this.bufferSize);
          for (let j = 0; j < this.bufferSize; j++) {
            // Clamp to [-1, 1] and convert to 16-bit
            const clampedValue = Math.max(-1, Math.min(1, this.buffer[j]));
            int16Buffer[j] = Math.round(clampedValue * 32767);
          }

          // Send as ArrayBuffer
          this.port.postMessage(int16Buffer.buffer);

          // Reset buffer
          this.bufferIndex = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);

//class MicProcessor extends AudioWorkletProcessor {
//  constructor() {
//    super()
//  }
//
//  process(inputs) {
//    const input = inputs[0]
//    if (input.length > 0) {
//      const channelData = input[0]
//
//      const copied = new Float32Array(channelData.length)
//      copied.set(channelData)
//
//      this.port.postMessage(copied)
//    }
//
//    return true
//  }
//}
//
//registerProcessor('mic-processor', MicProcessor)

