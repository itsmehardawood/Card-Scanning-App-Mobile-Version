export const sendFrameToAPI = async (
  frameBlob,
  phase,
  sessionId,
  frameNumber
) => {
  let merchantId, authToken;
  // :white_check_mark: Extract merchantId and authToken from WebView context
  if (window.__WEBVIEW_AUTH__) {
    ({ merchantId, authToken } = window.__WEBVIEW_AUTH__);
  } else {
    throw new Error("No authentication available. Start from the app.");
  }
  // :white_check_mark: Basic credential checks
  if (!merchantId || !authToken) {
    throw new Error("Missing auth credentials.");
  }


  // testing ngrok
  // const apiUrl = `https://477a9ab44259.ngrok-free.app/detect/${merchantId}`;

  // dev server
  // const apiUrl = `https://testscan.cardnest.io/detect/${merchantId}`;

  // prod server
  const apiUrl = `https://api.cardnest.io/detect/${merchantId}`;

  const file = new File([frameBlob], `${phase}_frame_${frameNumber}.jpg`, {
    type: "image/jpeg",
  });
  // :white_check_mark: Build FormData (do NOT set Content-Type manually)
  const formData = new FormData();
  formData.append("file", file);
  formData.append("phase", phase);
  formData.append("session_id", sessionId);
  // :white_check_mark: Send request
  const response = await fetch(apiUrl, {
    method: "POST",
    body: formData,
    headers: {
      "auth-token": encodeURIComponent(authToken), // :white_check_mark: URL encode the auth token to handle special characters
      "ngrok-skip-browser-warning": "true", // optional, safe to include
      // :warning: DO NOT include "Content-Type" here
    },
  });
  // :white_check_mark: Error handling
  if (!response.ok) {
    const errorText = await response.text();
    // Only log errors that aren't "wait_for_front" or "wait_for_back" (these are expected when scan is complete)
    if (!errorText.includes("wait_for_front") && !errorText.includes("wait_for_back")) {
      console.error(":x: API Error:", errorText);
    }
    throw new Error(`API request failed with status ${response.status}`);
  }
  // :white_check_mark: Parse and return response JSON
  const data = await response.json();
  console.log("Response of API: ", data);

  return data;
};

/**
 * Report failure to the API when max retries are reached
 * @param {string} scanId - The scan ID (optional)
 * @param {string} sessionId - The session ID
 * @param {string} reason - The reason for failure
 * @param {string} phase - The phase where failure occurred (front/back/validation)
 * @param {string} merchantId - The merchant ID
 * @returns {Promise<void>}
 */
export const reportFailure = async (
  scanId,
  sessionId,
  reason,
  phase,
  merchantId
) => {
  try {
    // Extract authToken from WebView context
    let authToken;
    if (window.__WEBVIEW_AUTH__) {
      ({ authToken } = window.__WEBVIEW_AUTH__);
    } else {
      console.error("No authentication available for failure report.");
      return;
    }

    if (!authToken) {
      console.error("Missing auth token for failure report.");
      return;
    }

    const apiUrl = `https://api.cardnest.io/report_failure`;

    const payload = {
      scan_id: scanId || "",
      session_id: sessionId || "",
      reason: reason || "Max retries reached",
      stage: phase || "unknown", // API expects 'stage' field, but we pass 'phase' (front/back/validation)
      merchant_id: merchantId || "",
    };

    console.log("📤 Sending failure report:", payload);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "auth-token": encodeURIComponent(authToken),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Failure report API error:", errorText);
      return;
    }

    const data = await response.json();
    console.log("✅ Failure report sent successfully:", data);
  } catch (error) {
    console.error("❌ Error sending failure report:", error);
  }
};
