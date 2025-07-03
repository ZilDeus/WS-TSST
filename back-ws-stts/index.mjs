import { WebSocket, WebSocketServer } from "ws";
import OpenAI from "openai";

const openai = new OpenAI();
import { getLogger, configure, getConsoleSink } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [{ category: ['openai-socket'], lowestLevel: "info", sinks: ["console"] }]
});

const logger = getLogger(['openai-socket']);
const model = "gpt-4o-realtime-preview-2025-06-03";
const streamTTS = async (transcript) => {
  clientSocket.send(JSON.stringify({
    type: 'transcription',
    transcript: transcript,
  }));
  logger.trace("Transcribing audio from transcript: {transcript}", { transcript });
  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "coral",
    input: `Solutions provided:
The PCM approach would be more suitable for truly real-time streaming, while the WAV approach works better for slightly delayed but higher quality playback.`,
    instructions: "Speak in a cheerful and positive tone.",
    response_format: "pcm",
  });

  const reader = response.body.getReader()
  const chunkSize = 8192;
  let bufferAccumulator = Buffer.alloc(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    bufferAccumulator = Buffer.concat([bufferAccumulator, Buffer.from(value)]);

    if (bufferAccumulator.length >= chunkSize) {
      const chunkToSend = bufferAccumulator.subarray(0, chunkSize);
      logger.info("📩 Sending Audio Chunk");
      clientSocket.send(chunkToSend);
      bufferAccumulator = bufferAccumulator.subarray(chunkSize);
    }
  }

  const remainingLength = bufferAccumulator.length - (bufferAccumulator.length % 2);
  if (remainingLength > 0) {
    const remainingChunk = bufferAccumulator.subarray(0, remainingLength);
    logger.info("📩 Sending final Audio Chunk");
    clientSocket.send(remainingChunk);
  }

  logger.info("✅ Done Collecting Audio ,Sending Done Signal");
  clientSocket.send(JSON.stringify({
    type: 'done',
  }));
}

const openAISocketUrl = `wss://api.openai.com/v1/realtime?model=${model}`;
const clientSocketPort = 3000;
let sessionConfigured = false;

const openAiSocket = new WebSocket(openAISocketUrl, {
  headers: {
    "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
    "OpenAI-Beta": "realtime=v1",
  },
});

openAiSocket.on("open", () => {
  logger.info("Connected to OpenAI server.");

  // Configure the session for transcription
  const sessionConfig = {
    type: "session.update",
    session: {
      modalities: ["text", "audio"],
      instructions: "You are a transcription assistant.Please transcribe the audio you receive.",
      input_audio_format: "pcm16",
      input_audio_transcription: {
        model: "whisper-1"
      },
    }
  };

  openAiSocket.send(JSON.stringify(sessionConfig));
});

openAiSocket.on("message", message => {
  const data = JSON.parse(message.toString());
  const event = data.type;

  logger.trace("📨 Received event: {event}", { event });

  switch (event) {
    case 'session.created':
      logger.trace('✅ Session created');
      sessionConfigured = true;
      break;

    case 'session.updated':
      logger.trace('✅ Session configured for transcription');
      break;

    case 'input_audio_buffer.committed':
      logger.trace('✅ Audio buffer committed');
      break;

    case 'input_audio_buffer.speech_started':
      logger.trace('🎤 Speech started');
      break;

    case 'input_audio_buffer.speech_stopped':
      logger.trace('🔇 Speech stopped');
      break;

    case 'conversation.item.created':
      logger.trace('📝 Conversation item created:{id}', { id: data.item?.id });
      break;
    case 'conversation.item.input_audio_transcription.completed':
      logger.info('🎯 TRANSCRIPTION COMPLETED: {transcript}', { transcript: data.transcript });
      // Forward transcription to client
      if (clientSocket) {
        streamTTS(data.transcript)
      }
      break;

    case 'conversation.item.input_audio_transcription.failed':
      logger.error('❌ Transcription failed:\n{data}', { data });
      break;

    case 'error':
      logger.error('❌ OpenAI Error:\n{data}', { data });
      break;

    default:
      if (event.includes('delta') || event.includes('completed')) {
        logger.trace('📄 Message:{data}', { data });
      }
  }
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
    if (!sessionConfigured) {
      logger.trace('⏳ Session not configured yet, ignoring audio data');
      return;
    }

    if (openAiSocket.readyState !== WebSocket.OPEN) {
      logger.trace('⏳ OpenAI socket not ready, ignoring audio data');
      return;
    }

    logger.info("🎙️ Received audio data");
    const binaryData = Buffer.from(base64Data.toString(), 'base64');
    const payload = {
      type: 'input_audio_buffer.append',
      audio: binaryData.toString('base64')
    };

    openAiSocket.send(JSON.stringify(payload));
  });

  socket.on('close', () => {
    logger.info('Client disconnected');
    clientSocket = null;
  });
});
