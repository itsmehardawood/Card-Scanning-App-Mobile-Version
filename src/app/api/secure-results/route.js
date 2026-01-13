import { NextResponse } from "next/server";

// ============================================================================
// SECURE RESULTS STORAGE API
// Purpose: Gate encrypted card data behind voice verification
// 
// Flow:
// 1. Card scan completes → POST stores data server-side (NOT exposed to client)
// 2. Voice verification completes → PUT marks result as verified
// 3. Android polls → GET returns data ONLY if verified
// ============================================================================

// In-memory storage for pending and verified scan results
const pendingResults = new Map();
const verifiedResults = new Map();

// Cleanup expired results (older than 5 minutes)
const cleanupExpiredResults = () => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  
  for (const [resultId, result] of pendingResults.entries()) {
    if (result.createdAt < fiveMinutesAgo) {
      console.log(`🗑️ [Cleanup] Expired pending result: ${resultId}`);
      pendingResults.delete(resultId);
    }
  }
  
  for (const [resultId, result] of verifiedResults.entries()) {
    if (result.verifiedAt < fiveMinutesAgo) {
      console.log(`🗑️ [Cleanup] Expired verified result: ${resultId}`);
      verifiedResults.delete(resultId);
    }
  }
};

// Run cleanup every minute
setInterval(cleanupExpiredResults, 60000);

// ============================================================================
// POST: Store scan results securely (BEFORE voice verification)
// ============================================================================
export async function POST(request) {
  try {
    const body = await request.json();
    const { sessionId, scanData, merchantId } = body;

    if (!sessionId || !scanData) {
      return NextResponse.json(
        { error: "sessionId and scanData are required" },
        { status: 400 }
      );
    }

    // Generate unique result ID
    const resultId = `result_${sessionId}_${Date.now()}`;

    // 🔒 CRITICAL: Store encrypted data on SERVER ONLY (not exposed to client)
    pendingResults.set(resultId, {
      sessionId,
      merchantId,
      scanData,
      voiceVerified: false,
      createdAt: Date.now(),
    });

    cleanupExpiredResults();

    console.log(`🔒 [Secure Storage] Scan results stored: ${resultId}`);
    console.log(`   └─ Session: ${sessionId}`);
    console.log(`   └─ Voice verification: PENDING`);
    console.log(`   └─ Android access: BLOCKED`);

    // Return ONLY the result ID (not the actual encrypted data)
    // 🔒 CRITICAL: complete_scan = false prevents mobile from proceeding
    return NextResponse.json({
      success: true,
      resultId,
      status: "pending_voice_verification",
      complete_scan: false, // 🚫 Mobile MUST NOT proceed until voice verification
      message: "Scan completed. Awaiting voice verification.",
    });
  } catch (error) {
    console.error("❌ [Secure Storage] Error storing scan results:", error);
    return NextResponse.json(
      { error: "Failed to store scan results" },
      { status: 500 }
    );
  }
}

