import assert from "node:assert/strict";
import test from "node:test";
import { pcm16ToFloat } from "../../ai/server/transcribe.server.ts";
import { phonesMatch } from "./prescreen.ts";

test("pcm16 round-trips a quiet sample", () => {
  const buf = Buffer.alloc(4);
  buf.writeInt16LE(16384, 0);
  buf.writeInt16LE(-16384, 2);
  const audio = pcm16ToFloat(buf.toString("base64"));
  assert.equal(audio.length, 2);
  assert.ok(Math.abs(audio[0]! - 0.5) < 0.01);
  assert.ok(Math.abs(audio[1]! + 0.5) < 0.01);
});

test("indian mobile numbers match with or without country code", () => {
  assert.equal(phonesMatch("+91 98765 43210", "9876543210"), true);
  assert.equal(phonesMatch("9876543210", "9123456789"), false);
});
