// Deepgram Agent realtime protocol types (server boundary only).
//
// This file types the documented Deepgram Agent WebSocket surface
// (https://developers.deepgram.com/docs/voice-agent-settings) that the Deepgram
// provider in provider.ts speaks. The browser never sees any of this: the local
// protocol in shared/realtime.ts is unchanged. Credentials are never part of a
// Deepgram Agent message on this wire (they ride the WS upgrade Authorization
// header), so no secret lives here by construction.
//
// Selected configuration (hackathon demo): en / linear16 24 kHz in/out,
// listen `flux-general-en` (v2 required for flux), think Google
// `gemini-3.1-flash-lite`, speak `flux-kit-en` (v2).

/** Deepgram Agent WebSocket endpoint (auth via `Authorization: Token <key>` header). */
export const DEEPGRAM_ENDPOINT = 'wss://agent.deepgram.com/v1/agent/converse';

/** The four model knobs the relay's `Settings` payload is built from. */
export interface DeepgramModelSpec {
  listenModel: string;
  speakModel: string;
  llmProvider: string;
  llmModel: string;
}

export interface DeepgramAudioCodec {
  encoding: 'linear16';
  sample_rate: number;
  container?: 'none';
}

/** `Settings` — sent by the client immediately after the server's `Welcome`. */
export interface DeepgramSettingsMessage {
  type: 'Settings';
  audio: { input: DeepgramAudioCodec; output: DeepgramAudioCodec };
  agent: {
    language: string;
    listen: { provider: { type: 'deepgram'; version: 'v2'; model: string } };
    think: { provider: { type: string; model: string }; prompt: string };
    speak: { provider: { type: 'deepgram'; version: 'v2'; model: string } };
  };
}

/** Client -> server JSON commands on the Agent socket. */
export type DeepgramClientCommand =
  | DeepgramSettingsMessage
  | { type: 'KeepAlive' }
  | { type: 'ForceEndTurn' }
  | { type: 'Close' };

/**
 * Server -> client events the relay understands. `AudioFrame` is produced by
 * the provider when the Agent socket delivers a binary frame (output audio);
 * the JSON events are produced by parseDeepgramEvent.
 */
export type DeepgramServerEvent =
  | { type: 'Welcome'; requestId?: string }
  | { type: 'SettingsApplied' }
  | { type: 'ConversationText'; role: 'user' | 'assistant'; content: string }
  | { type: 'UserStartedSpeaking' }
  | { type: 'AgentThinking' }
  | { type: 'AgentAudioDone' }
  | { type: 'Error'; code: string; description: string }
  | { type: 'Warning'; code: string; description: string }
  | { type: 'AudioFrame'; data: Uint8Array };