// ============================================================================
// PUT: Mark result as voice-verified
// ============================================================================
export async function PUT(request) {
  try {
    const body = await request.json();
    const { resultId, verificationId } = body;

    if (!resultId || !verificationId) {
      return NextResponse.json(
        { error: "resultId and verificationId are required" },
        { status: 400 }
      );
    }

    const pendingResult = pendingResults.get(resultId);

    if (!pendingResult) {
      console.warn(`⚠️ [Voice Verification] Result not found or expired: ${resultId}`);
      return NextResponse.json(
        { error: "Invalid or expired result ID" },
        { status: 404 }
      );
    }

    console.log(`✅ [Voice Verification] Completed for: ${resultId}`);
    console.log(`   └─ Verification ID: ${verificationId}`);
    console.log(`   └─ Session: ${pendingResult.sessionId}`);

    // Move from pending to verified storage
    verifiedResults.set(resultId, {
      ...pendingResult,
      voiceVerified: true,
      verificationId,
      verifiedAt: Date.now(),
    });

    // Remove from pending
    pendingResults.delete(resultId);

    console.log(`🔓 [Access Control] Data now accessible for: ${resultId}`);

    return NextResponse.json({
      success: true,
      message: "Voice verification recorded. Data is now accessible.",
    });
  } catch (error) {
    console.error("❌ [Voice Verification] Error verifying result:", error);
    return NextResponse.json(
      { error: "Failed to verify result" },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET: Retrieve scan results (ONLY if voice verified)
// Android will poll this endpoint to check scan status
// ============================================================================
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    const resultId = url.searchParams.get("resultId");

    if (!sessionId && !resultId) {
      return NextResponse.json(
        { error: "sessionId or resultId is required" },
        { status: 400 }
      );
    }

    // Find result by sessionId or resultId
    let result = null;
    let foundResultId = null;

    if (resultId) {
      result = verifiedResults.get(resultId);
      foundResultId = resultId;
    } else {
      // Search by sessionId in verified results
      for (const [id, data] of verifiedResults.entries()) {
        if (data.sessionId === sessionId) {
          result = data;
          foundResultId = id;
          break;
        }
      }

      // If not found in verified, check if still pending
      if (!result) {
        for (const [id, data] of pendingResults.entries()) {
          if (data.sessionId === sessionId) {
            console.log(`⏳ [Access Check] Session ${sessionId} pending voice verification`);
            return NextResponse.json({
              success: false,
              status: "pending_voice_verification",
              complete_scan: false, // 🔒 Android will NOT process
              message: "Voice verification not yet completed",
            });
          }
        }
      }
    }

    if (!result) {
      console.log(`❌ [Access Check] No results found for session: ${sessionId || resultId}`);
      return NextResponse.json(
        { 
          error: "No results found for this session",
          complete_scan: false 
        },
        { status: 404 }
      );
    }

    // 🔒 CRITICAL: Double-check voice verification status
    if (!result.voiceVerified) {
      console.warn(`🚫 [Access Denied] Attempt to access unverified result: ${foundResultId}`);
      return NextResponse.json({
        success: false,
        status: "pending_voice_verification",
        complete_scan: false, // 🔒 Android will NOT process
        message: "Voice verification required before accessing scan data",
      });
    }

    console.log(`✅ [Access Granted] Releasing verified scan data`);
    console.log(`   └─ Result ID: ${foundResultId}`);
    console.log(`   └─ Session: ${sessionId || result.sessionId}`);
    console.log(`   └─ Voice verified: true`);
    console.log(`   └─ Android can now process data`);

    // Return the encrypted data with complete_scan flag
    const responseData = {
      success: true,
      status: "verified",
      complete_scan: true, // ✅ Android will NOW process this
      encrypted_data: result.scanData.encrypted_data,
      voice_verified: true,
      verificationId: result.verificationId,
      verifiedAt: result.verifiedAt,
      // Include all other scan data fields
      ...result.scanData,
    };

    // Optional: Uncomment to enable one-time access (delete after first read)
    // verifiedResults.delete(foundResultId);
    // console.log(`🗑️ [One-Time Access] Deleted result after retrieval: ${foundResultId}`);

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("❌ [Access Check] Error retrieving scan results:", error);
    return NextResponse.json(
      { error: "Failed to retrieve scan results" },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE: Manual cleanup (optional)
// ============================================================================
export async function DELETE(request) {
  try {
    const url = new URL(request.url);
    const resultId = url.searchParams.get("resultId");

    if (!resultId) {
      return NextResponse.json(
        { error: "resultId is required" },
        { status: 400 }
      );
    }

    const deletedFromPending = pendingResults.delete(resultId);
    const deletedFromVerified = verifiedResults.delete(resultId);

    if (deletedFromPending || deletedFromVerified) {
      console.log(`🗑️ [Manual Delete] Result deleted: ${resultId}`);
      return NextResponse.json({ 
        success: true,
        message: "Result deleted successfully"
      });
    }

    return NextResponse.json(
      { error: "Result not found" },
      { status: 404 }
    );
  } catch (error) {
    console.error("❌ [Delete] Error deleting result:", error);
    return NextResponse.json(
      { error: "Failed to delete result" },
      { status: 500 }
    );
  }
}
