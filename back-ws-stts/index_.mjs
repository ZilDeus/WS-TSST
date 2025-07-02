import { WebSocket, WebSocketServer } from "ws";
import { getLogger, configure, getConsoleSink } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [{ category: ['openai-socket'], lowestLevel: "info", sinks: ["console"] }]
});

const logger = getLogger(['openai-socket']);

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// Converts a Float32Array to base64-encoded PCM16 data
function base64EncodeAudio(float32Array) {
  const arrayBuffer = floatTo16BitPCM(float32Array);
  let binary = '';
  let bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000; // 32KB chunk size
  for (let i = 0; i < bytes.length; i += chunkSize) {
    let chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

const openAISocketUrl = "wss://api.openai.com/v1/realtime?intent=transcription";
const clientSocketPort = 3000;
let bufferedMs = 0;
const SAMPLE_RATE = 24000;

const openAiSocket = new WebSocket(openAISocketUrl, {
  headers: {
    "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
    "OpenAI-Beta": "realtime=v1",
  },
});

openAiSocket.on("open", () => {
  logger.info("Connected to OpenAI server.");
});

openAiSocket.on("message", message => {
  console.log("message")
  const data = JSON.parse(message.toString());
  const event = data.type;
  logger.info("📨 Received event: {event}", { event });
  logger.info("📨 Received data: {data}", { data });
});

openAiSocket.on("error", (error) => {
  logger.error("OpenAI WebSocket error:\n{error}", { error });
});

openAiSocket.on("close", () => {
  logger.trace("OpenAI WebSocket closed");
});

const clientSocketServer = new WebSocketServer({ port: clientSocketPort });
let clientSocket = null;

clientSocketServer.on('connection', (socket) => {
  logger.info('Client connected');
  clientSocket = socket;

  socket.on('message', (base64Data) => {
    const base64Chunk = base64EncodeAudio(base64Data);
    if (Buffer.isBuffer(base64Data)) {
      console.log('📦 Received Node.js Buffer')

      // Try to interpret it
      if (base64Data.length % 4 === 0) {
        const float32 = new Float32Array(base64Data.buffer, base64Data.byteOffset, base64Data.length / 4)
        console.log('🔍 First float32 sample:', float32[0])
      } else if (base64Data.length % 2 === 0) {
        const int16 = new Int16Array(base64Data.buffer, base64Data.byteOffset, base64Data.length / 2)
        console.log('🔍 First int16 sample:', int16[0])
      } else {
        console.log('❓ Unknown format')
      }

    } else if (typeof base64Data === 'string') {
      console.log('📨 Received string (probably base64)')
      // Convert if needed:
      const buf = Buffer.from(base64Data, 'base64')
      // Then inspect like above
    } else {
      console.log('❌ Unknown data type:', typeof base64Data)
    }

    const payload = {
      type: 'input_audio_buffer.append',
      audio: base64Chunk
    };

    //logger.info('📨 Sending audio data to OpenAI');
    openAiSocket.send(JSON.stringify(payload));
  });

  socket.on('close', () => {
    logger.info('Client disconnected');
    clientSocket = null;
  });
});
