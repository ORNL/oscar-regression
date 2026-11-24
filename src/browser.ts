import {join} from "node:path";
import {chromium, type Browser, type BrowserContext, type Page} from "playwright";
import type {SuiteConfig} from "./types.js";
import {RunReporter} from "./reporter.js";
import {safeName} from "./util.js";
import {
  createAlarmTransferCameraFixture,
  type AlarmTransferCameraFixture,
  type AlarmTransferCameraState,
} from "./alarm-transfer-camera-fixture.js";

export function isExpectedRetainedMediaMiss(
  baseUrl: string,
  method: string,
  status: number,
  responseUrl: string,
): boolean {
  if (method !== "GET" || status !== 404) return false;
  try {
    const expectedOrigin = new URL(baseUrl).origin;
    const response = new URL(responseUrl);
    if (response.origin !== expectedOrigin || response.search !== "" || response.hash !== "") return false;
    const pathname = decodeURIComponent(response.pathname);
    return /^\/sensorhub\/buckets\/videos\/media\/[A-Za-z0-9][A-Za-z0-9._~-]{0,255}$/.test(pathname);
  } catch {
    return false;
  }
}

export function isExpectedHistoricalClipMiss(
  baseUrl: string,
  method: string,
  status: number,
  responseUrl: string,
  expectedClipDates: ReadonlySet<string>,
): boolean {
  if (method !== "GET" || status !== 404 || expectedClipDates.size === 0) return false;
  try {
    const expectedOrigin = new URL(baseUrl).origin;
    const response = new URL(responseUrl);
    if (response.origin !== expectedOrigin || response.hash !== "") return false;
    const pathname = decodeURIComponent(response.pathname);
    const match = /^\/sensorhub\/buckets\/videos\/clips\/[A-Za-z0-9._~-]+\/(\d{4}-\d{2}-\d{2})_[0-9A-Za-z._-]+\.mp4$/i.exec(
      pathname,
    );
    return Boolean(match?.[1] && expectedClipDates.has(match[1]));
  } catch {
    return false;
  }
}

export function isExpectedHistoricalOcrCropMiss(
  baseUrl: string,
  method: string,
  status: number,
  responseUrl: string,
  currentUtcDate = new Date().toISOString().slice(0, 10),
): boolean {
  if (method !== "GET" || status !== 404) return false;
  try {
    const expectedOrigin = new URL(baseUrl).origin;
    const response = new URL(responseUrl);
    if (response.origin !== expectedOrigin || response.search !== "" || response.hash !== "") return false;
    const pathname = decodeURIComponent(response.pathname);
    const match = /^\/sensorhub\/buckets\/ocr\/crops\/(\d{4}-\d{2}-\d{2})\/obs-[A-Za-z0-9_-]{1,160}\.jpg$/.exec(
      pathname,
    );
    return Boolean(match?.[1] && match[1] < currentUtcDate);
  } catch {
    return false;
  }
}

export class BrowserHarness {
  private browser: Browser | undefined;
  private oscarContext: BrowserContext | undefined;
  private emulatorContext: BrowserContext | undefined;
  private scenario = "browser";
  private readonly expectedMissingObservationIds = new Set<string>();
  private readonly expectedHistoricalClipDates = new Set<string>();
  private alarmTransferCameraFixtureValue: AlarmTransferCameraFixture | undefined;

  constructor(private readonly config: SuiteConfig, private readonly reporter: RunReporter) {}

  setScenario(scenario: string): void {
    this.scenario = scenario;
  }

