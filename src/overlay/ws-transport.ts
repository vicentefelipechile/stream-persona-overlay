// =========================================================================================================
// WebSocket Transport (OBS Browser Source)
// =========================================================================================================
// Thin client that connects to ws://localhost:6767/ws and mirrors the Tauri
// API surface so overlay modules work unchanged in a plain browser context.
//
// Exports:
//   wsListen(event, handler)  — equivalent to listen() from @tauri-apps/api/event
//   wsInvoke(command, args)   — equivalent to invoke() from @tauri-apps/api/core
//   browserConvertFileSrc(p)  — equivalent to convertFileSrc() from @tauri-apps/api/core
// =========================================================================================================

const WS_URL    = "ws://localhost:6767/ws";
const HTTP_BASE = "http://localhost:6767";

// =========================================================================================================
// Connection
// =========================================================================================================

type RawHandler = (payload: unknown) => void;

const eventHandlers = new Map<string, Set<RawHandler>>();
const pendingInvocations = new Map<string, {
  resolve: (v: unknown) => void;
  reject:  (e: unknown) => void;
}>();

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    socket = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  socket.onmessage = (ev: MessageEvent) => {
    let msg: { event?: string; payload?: unknown; id?: string; result?: unknown; error?: string };
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }

    if (msg.event) {
      // Broadcast event from server -> notify all registered handlers
      const handlers = eventHandlers.get(msg.event);
      if (handlers) {
        for (const h of handlers) h(msg.payload);
      }
    } else if (msg.id) {
      // Response to a wsInvoke call
      const pending = pendingInvocations.get(msg.id);
      if (pending) {
        pendingInvocations.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error));
        else           pending.resolve(msg.result);
      }
    }
  };

  socket.onclose = () => {
    socket = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    // onclose fires after onerror; reconnect logic lives there
  };
}

function scheduleReconnect(): void {
  if (!reconnectTimer) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 1500);
  }
}

// Start connection immediately when the module loads
connect();

// =========================================================================================================
// Public API
// =========================================================================================================

/**
 * Register a handler for a named event broadcast by the server.
 * Returns a Promise<unlisten> to match Tauri's listen() signature exactly,
 * allowing PetManager and other modules to use it without modification.
 */
export function wsListen<T>(
  event:   string,
  handler: (e: { payload: T }) => void,
): Promise<() => void> {
  if (!eventHandlers.has(event)) eventHandlers.set(event, new Set());

  const wrapped: RawHandler = (payload) => handler({ payload: payload as T });
  eventHandlers.get(event)!.add(wrapped);

  const unlisten = () => eventHandlers.get(event)?.delete(wrapped);
  return Promise.resolve(unlisten);
}

/**
 * Send a command to the server and await the response.
 * Mirrors invoke() from @tauri-apps/api/core.
 */
export function wsInvoke<T>(
  command: string,
  args?:   Record<string, unknown>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id  = crypto.randomUUID();
    const msg = JSON.stringify({ id, command, args });

    pendingInvocations.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
    });

    const send = () => socket?.send(msg);

    if (socket && socket.readyState === WebSocket.OPEN) {
      send();
    } else {
      // Retry once the socket connects; reject after 5 s if it never does
      const deadline = setTimeout(() => {
        pendingInvocations.delete(id);
        reject(new Error(`wsInvoke("${command}") timed out — socket not connected`));
      }, 5000);

      const onOpen = () => {
        clearTimeout(deadline);
        send();
        socket?.removeEventListener("open", onOpen);
      };

      if (socket) {
        socket.addEventListener("open", onOpen);
      } else {
        pendingInvocations.delete(id);
        reject(new Error(`wsInvoke("${command}") failed — socket not available`));
      }
    }
  });
}

/**
 * Convert an absolute OS filesystem path to an HTTP URL served by the axum server.
 * Mirrors convertFileSrc() from @tauri-apps/api/core.
 */
export function browserConvertFileSrc(path: string): string {
  return `${HTTP_BASE}/persona?path=${encodeURIComponent(path)}`;
}
