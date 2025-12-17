
// post endpoint to receive device info from Android app to webview-entry next js then forward to laravel api

export async function POST(request) {
  try {
    const data = await request.json();
    
    // Check if this is just a heartbeat

    
    // Log Session Information
 
    
    // Log complete raw data for Laravel API reference
 

    // Validate required fields
    if (!data.merchantId) {
      console.warn("⚠️ Device info received without merchantId");
    }

    // Forward device info to Laravel API
    try {
      
      const laravelResponse = await fetch('https://admin.cardnest.io/api/device-info', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          DeviceId: data.DeviceId,
          merchantId: data.merchantId,
          sessionId: data.sessionId,
          timestamp: data.timestamp || Date.now(),
          device: data.device,
          network: data.network,
          sims: data.sims || [],
          location: data.location || null
        })
      });

      if (laravelResponse.ok) {
        const laravelResult = await laravelResponse.json();
        
        return Response.json({ 
          success: true, 
          received: data,
          laravelResponse: laravelResult,
          message: "Device info received and forwarded to Laravel successfully"
        });
      } else {
        const errorText = await laravelResponse.text();
        console.error('❌ Laravel API error:', {
          status: laravelResponse.status,
          statusText: laravelResponse.statusText,
          error: errorText
        });
        
        return Response.json({ 
          success: true, 
          received: data,
          laravelError: errorText,
          message: "Device info received but Laravel forwarding failed"
        }, { status: 200 }); // Still return 200 to not break frontend
      }
    } catch (forwardError) {
      console.error('❌ Error forwarding to Laravel:', forwardError);
      
      return Response.json({ 
        success: true, 
        received: data,
        forwardError: forwardError.message,
        message: "Device info received but Laravel forwarding failed"
      }, { status: 200 }); // Still return 200 to not break frontend
    }
  } catch (error) {
    console.error("❌ Error parsing device info:", error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 400 });
  }
}

export async function GET() {
  return Response.json({
    message: "✅ Device Info API working!",
  });
}