  async start(): Promise<void> {
    const cameraScenarioSelected = this.config.scenarioFilter.size === 0 ||
      this.config.scenarioFilter.has("alarm-transfer-camera");
    if (this.config.alarmTransferCameraWorkflow !== "disabled" && cameraScenarioSelected) {
      this.alarmTransferCameraFixtureValue = createAlarmTransferCameraFixture();
    }
    this.browser = await chromium.launch({
      headless: this.config.headless,
      ...(this.config.browserExecutablePath
        ? {executablePath: this.config.browserExecutablePath}
        : {}),
    });
    this.oscarContext = await this.browser.newContext({
      ignoreHTTPSErrors: true,
      httpCredentials: {
        username: this.config.oscarUsername,
        password: this.config.oscarPassword,
      },
      acceptDownloads: true,
      viewport: {width: 1600, height: 1000},
      locale: "en-US",
    });
    this.emulatorContext = await this.browser.newContext({
      viewport: {width: 1600, height: 1000},
      locale: "en-US",
    });
    this.oscarContext.setDefaultTimeout(this.config.uiTimeoutMs);
    this.oscarContext.setDefaultNavigationTimeout(this.config.uiTimeoutMs);
    this.emulatorContext.setDefaultTimeout(this.config.uiTimeoutMs);
    if (this.alarmTransferCameraFixtureValue) {
      await this.installAlarmTransferCamera(this.oscarContext, this.alarmTransferCameraFixtureValue);
    }
    this.attachContext(this.oscarContext, "viewer");
    this.attachContext(this.emulatorContext, "emulator");
    await this.authenticateOscar();
  }

  private async installAlarmTransferCamera(
    context: BrowserContext,
    fixture: AlarmTransferCameraFixture,
  ): Promise<void> {
    const serializedFixture = JSON.stringify({
      qrModules: fixture.qrModules,
      qrSize: fixture.qrSize,
      frameWidth: fixture.frameWidth,
      frameHeight: fixture.frameHeight,
      quietZoneModules: fixture.quietZoneModules,
      pixelsPerModule: fixture.pixelsPerModule,
    });
    // Source text avoids helper references that tsx can add when serializing a
    // callback with nested functions into the browser realm.
    await context.addInitScript({content: `(() => {
      "use strict";
      const fixture = ${serializedFixture};
      const state = {
        requestCount: 0,
        rejectedRequestCount: 0,
        createdTrackCount: 0,
        stoppedTrackCount: 0,
        activeTrackCount: 0,
        previewFrameRendered: false,
        qrFrameRendered: false,
        requestedFrameCount: 0,
        lastConstraints: null,
        rejectRequests: false,
      };
      Object.defineProperty(globalThis, "__oscarAlarmTransferCamera", {
        configurable: true,
        enumerable: false,
        value: state,
      });

      const enumerateDevices = async () => [{
        deviceId: "oscar-alarm-transfer-camera",
        groupId: "oscar-regression",
        kind: "videoinput",
        label: "OSCAR deterministic QR camera",
        toJSON: () => ({
          deviceId: "oscar-alarm-transfer-camera",
          groupId: "oscar-regression",
          kind: "videoinput",
          label: "OSCAR deterministic QR camera",
        }),
      }];

      const getUserMedia = async constraints => {
        state.requestCount++;
        state.lastConstraints = JSON.parse(JSON.stringify(constraints ?? null));
        if (state.rejectRequests) {
          state.rejectedRequestCount++;
          throw new DOMException(
            "Permission denied by the OSCAR deterministic camera fixture",
            "NotAllowedError",
          );
        }

        const width = fixture.frameWidth;
        const height = fixture.frameHeight;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const drawing = canvas.getContext("2d", {alpha: false});
        if (!drawing) throw new Error("Could not create the deterministic camera canvas");
        drawing.fillStyle = "#d8d8d8";
        drawing.fillRect(0, 0, width, height);
        drawing.fillStyle = "#b0b0b0";
        for (let x = 0; x < width; x += 32) drawing.fillRect(x, 0, 16, height);
        state.previewFrameRendered = true;

        const stream = canvas.captureStream(10);
        const videoTracks = stream.getVideoTracks();
        for (const track of videoTracks) {
          state.createdTrackCount++;
          state.activeTrackCount++;
          const originalGetSettings = track.getSettings.bind(track);
          Object.defineProperty(track, "label", {
            configurable: true,
            value: "OSCAR deterministic QR camera",
          });
          Object.defineProperty(track, "getSettings", {
            configurable: true,
            value: () => ({
              ...originalGetSettings(),
              deviceId: "oscar-alarm-transfer-camera",
              frameRate: 10,
              height,
              width,
            }),
          });
          const originalStop = track.stop.bind(track);
          let stopped = false;
          Object.defineProperty(track, "stop", {
            configurable: true,
            value: () => {
              if (!stopped) {
                stopped = true;
                state.stoppedTrackCount++;
                state.activeTrackCount = Math.max(0, state.activeTrackCount - 1);
              }
              originalStop();
            },
          });
        }

        state.renderQrFrame = () => {
          const quietZone = fixture.quietZoneModules;
          const scale = fixture.pixelsPerModule;
          const symbolSize = (fixture.qrSize + quietZone * 2) * scale;
          const left = Math.floor((width - symbolSize) / 2);
          const top = Math.floor((height - symbolSize) / 2);
          drawing.fillStyle = "#ffffff";
          drawing.fillRect(0, 0, width, height);
          drawing.fillStyle = "#000000";
          for (let row = 0; row < fixture.qrSize; row++) {
            for (let column = 0; column < fixture.qrSize; column++) {
              if (fixture.qrModules[row * fixture.qrSize + column]) {
                drawing.fillRect(
                  left + (column + quietZone) * scale,
                  top + (row + quietZone) * scale,
                  scale,
                  scale,
                );
              }
            }
          }
          state.qrFrameRendered = true;
          for (const track of videoTracks) {
            if (typeof track.requestFrame === "function") {
              track.requestFrame();
              state.requestedFrameCount++;
            }
          }
        };
        return stream;
      };

      const mediaDeviceEvents = new EventTarget();
      const deterministicMediaDevices = {
        ondevicechange: null,
        enumerateDevices,
        getUserMedia,
        getSupportedConstraints: () => ({
          deviceId: true,
          facingMode: true,
          frameRate: true,
          height: true,
          width: true,
        }),
        addEventListener: mediaDeviceEvents.addEventListener.bind(mediaDeviceEvents),
        removeEventListener: mediaDeviceEvents.removeEventListener.bind(mediaDeviceEvents),
        dispatchEvent: mediaDeviceEvents.dispatchEvent.bind(mediaDeviceEvents),
      };
      // The init script can run before Chromium exposes the native MediaDevices
      // object. Installing the complete test facade on Navigator avoids that
      // document-start race and keeps every scanner request deterministic.
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: deterministicMediaDevices,
      });

      const permissionEvents = new EventTarget();
      const cameraPermissionStatus = {
        get state() {
          return state.rejectRequests ? "denied" : "granted";
        },
        onchange: null,
        addEventListener: permissionEvents.addEventListener.bind(permissionEvents),
        removeEventListener: permissionEvents.removeEventListener.bind(permissionEvents),
        dispatchEvent: permissionEvents.dispatchEvent.bind(permissionEvents),
      };
      const nativePermissions = navigator.permissions;
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: {
          query: async descriptor => descriptor?.name === "camera"
            ? cameraPermissionStatus
            : nativePermissions?.query
              ? nativePermissions.query(descriptor)
              : {
                  ...cameraPermissionStatus,
                  state: "prompt",
                },
        },
      });
    })();
    //# sourceURL=oscar-alarm-transfer-camera-fixture.js`});
  }

