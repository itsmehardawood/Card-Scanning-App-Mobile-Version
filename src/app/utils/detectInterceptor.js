/**
 * Detect Response Interceptor
 * 
 * This utility intercepts responses from api.cardnest.io/detect to prevent
 * Android from processing the response before voice verification is complete.
 * 
 * Flow:
 * 1. When api.cardnest.io/detect response comes in, we capture it
 * 2. Check if complete_scan is true
 * 3. If yes, store the response and SUPPRESS it (Android doesn't see it yet)
 * 4. Show voice verification popup
 * 5. After voice verification succeeds, release the response to Android
 */

let pendingDetectResponse = null;
let voiceVerificationPending = false;

/**
 * Initialize the fetch interceptor
 * Call this once when the app loads
 */
export function initializeDetectInterceptor() {
  // Store original fetch
  const originalFetch = window.fetch;

  // Override fetch
  window.fetch = function(...args) {
    const fetchPromise = originalFetch.apply(this, args);

    return fetchPromise.then(async (response) => {
      // Check if this is a detect response that Android is listening for
      if (response.url.includes("api.cardnest.io/detect")) {
        console.log("🚨 [DETECT-INTERCEPTOR] Caught api.cardnest.io/detect response");

        // Clone the response so we can read it
        const cloned = response.clone();
        
        try {
          const jsonData = await cloned.json();
          console.log("📥 [DETECT-INTERCEPTOR] Response data:", {
            complete_scan: jsonData.complete_scan,
            has_encrypted_data: !!jsonData.encrypted_data,
            voice_verified: jsonData.voice_verified,
          });

          // If scan is complete but voice verification NOT done, hold the response
          if (jsonData.complete_scan && !jsonData.voice_verified) {
            console.log("⏸️ [DETECT-INTERCEPTOR] Scan complete but voice NOT verified - SUPPRESSING response from Android");
            console.log("   └─ Android will NOT see this response yet");
            console.log("   └─ Waiting for voice verification to complete...");

            // Store the response
            pendingDetectResponse = jsonData;
            voiceVerificationPending = true;

            // Return empty response so Android doesn't process it
            return new Response(JSON.stringify({}), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          // If voice is verified, let the response through
          if (jsonData.voice_verified) {
            console.log("✅ [DETECT-INTERCEPTOR] Voice verified - ALLOWING response to Android");
            return response;
          }
        } catch (err) {
          console.error("❌ [DETECT-INTERCEPTOR] Error parsing response:", err);
        }
      }

      // All other requests pass through normally
      return response;
    });
  };

  console.log("✅ [DETECT-INTERCEPTOR] Initialized - monitoring api.cardnest.io/detect responses");
}

/**
 * Get the pending detect response (stored while waiting for voice verification)
 */
export function getPendingDetectResponse() {
  return pendingDetectResponse;
}

/**
 * Release the pending response to Android after voice verification
 */
export function releasePendingDetectResponse() {
  if (!pendingDetectResponse) {
    console.warn("⚠️ [DETECT-INTERCEPTOR] No pending response to release");
    return null;
  }

  console.log("🔓 [DETECT-INTERCEPTOR] Releasing pending response to Android after voice verification");
  console.log("   └─ complete_scan: true");
  console.log("   └─ encrypted_data: [PRESENT]");
  console.log("   └─ voice_verified: true");

  const response = pendingDetectResponse;
  pendingDetectResponse = null;
  voiceVerificationPending = false;

  // Send the response to Android via fetch so their interceptor catches it
  if (response) {
    // Re-trigger the fetch to api.cardnest.io/detect with the verified data
    fetch('https://api.cardnest.io/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    })
    .then(() => {
      console.log("📡 [DETECT-INTERCEPTOR] Released response sent to Android");
    })
    .catch(err => {
      console.warn("⚠️ [DETECT-INTERCEPTOR] Could not re-send to Android:", err.message);
    });
  }

  return response;
}

/**
 * Check if we're waiting for voice verification
 */
export function isWaitingForVoiceVerification() {
  return voiceVerificationPending;
}
