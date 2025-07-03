<template>
  <div>
    <h2>WebSocket Transcription Client</h2>
    <h2>Status: {{ state }}</h2>
    <div>
      <button :disabled="state !== 'CONNECTED'">
        {{ isRecording ? 'Stop Recording' : 'Start Recording' }}
      </button>
    </div>
    <div v-if="transcriptions.length > 0">
      <h3>Transcriptions:</h3>
      <div v-for="(transcription, index) in transcriptions" :key="index" class="transcription">
        <strong>{{ transcription.timestamp }}:</strong> {{ transcription.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { MicVAD } from "@ricky0123/vad-web"
import { PCMAudioStreamPlayer, WavAudioStreamPlayer } from './lib/audioStreamPlayer'

let socket: WebSocket
const state = ref<'CONNECTED' | 'DISCONNECTED' | 'ERROR'>('DISCONNECTED')
const isRecording = ref(false)
const transcriptions = ref<Array<{ timestamp: string, text: string }>>([])

let audioContext: AudioContext
let mediaStream: MediaStream
let workletNode: AudioWorkletNode
let playbackSource: AudioBufferSourceNode
const audioPlayer = new PCMAudioStreamPlayer();

const connectWebSocket = async () => {
  return new Promise((resolve, reject) => {
    socket = new WebSocket('ws://localhost:3000')
    socket.binaryType = "arraybuffer"

    socket.addEventListener('open', () => {
      console.log('WebSocket connected')
      state.value = 'CONNECTED'
      resolve(true)
    })

    socket.addEventListener('message', async (event) => {
      try {
        if (event.data?.constructor?.name == "ArrayBuffer") {
          audioPlayer.addPCMChunk(new Uint8Array(event.data))
          return;
        }
        const data = JSON.parse(event.data)
        switch (data.type) {
          case 'transcription':
            transcriptions.value.push({
              timestamp: new Date().toLocaleTimeString(),
              text: data.transcript
            })
            console.log('Received transcription:', data.transcript)
            break;
          case 'done':
            //audioPlayer.finalizeAudio()
            break;
        }
      } catch (error) {
        console.error('Error parsing message:', error)
      }
    })

    socket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error)
      state.value = 'ERROR'
      reject(error)
    })

    socket.addEventListener('close', () => {
      state.value = 'DISCONNECTED'
      isRecording.value = false
    })
  })
}

const setupAudioContext = async () => {
  audioContext = new window.AudioContext({ sampleRate: 24000 })

  playbackSource = audioContext.createBufferSource()
  playbackSource.connect(audioContext.destination)

  await audioContext.audioWorklet.addModule('/mic-processor.js')
}

const startMicCapture = async () => {
  if (!audioContext) {
    await setupAudioContext()
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: 24000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true
    }
  })

  const source = audioContext.createMediaStreamSource(mediaStream)
  workletNode = new AudioWorkletNode(audioContext, 'mic-processor')

  source.connect(workletNode)

  workletNode.port.onmessage = (event) => {
    const int16Buffer = event.data as ArrayBuffer
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(int16Buffer)))
    if (socket && socket.readyState === WebSocket.OPEN && isRecording.value) {
      socket.send(base64Audio)
    }
  }

  isRecording.value = true
  console.log('Started recording')
}

const stopMicCapture = () => {
  if (workletNode) {
    workletNode.disconnect()
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop())
  }

  isRecording.value = false
  console.log('Stopped recording')
}

const playAudio = async (buffer: Uint8Array) => {
  const audioBuffer = audioContext.createBuffer(
    1, // mono
    buffer.length,
    24000 // OpenAI expects 24kHz
  )

  const channelData = audioBuffer.getChannelData(0)
  for (let i = 0; i < buffer.length; i++) {
    channelData[i] = buffer[i] / 32768 // Convert Int16 → Float32 [-1, 1]
  }

  const source = audioContext.createBufferSource()
  source.buffer = audioBuffer
  source.connect(audioContext.destination)
  source.start()
}

const initSpeachDetection = async () => {
  const myvad = await MicVAD.new({
    onSpeechStart: () => startMicCapture()
    ,
    onSpeechEnd: () => stopMicCapture()
  })
  myvad.start();
}


onMounted(async () => {
  await connectWebSocket()
  await setupAudioContext()
  await initSpeachDetection()
})

onBeforeUnmount(() => {
  if (socket) socket.close()
  if (audioContext) audioContext.close()
  if (mediaStream) mediaStream.getTracks().forEach(track => track.stop())
})
</script>

<style scoped>
.transcription {
  margin: 10px 0;
  padding: 10px;
  background: #007bff;
  color: white;
  border-radius: 4px;
}

button {
  padding: 10px 20px;
  margin: 10px;
  border: none;
  border-radius: 4px;
  background: #007bff;
  color: white;
  cursor: pointer;
}

button:disabled {
  background: #ccc;
  cursor: not-allowed;
}
</style>
