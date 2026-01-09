


import { NextResponse } from "next/server";

// ----------------------------------------------------------------------------
// SESSION STORAGE
// ----------------------------------------------------------------------------
const sessions = new Map();

const cleanupSessions = () => {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.createdAt < tenMinutesAgo) {
      sessions.delete(sessionId);
    }
  }
};

// ----------------------------------------------------------------------------
// POST HANDLER
// ----------------------------------------------------------------------------
export async function POST(request) {
  try {
  

    // 1. CLONE & READ RAW BODY
    const requestClone = request.clone();
    const rawBody = await requestClone.text();

    // 2. EXTRACT DATA
    let merchantId = null;
    let authToken = null;
    let deviceInfoRaw = null;

    // Strategy A: Try FormData
    try {
      const formData = await request.formData();
      merchantId = formData.get("merchant_id");
      authToken = formData.get("auth_token");
      deviceInfoRaw =
        formData.get("device_info") || formData.get("device_Info");
    } catch (e) {
      /* Ignore */
    }

    // Strategy B: Try Raw JSON (If Android sends application/json)
    if (!deviceInfoRaw && rawBody.trim().startsWith("{")) {
      try {
        const jsonData = JSON.parse(rawBody);
        merchantId = merchantId || jsonData.merchant_id;
        authToken = authToken || jsonData.auth_token;
        // Handle if device_Info is passed as an Object OR a String inside JSON
        const rawInfo = jsonData.device_info || jsonData.device_Info;
        if (typeof rawInfo === "object") {
          deviceInfoRaw = JSON.stringify(rawInfo);
        } else {
          deviceInfoRaw = rawInfo;
        }
      } catch (e) {
        /* Ignore */
      }
    }

    // Strategy C: URL Params fallback
    if (!deviceInfoRaw && rawBody.includes("=")) {
      const params = new URLSearchParams(rawBody);
      merchantId = merchantId || params.get("merchant_id");
      authToken = authToken || params.get("auth_token");
      deviceInfoRaw = params.get("device_info") || params.get("device_Info");
    }

    // Strategy D: Query String
    const urlParams = new URL(request.url).searchParams;
    merchantId = merchantId || urlParams.get("merchant_id");
    authToken = authToken || urlParams.get("auth_token");
    deviceInfoRaw =
      deviceInfoRaw ||
      urlParams.get("device_info") ||
      urlParams.get("device_Info");

    // 📋 LOG: Data Presence Check
    console.log("📱 Android Data:", {
      merchant_id: merchantId ? "✅" : "❌",
      auth_token: authToken ? "✅" : "❌",
      device_info: deviceInfoRaw ? "✅" : "❌"
    });

    // 3. PROCESS DEVICE INFO
    if (deviceInfoRaw && deviceInfoRaw.length > 0) {
      try {
        let deviceData;
        try {
          deviceData = JSON.parse(deviceInfoRaw);
        } catch (e) {
          const unescaped = deviceInfoRaw.replace(/\\"/g, '"');
          deviceData = JSON.parse(unescaped);
        }

        // Extract phone number from SIMs
        let phoneNumber = null;
        if (deviceData.sims && deviceData.sims.length > 0) {
          phoneNumber = deviceData.sims[0].sim;

          console.log("📞 Phone Number Extracted:", phoneNumber);
        }

        console.log("✅ Device Info Parsed Successfully");

        // --- 🛡️ SANITIZATION START 🛡️ ---
        // Fix: Ensure IPv4/IPv6 are arrays for Laravel
        if (deviceData.network) {
          if (
            deviceData.network.ipv4 &&
            typeof deviceData.network.ipv4 === "string"
          ) {
            deviceData.network.ipv4 = [deviceData.network.ipv4];
          }
          if (
            deviceData.network.ipv6 &&
            typeof deviceData.network.ipv6 === "string"
          ) {
            deviceData.network.ipv6 = [deviceData.network.ipv6];
          }
        }
        // --- 🛡️ SANITIZATION END 🛡️ ---

        // DELEGATE TO LARAVEL VIA LOCAL API
        const sessionId = `session_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2)}`;

        const payload = {
          DeviceId: deviceData.DeviceId,
          merchantId: merchantId,
          sessionId: sessionId,
          timestamp: Date.now(),
          device: deviceData.device,
          network: deviceData.network,
          sims: deviceData.sims || [],
          location: deviceData.location || null,
        };

        // Construct URL with BasePath
        const origin = new URL(request.url).origin;
        const targetApiUrl = `${origin}/securityscan/api/device-info`;


        fetch(targetApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch((err) =>
          console.error("❌ Failed to forward to device-info:", err)
        );

        // Create Session & Redirect
        sessions.set(sessionId, {
          merchantId,
          authToken,
          phoneNumber,
          createdAt: Date.now(),
        });
        cleanupSessions();

        const baseUrl = "https://testmobile.cardnest.io";
        const redirectUrl = `${baseUrl}/securityscan?session=${sessionId}&source=post`;

        // console.log("🚀 Redirecting WITH data to:", redirectUrl);
        return NextResponse.redirect(redirectUrl, 302);
      } catch (error) {
        console.error("❌ Error parsing device info:", error);
      }
    } else {
      console.warn("⚠️ WARNING: Proceeding WITHOUT Device Info");
    }

    // 4. FALLBACK REDIRECT
    const fallbackSessionId = `session_${Date.now()}_fallback`;
    sessions.set(fallbackSessionId, {
      merchantId,
      authToken,
      phoneNumber: null,
      createdAt: Date.now(),
    });

    const baseUrl = "https://testmobile.cardnest.io";
    const redirectUrl = `${baseUrl}/securityscan?session=${fallbackSessionId}&source=post&status=missing_device_info`;

    // console.log("🚀 Redirecting (Fallback) to:", redirectUrl);
    return NextResponse.redirect(redirectUrl, 302);
  } catch (error) {
    console.error("💥 SERVER ERROR:", error);
    return NextResponse.redirect(
      "https://testmobile.cardnest.io/securityscan?error=server_error",
      302
    );
  }
}

// GET HANDLER
export async function GET(request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");

  if (!sessionId)
    return NextResponse.json({ error: "Session ID required" }, { status: 400 });

  const session = sessions.get(sessionId);
  if (!session)
    return NextResponse.json(
      { error: "Invalid or expired session" },
      { status: 404 }
    );

  sessions.delete(sessionId);
  return NextResponse.json({ ...session, success: true });
}




// SAMPLE PAYLOAD FROM ANDROID APP
//  {

//   "merchant_id": "G5536942984B2978",

//   "auth_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9",

//   "device_Info": {

//     "DeviceId": "dawood",

//     "device": {

//       "bootCount": 61,

//       "brand": "dawood",

//       "buildFingerprint": "samsung/e3qxxx/e3q:16/BP2A.250605.031.A3/S928BXXS4CYJ7:user/release-keys",

//       "buildId": "BP2A.250605.031.A3",

//       "device": "e3q",

//       "manufacturer": "samsung",

//       "model": "SM-S928B",

//       "product": "e3qxxx",

//       "release": "16",

//       "sdkInt": 36,

//       "securityPatch": "2025-10-01"

//     },

//     "network": {

//       "activeTransports": ["WIFI"],

//       "bandwidthKbpsDown": 38381,

//       "bandwidthKbpsUp": 36020,

//       "dns": ["192.168.0.1", "114.114.114.114"],

//       "hasInternet": true,

//       "ipv4": "192.168.0.175",

//       "ipv6": "fe80::b005:fff:fe90:2b06",

//       "isMetered": false,

//       "isValidated": true,

//       "wifi": {

//         "linkSpeedMbps": 288,

//         "rssi": -62

//       }

//     },

//     "sims": [

//       {

//         "carrierId": 1970,

//         "mccmnc": "42403",

//         "sim": "971559467800",

//         "simType": "physical",

//         "subscriptionId": 9

//       },

//       {

//         "carrierId": 1970,

//         "mccmnc": "42403",

//         "sim": "971585589455",

//         "simType": "physical",

//         "subscriptionId": 5

//       }

//     ]

//   }

// }
