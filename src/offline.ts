export interface OfflineState {
  status: "unavailable" | "preparing" | "ready" | "error";
  message: string;
  updateAvailable: boolean;
}

type OfflineReply = {
  type: "OFFLINE_STATUS";
  release: string;
  ready: boolean;
  missing?: string[];
  error?: string;
};

const listeners = new Set<(state: OfflineState) => void>();
let state: OfflineState = {
  status: "preparing",
  message: "Checking offline files…",
  updateAvailable: false,
};
let registration: ServiceWorkerRegistration | undefined;
let preparation: Promise<void> | undefined;
let eventsBound = false;
let refreshNumber = 0;
let updateApplied = false;

function publish(next: OfflineState): void {
  state = next;
  for (const listener of listeners) listener({ ...state });
}

function supportError(): string | undefined {
  if (typeof window === "undefined" || !window.isSecureContext) {
    return "Offline use requires HTTPS or localhost.";
  }
  if (!("serviceWorker" in navigator) || !("caches" in window)) {
    return "This browser does not support the storage needed for offline use.";
  }
  return undefined;
}

function workerUrl(): string {
  return new URL(
    "sw.js",
    new URL(import.meta.env.BASE_URL, window.location.origin),
  ).href;
}

function scopeUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

function activeController(): ServiceWorker | undefined {
  const controller = navigator.serviceWorker.controller;
  return controller?.scriptURL === workerUrl() ? controller : undefined;
}

function requestStatus(
  worker: ServiceWorker,
  type: "CHECK_READY" | "PREPARE",
): Promise<OfflineReply> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(
        new Error("The offline worker did not respond. Reload and try again."),
      );
    }, 20_000);
    channel.port1.onmessage = (event: MessageEvent<OfflineReply>) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.type === "OFFLINE_STATUS") resolve(event.data);
      else
        reject(new Error("The offline worker returned an invalid response."));
    };
    try {
      worker.postMessage({ type }, [channel.port2]);
    } catch (error) {
      window.clearTimeout(timeout);
      channel.port1.close();
      reject(error);
    }
  });
}

async function refresh(): Promise<void> {
  const current = ++refreshNumber;
  const unavailable = supportError();
  if (unavailable) {
    publish({
      status: "unavailable",
      message: unavailable,
      updateAvailable: false,
    });
    return;
  }
  const updateAvailable = !!registration?.waiting;
  const controller = activeController();
  if (!controller) {
    publish({
      status: "preparing",
      message: "Preparing this page for offline use…",
      updateAvailable,
    });
    return;
  }
  try {
    const reply = await requestStatus(controller, "CHECK_READY");
    if (current !== refreshNumber) return;
    if (!reply.ready) {
      publish({
        status: "error",
        message: reply.error
          ? `Offline files could not be checked: ${reply.error}`
          : `${reply.missing?.length ?? 0} offline file(s) are missing. Connect to the internet and prepare offline use again.`,
        updateAvailable,
      });
      return;
    }
    publish({
      status: "ready",
      message: updateApplied
        ? "Update installed. Reload when convenient to use the new version."
        : "Ready for offline use. Keep a backup of your inventory data.",
      updateAvailable,
    });
  } catch (error) {
    if (current !== refreshNumber) return;
    publish({
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Offline storage could not be checked.",
      updateAvailable,
    });
  }
}

function observeRegistration(next: ServiceWorkerRegistration): void {
  registration = next;
  next.addEventListener("updatefound", () => {
    const installing = next.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      void refresh();
    });
    void refresh();
  });
  void refresh();
}

function checkForUpdate(): void {
  if (registration?.active && navigator.onLine) {
    void registration.update().catch(() => {
      // The installed release remains usable when an update check is offline.
    });
  }
  void refresh();
}

function bindEvents(): void {
  if (eventsBound || supportError()) return;
  eventsBound = true;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    void refresh();
  });
  window.addEventListener("online", checkForUpdate);
  window.addEventListener("offline", () => {
    void refresh();
  });
  window.addEventListener("pageshow", checkForUpdate);
}

function waitForControl(): Promise<ServiceWorker> {
  const existing = activeController();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", check);
      reject(
        new Error(
          "Offline files were installed, but this page is not yet controlled. Reload to finish setup.",
        ),
      );
    }, 20_000);
    const check = () => {
      const controller = activeController();
      if (!controller) return;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("controllerchange", check);
      resolve(controller);
    };
    navigator.serviceWorker.addEventListener("controllerchange", check);
    check();
  });
}

function readyRegistration(): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(
        new Error(
          "Offline installation did not finish. Check the connection and available storage, then try again.",
        ),
      );
    }, 60_000);
    navigator.serviceWorker.ready.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

/** Install or repair this release's cache and report readiness to subscribers. */
export async function prepareOffline(): Promise<void> {
  const unavailable = supportError();
  if (unavailable) {
    publish({
      status: "unavailable",
      message: unavailable,
      updateAvailable: false,
    });
    throw new Error(unavailable);
  }
  if (preparation) return preparation;
  preparation = (async () => {
    publish({
      status: "preparing",
      message: "Preparing offline files…",
      updateAvailable: !!registration?.waiting,
    });
    try {
      bindEvents();
      if (!registration || !activeController()) {
        const existing =
          await navigator.serviceWorker.getRegistration(scopeUrl());
        const matching =
          existing?.scope === scopeUrl() &&
          [existing.active, existing.installing, existing.waiting].some(
            (worker) => worker?.scriptURL === workerUrl(),
          );
        const next = matching
          ? existing
          : await navigator.serviceWorker.register(workerUrl(), {
              scope: scopeUrl(),
              updateViaCache: "none",
            });
        if (next !== registration) observeRegistration(next);
      }
      await readyRegistration();
      const controller = await waitForControl();
      const reply = await requestStatus(controller, "PREPARE");
      if (!reply.ready)
        throw new Error(
          reply.error ||
            "Offline files could not be stored. Check available space and try again.",
        );
      await refresh();
      if (state.status !== "ready") throw new Error(state.message);
      checkForUpdate();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Offline files could not be prepared.";
      publish({
        status: "error",
        message,
        updateAvailable: !!registration?.waiting,
      });
      throw error;
    } finally {
      preparation = undefined;
    }
  })();
  return preparation;
}

/** Observe offline status; the returned function stops this observer. */
export async function startOffline(
  onChange: (state: OfflineState) => void,
): Promise<() => void> {
  listeners.add(onChange);
  onChange({ ...state });
  void prepareOffline().catch(() => {
    // prepareOffline publishes a readable failure state to observers.
  });
  return () => {
    listeners.delete(onChange);
  };
}

/** Activate an installed update only after the user chooses to apply it. */
export async function applyUpdate(): Promise<void> {
  const waiting = registration?.waiting;
  if (!waiting) throw new Error("No offline update is available.");
  const before = navigator.serviceWorker.controller;
  const changed = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", check);
      reject(new Error("The update did not activate. Reload and try again."));
    }, 20_000);
    const check = () => {
      if (navigator.serviceWorker.controller === before) return;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("controllerchange", check);
      resolve();
    };
    navigator.serviceWorker.addEventListener("controllerchange", check);
  });
  waiting.postMessage({ type: "ACTIVATE_UPDATE" });
  await changed;
  updateApplied = true;
  await refresh();
}

/** Ask the browser to reduce automatic eviction of this origin's local data. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return !!(await navigator.storage?.persist?.());
  } catch {
    return false;
  }
}