  private async authenticateOscar(): Promise<void> {
    if (!this.oscarContext) throw new Error("OSCAR browser context is unavailable");
    const page = await this.oscarContext.newPage();
    try {
      await page.goto(this.config.oscarBaseUrl, {waitUntil: "domcontentloaded"});
      const username = page.getByLabel("Username");
      if (await username.isVisible().catch(() => false)) {
        await username.fill(this.config.oscarUsername);
        await page.getByLabel("Password").fill(this.config.oscarPassword);
        await Promise.all([
          page.waitForURL((url) => !url.pathname.startsWith("/login"), {timeout: this.config.uiTimeoutMs}),
          page.getByRole("button", {name: "Sign in", exact: true}).click(),
        ]);
      }
      const response = await this.oscarContext.request.get(`${this.config.oscarBaseUrl}/session`);
      if (!response.ok()) throw new Error(`OSCAR session verification returned ${response.status()}`);
      const session = await response.json() as {username?: string};
      if (session.username !== this.config.oscarUsername) {
        throw new Error(`OSCAR session belongs to ${session.username ?? "an unknown user"}`);
      }
    } finally {
      await page.close();
    }
  }

  async sessionUsername(): Promise<string> {
    if (!this.oscarContext) throw new Error("Browser harness is not started");
    const response = await this.oscarContext.request.get(`${this.config.oscarBaseUrl}/session`);
    if (!response.ok()) throw new Error(`OSCAR session endpoint returned ${response.status()}`);
    const session = await response.json() as {username?: string};
    return session.username ?? "";
  }

