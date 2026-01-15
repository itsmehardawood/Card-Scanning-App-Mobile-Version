// POST /api/scan-complete
// This endpoint is called after voice verification to trigger iOS/Android fetch interception
// iOS intercepts fetches to api.cardnest.io/detect, so we simulate that response here

export async function POST(request) {
  try {
    const body = await request.json();
    
    console.log("📡 [scan-complete] Received payload for iOS/Android intercept");
    
    // Return data in the format iOS/Android expects
    // (Same format as the original Python API response)
    const responsePayload = {
      status: body.status || "verified",
      complete_scan: body.complete_scan || true,
      encrypted_data: body.encrypted_data,
      voice_verified: body.voice_verified || true,
      scan_id: body.scan_id,
      score: body.score,
      ...body
    };
    
    console.log("📡 [scan-complete] Returning intercepted payload");
    
    return Response.json(responsePayload, { status: 200 });
  } catch (error) {
    console.error("❌ [scan-complete] Error:", error);
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
