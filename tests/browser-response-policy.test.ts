import assert from "node:assert/strict";
import test from "node:test";
import {
  isExpectedHistoricalClipMiss,
  isExpectedHistoricalOcrCropMiss,
  isExpectedRetainedMediaMiss,
} from "../src/browser.js";

const baseUrl = "https://example.invalid";

test("accepts only an exact same-origin retained-media GET 404", () => {
  assert.equal(isExpectedRetainedMediaMiss(
    baseUrl,
    "GET",
    404,
    "https://example.invalid/sensorhub/buckets/videos/media/0jss260",
  ), true);
  assert.equal(isExpectedRetainedMediaMiss(
    baseUrl,
    "GET",
    404,
    "https://example.invalid/sensorhub/buckets/videos/media/node-0.15303634153679013",
  ), true);
});

test("does not suppress failures outside the retained-media fallback contract", () => {
  const exactUrl = "https://example.invalid/sensorhub/buckets/videos/media/0jss260";
  assert.equal(isExpectedRetainedMediaMiss(baseUrl, "POST", 404, exactUrl), false);
  assert.equal(isExpectedRetainedMediaMiss(baseUrl, "GET", 500, exactUrl), false);
  assert.equal(isExpectedRetainedMediaMiss(baseUrl, "GET", 404, `${exactUrl}?probe=true`), false);
  assert.equal(isExpectedRetainedMediaMiss(baseUrl, "GET", 404, `${exactUrl}/frame-0.jpg`), false);
  assert.equal(isExpectedRetainedMediaMiss(baseUrl, "GET", 404,
    "https://other.test/sensorhub/buckets/videos/media/0jss260"), false);
  assert.equal(isExpectedRetainedMediaMiss(baseUrl, "GET", 404,
    "https://example.invalid/sensorhub/buckets/videos/media/%2e%2e%2fadmin"), false);
  assert.equal(isExpectedRetainedMediaMiss(baseUrl, "GET", 404,
    "https://example.invalid/sensorhub/buckets/videos/media/"), false);
});

test("accepts only scoped historical clip GET 404 matching the active date key", () => {
  const activeDates = new Set(["2026-10-26"]);
  const clipUrl = "https://example.invalid/sensorhub/buckets/videos/clips/urn-osh-sensor-ffmpeg-lane-lane-02-0/2026-10-26_01-43-05_530-g1.mp4";
  assert.equal(isExpectedHistoricalClipMiss(baseUrl, "GET", 404, clipUrl, activeDates), true);
  assert.equal(isExpectedHistoricalClipMiss(baseUrl, "GET", 404, clipUrl, new Set()), false);
  assert.equal(isExpectedHistoricalClipMiss(baseUrl, "GET", 404, clipUrl, new Set(["2026-11-18"])), false);
  assert.equal(isExpectedHistoricalClipMiss(baseUrl, "POST", 404, clipUrl, activeDates), false);
  assert.equal(isExpectedHistoricalClipMiss(baseUrl, "GET", 500, clipUrl, activeDates), false);
  assert.equal(isExpectedHistoricalClipMiss("https://other.local", "GET", 404, clipUrl, activeDates), false);
});

test("accepts only prior-day OCR crop GET 404 fallback probes while failing closed on current-day crops", () => {
  const priorCrop = `${baseUrl}/sensorhub/buckets/ocr/crops/2026-11-23/obs-MGphcnAxdDAwNA_d205d1c2-3615-40f9-a3e8-c03e9df670f5.jpg`;
  const todayCrop = `${baseUrl}/sensorhub/buckets/ocr/crops/2026-11-24/obs-MGphcnAxdDAwNA_d205d1c2-3615-40f9-a3e8-c03e9df670f5.jpg`;
  assert.equal(isExpectedHistoricalOcrCropMiss(baseUrl, "GET", 404, priorCrop, "2026-11-24"), true);
  assert.equal(isExpectedHistoricalOcrCropMiss(baseUrl, "GET", 404, todayCrop, "2026-11-24"), false);
  assert.equal(isExpectedHistoricalOcrCropMiss(baseUrl, "POST", 404, priorCrop, "2026-11-24"), false);
  assert.equal(isExpectedHistoricalOcrCropMiss(baseUrl, "GET", 500, priorCrop, "2026-11-24"), false);
  assert.equal(isExpectedHistoricalOcrCropMiss(baseUrl, "GET", 404, `${priorCrop}?x=1`, "2026-11-24"), false);
  assert.equal(isExpectedHistoricalOcrCropMiss("https://other.test", "GET", 404, priorCrop, "2026-11-24"), false);
});