  private attachContext(context: BrowserContext, source: string): void {
    context.on("page", (page) => this.attachPage(page, source));
  }

  private attachPage(page: Page, source: string): void {
    page.on("pageerror", (error) => this.reporter.error(this.scenario, `${source}-page`, error));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      const expectedHeadlessNoise = [
        "An SSL certificate error occurred when fetching the script",
        "Service Worker registration failed: SecurityError",
        "Failed to load resource: the server responded with a status of 404",
        "MUI X: useResizeContainer",
      ].some((fragment) => text.includes(fragment));
      const expectedMissingObservation = this.expectedMissingObservationIds.size > 0 &&
        text.includes("Unable to resolve event by occupancy observation ID");
      if (!expectedHeadlessNoise && !expectedMissingObservation)
        this.reporter.error(this.scenario, `${source}-console`, text, "", "warning");
    });
    page.on("response", (response) => {
      if (response.status() === 404) {
        const url = response.url();
        const expectedPreparingRequest = /(?:\.m3u8|\/hls\/|\/sw\.js(?:\?|$)|\/favicon\.ico(?:\?|$))/i.test(url);
        // The Viewer first probes the retained-frame manifest and deliberately
        // falls back to the legacy MP4 when an event has not been compacted.
        // Suppress only that exact, same-origin GET miss; other 404s remain
        // regression errors and every 5xx remains an error below.
        const expectedRetainedMediaMiss = isExpectedRetainedMediaMiss(
          this.config.oscarBaseUrl,
          response.request().method(),
          response.status(),
          url,
        );
        const expectedMissingObservation = [...this.expectedMissingObservationIds].some((observationId) => {
          try {
            return decodeURIComponent(new URL(url).pathname)
              .endsWith(`/observations/${observationId}`);
          } catch {
            return false;
          }
        });
        const expectedHistoricalClipMiss = isExpectedHistoricalClipMiss(
          this.config.oscarBaseUrl,
          response.request().method(),
          response.status(),
          url,
          this.expectedHistoricalClipDates,
        );
        const expectedHistoricalOcrCropMiss = isExpectedHistoricalOcrCropMiss(
          this.config.oscarBaseUrl,
          response.request().method(),
          response.status(),
          url,
        );
        if (!expectedPreparingRequest && !expectedRetainedMediaMiss &&
            !expectedMissingObservation && !expectedHistoricalClipMiss &&
            !expectedHistoricalOcrCropMiss) {
          this.reporter.error(
            this.scenario,
            `${source}-http`,
            `404 ${response.request().method()} ${url}`,
          );
        }
      }
      if (response.status() >= 500) {
        this.reporter.error(
          this.scenario,
          `${source}-http`,
          `${response.status()} ${response.request().method()} ${response.url()}`,
          "",
          "warning",
        );
      }
    });
    page.on("requestfailed", (request) => {
      const reason = request.failure()?.errorText ?? "request failed";
      if (reason.includes("ERR_ABORTED")) return;
      this.reporter.error(
        this.scenario,
        `${source}-network`,
        `${request.method()} ${request.url()}: ${reason}`,
        "",
        "warning",
      );
    });
  }

  async oscarPage(): Promise<Page> {
    if (!this.oscarContext) throw new Error("Browser harness is not started");
    const page = await this.oscarContext.newPage();
    return page;
  }

  async emulatorPage(): Promise<Page> {
    if (!this.emulatorContext) throw new Error("Browser harness is not started");
    const page = await this.emulatorContext.newPage();
    return page;
  }

  async unauthenticatedOscarGet(path: string): Promise<{status: number; cacheControl: string}> {
    if (!this.browser) throw new Error("Browser harness is not started");
    const context = await this.browser.newContext({ignoreHTTPSErrors: true});
    try {
      const response = await context.request.get(
        new URL(path, `${this.config.oscarBaseUrl}/`).toString(),
        {maxRedirects: 0},
      );
      try {
        return {
          status: response.status(),
          cacheControl: response.headers()["cache-control"] ?? "",
        };
      } finally {
        await response.dispose();
      }
    } finally {
      await context.close();
    }
  }

  alarmTransferCameraFixture(): AlarmTransferCameraFixture | undefined {
    return this.alarmTransferCameraFixtureValue;
  }

  async assertAlarmTransferCameraFacade(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const state = (globalThis as typeof globalThis & {
        __oscarAlarmTransferCamera?: AlarmTransferCameraState;
      }).__oscarAlarmTransferCamera;
      if (!state) throw new Error("Deterministic Alarm Transfer camera state is unavailable");
      const videoDevices = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === "videoinput");
      if (videoDevices.length !== 1 || videoDevices[0]?.deviceId !== "oscar-alarm-transfer-camera") {
        throw new Error("Deterministic Alarm Transfer camera facade is not exclusively active");
      }
    });
  }

  async alarmTransferCameraState(page: Page): Promise<AlarmTransferCameraState> {
    return page.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        __oscarAlarmTransferCamera?: AlarmTransferCameraState;
      }).__oscarAlarmTransferCamera;
      if (!state) throw new Error("Deterministic Alarm Transfer camera state is unavailable");
      return {
        requestCount: state.requestCount,
        rejectedRequestCount: state.rejectedRequestCount,
        createdTrackCount: state.createdTrackCount,
        stoppedTrackCount: state.stoppedTrackCount,
        activeTrackCount: state.activeTrackCount,
        previewFrameRendered: state.previewFrameRendered,
        qrFrameRendered: state.qrFrameRendered,
        requestedFrameCount: state.requestedFrameCount,
        lastConstraints: state.lastConstraints,
      };
    });
  }

  async rejectAlarmTransferCameraRequests(page: Page): Promise<void> {
    await page.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        __oscarAlarmTransferCamera?: AlarmTransferCameraState & {rejectRequests: boolean};
      }).__oscarAlarmTransferCamera;
      if (!state) throw new Error("Deterministic Alarm Transfer camera state is unavailable");
      state.rejectRequests = true;
    });
  }

  async allowAlarmTransferCameraRequests(page: Page): Promise<void> {
    await page.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        __oscarAlarmTransferCamera?: AlarmTransferCameraState & {rejectRequests: boolean};
      }).__oscarAlarmTransferCamera;
      if (!state) throw new Error("Deterministic Alarm Transfer camera state is unavailable");
      state.rejectRequests = false;
    });
  }

  async renderAlarmTransferCameraQr(page: Page): Promise<void> {
    await page.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        __oscarAlarmTransferCamera?: AlarmTransferCameraState & {renderQrFrame?: () => void};
      }).__oscarAlarmTransferCamera;
      if (!state?.renderQrFrame) throw new Error("Deterministic camera preview has not started");
      state.renderQrFrame();
    });
  }

  async withExpectedMissingObservation<T>(observationId: string, operation: () => Promise<T>): Promise<T> {
    this.expectedMissingObservationIds.add(observationId);
    try {
      return await operation();
    } finally {
      this.expectedMissingObservationIds.delete(observationId);
    }
  }

  async withExpectedHistoricalClipDate<T>(isoTimestamp: string, operation: () => Promise<T>): Promise<T> {
    const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(isoTimestamp.trim());
    const dateKey = dateMatch?.[1] ?? "";
    if (!dateKey) return operation();
    this.expectedHistoricalClipDates.add(dateKey);
    try {
      return await operation();
    } finally {
      this.expectedHistoricalClipDates.delete(dateKey);
    }
  }

  async screenshot(page: Page, label: string): Promise<string> {
    const relative = join("evidence", `${safeName(label)}.png`);
    await page.screenshot({path: join(this.reporter.outputDir, relative), fullPage: true});
    return relative;
  }

  async stop(): Promise<void> {
    await this.oscarContext?.close().catch(() => undefined);
    await this.emulatorContext?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
  }
}
