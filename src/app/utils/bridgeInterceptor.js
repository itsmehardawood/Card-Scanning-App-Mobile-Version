/**
 * Bridge Interceptor
 *
 * Goal: Prevent native layer (Android/iOS) from receiving the scan-complete
 * payload until voice verification is finished, without changing native code.
 *
 * How it works:
 * - Wraps window.webkit.messageHandlers.ScanBridge.postMessage (iOS-style bridge)
 * - Buffers any message whose JSON contains { complete_scan: true } while voice verification is pending
 * - After voice success, call releasePendingBridgeMessage() to forward the buffered payload to native
 *
 * Notes:
 * - Safe to initialize multiple times; installs once and watches for late-injected bridges
 * - If Android uses a different bridge, this won’t harm anything; it simply no-ops
 */

let originalPostMessage = null;
let pendingBridgePayload = null;
let installed = false;
let watcherTimer = null;

function isScanCompletePayload(msg) {
  try {
    const json = typeof msg === 'string' ? JSON.parse(msg) : msg;
    return json && json.complete_scan === true;
  } catch {
    return false;
  }
}

function wrapBridge() {
  // Already wrapped
  if (installed) return;

  // Check existence of iOS-style bridge
  const webkitObj = typeof window !== 'undefined' && window.webkit;
  const handler = webkitObj?.messageHandlers?.ScanBridge;
  const post = handler?.postMessage;

  if (!post || typeof post !== 'function') return; // Not available yet

  // Preserve original
  originalPostMessage = post.bind(handler);

  // Install wrapper
  handler.postMessage = function (message) {
    try {
      if (isScanCompletePayload(message) && window.__VOICE_VERIFICATION_PENDING__ === true) {
        // Buffer and suppress
        pendingBridgePayload = message;
        console.log('[BridgeInterceptor] Buffered scan-complete payload until voice verification finishes');
        return; // Do not forward to native yet
      }
    } catch (e) {
      // Fallthrough to forwarding
      console.warn('[BridgeInterceptor] Error inspecting payload, forwarding anyway:', e?.message);
    }

    // Forward immediately for all other messages
    try {
      return originalPostMessage(message);
    } catch (err) {
      console.error('[BridgeInterceptor] Failed forwarding message:', err?.message);
    }
  };

  installed = true;
  console.log('[BridgeInterceptor] Installed ScanBridge.postMessage wrapper');
}

export function initializeBridgeInterceptor() {
  // Idempotent guard
  if (installed) return;

  // Expose global flag controller
  if (typeof window !== 'undefined' && typeof window.__VOICE_VERIFICATION_PENDING__ === 'undefined') {
    window.__VOICE_VERIFICATION_PENDING__ = false;
  }

  // Try immediate wrap
  wrapBridge();

  // Also poll for late bridge injection (native may inject after navigation)
  if (!installed) {
    watcherTimer = setInterval(() => {
      if (!installed) wrapBridge();
      else if (watcherTimer) {
        clearInterval(watcherTimer);
        watcherTimer = null;
      }
    }, 200);
  }
}

export function markVoicePending(isPending) {
  if (typeof window !== 'undefined') {
    window.__VOICE_VERIFICATION_PENDING__ = !!isPending;
  }
}

export function releasePendingBridgeMessage() {
  try {
    if (!pendingBridgePayload) {
      console.log('[BridgeInterceptor] No pending payload to release');
      return false;
    }

    if (!originalPostMessage) {
      console.warn('[BridgeInterceptor] Original postMessage not available; cannot release');
      return false;
    }

    // Mark voice no longer pending
    markVoicePending(false);

    // Ensure payload includes voice_verified: true when possible
    let payloadToSend = pendingBridgePayload;
    try {
      const obj = typeof pendingBridgePayload === 'string' ? JSON.parse(pendingBridgePayload) : pendingBridgePayload;
      obj.voice_verified = true;
      payloadToSend = JSON.stringify(obj);
    } catch {
      // If cannot parse, send as-is
    }

    // Forward to native now
    originalPostMessage(payloadToSend);
    console.log('[BridgeInterceptor] Released buffered payload to native');

    // Clear buffer
    pendingBridgePayload = null;
    return true;
  } catch (e) {
    console.error('[BridgeInterceptor] Error releasing payload:', e?.message);
    return false;
  }
}
