/**
 * Local speech-to-text. Model: Xenova/whisper-base (multilingual, quantized).
 * Runs on this server. No paid speech API.
 */

const MODEL = "Xenova/whisper-base";

type Asr = (
  audio: Float32Array,
  opts: { language?: string; task: "transcribe"; return_timestamps: false },
) => Promise<{ text?: string; language?: string }>;

const g = globalThis as typeof globalThis & { __vettaAsr?: Promise<Asr> };

async function asr(): Promise<Asr> {
  if (!g.__vettaAsr) {
    g.__vettaAsr = (async () => {
      const { pipeline } = await import("@xenova/transformers");
      const pipe = await pipeline("automatic-speech-recognition", MODEL, { quantized: true });
      return pipe as unknown as Asr;
    })();
  }
  return g.__vettaAsr;
}

/** 16 kHz mono PCM, int16 little-endian, base64. */
export function pcm16ToFloat(base64: string): Float32Array {
  const bytes = Buffer.from(base64, "base64");
  const n = Math.floor(bytes.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const v = bytes.readInt16LE(i * 2);
    out[i] = v / 32768;
  }
  return out;
}

export async function transcribePcm16(base64: string): Promise<{ text: string; lang: string | null; model: string }> {
  const audio = pcm16ToFloat(base64);
  if (audio.length < 16000 * 0.4) throw new Error("That clip is too short. Hold the button a little longer, or type.");
  if (audio.length > 16000 * 90) throw new Error("Keep a voice note under 90 seconds.");
  const run = await asr();
  const result = await run(audio, { task: "transcribe", return_timestamps: false });
  const text = String(result.text || "").trim();
  if (text.length < 2) throw new Error("Could not hear an answer. Try again, or type it.");
  return { text, lang: result.language ? String(result.language) : null, model: MODEL };
}
