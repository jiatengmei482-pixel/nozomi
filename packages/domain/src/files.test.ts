import assert from "node:assert/strict";
import { test } from "node:test";
import { detectFileType, detectFileTypeAmong } from "./files.ts";

const bytes = (...parts: (number | string)[]): Uint8Array => new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...Buffer.from(part)] : [part])));

test("按开头的字节认格式：PDF、JPEG、PNG、WebP、HEIC；别的和太短的都不认", () => {
  assert.equal(detectFileType(bytes("%PDF-1.7\n")), "application/pdf");
  assert.equal(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(detectFileType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0)), "image/png");
  assert.equal(detectFileType(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")), "image/webp");
  assert.equal(detectFileType(bytes(0, 0, 0, 24, "ftypheic", 0, 0)), "image/heic");
  assert.equal(detectFileType(bytes(0, 0, 0, 24, "ftypisom", 0, 0)), null);
  for (const other of [bytes("GIF89a"), bytes("<svg xmlns"), bytes("%PDF"), bytes(0xff, 0xd8), new Uint8Array()]) assert.equal(detectFileType(other), null);
});

test("只认调用方收的那几种：资质不收 WebP，照片不收 PDF", () => {
  assert.equal(detectFileTypeAmong(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "), ["application/pdf", "image/jpeg", "image/png"]), null);
  assert.equal(detectFileTypeAmong(bytes("%PDF-1.7"), ["image/jpeg", "image/png", "image/webp", "image/heic"]), null);
  assert.equal(detectFileTypeAmong(bytes(0xff, 0xd8, 0xff), ["application/pdf", "image/jpeg"]), "image/jpeg");
});
