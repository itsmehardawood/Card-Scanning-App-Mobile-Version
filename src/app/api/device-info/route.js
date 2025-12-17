
// post endpoint to receive device info from Android app to webview-entry next js then forward to laravel api

export async function POST(request) {
  try {
    const data = await request.json();
    
    // Check if this is just a heartbeat
    if (data.heartbeat) {
      console.log("💓 HEARTBEAT RECEIVED - Frontend is running!");
      console.log("   Merchant:", data.merchantId);
      console.log("   Session:", data.sessionId);
      console.log("   Message:", data.message);
      return Response.json({ 
        success: true, 
        message: "Heartbeat received"
      });
    }
    
    console.log("\n🔍 ========================================");
    console.log("🔍 RAW REQUEST BODY RECEIVED:");
    console.log("🔍 ========================================");
    console.log(JSON.stringify(data, null, 2));
    console.log("🔍 ========================================\n");
    
    console.log("📦 ========================================");
    console.log("📦 DEVICE INFO RECEIVED FROM ANDROID");
    console.log("📦 ========================================");
    
    // Log Device ID
    console.log("🆔 Device ID:", data.DeviceId);
    
    // Log Device Information
    if (data.device) {
      console.log(" Device Details:", {
        brand: data.device.brand,
        manufacturer: data.device.manufacturer,
        model: data.device.model,
        androidVersion: data.device.release,
        sdkInt: data.device.sdkInt,
        securityPatch: data.device.securityPatch,
        bootCount: data.device.bootCount,
        buildId: data.device.buildId,
        buildFingerprint: data.device.buildFingerprint
      });
    }
    
    // Log Network Information
    if (data.network) {
      console.log("🌐 Network Details:", {
        hasInternet: data.network.hasInternet,
        activeTransports: data.network.activeTransports,
        ipv4: data.network.ipv4,
        ipv6: data.network.ipv6,
        dns: data.network.dns,
        isMetered: data.network.isMetered,
        isValidated: data.network.isValidated,
        bandwidthDown: `${data.network.bandwidthKbpsDown} Kbps`,
        bandwidthUp: `${data.network.bandwidthKbpsUp} Kbps`
      });
      
      if (data.network.wifi) {
        console.log("📶 WiFi Info:", {
          linkSpeed: `${data.network.wifi.linkSpeedMbps} Mbps`,
          rssi: data.network.wifi.rssi
        });
      }
    }
    
    // Log SIM Information
    if (data.sims && data.sims.length > 0) {
      console.log("📞 SIM Cards:", data.sims.map((sim, index) => ({
        slot: index + 1,
        number: sim.sim,
        type: sim.simType,
        carrier: sim.carrierId,
        mccmnc: sim.mccmmc,
        subscriptionId: sim.subscriptionId
      })));
    }
    
    // Log Session Information
    if (data.merchantId || data.sessionId) {
      console.log("🔑 Session Info:", {
        merchantId: data.merchantId,
        sessionId: data.sessionId,
        timestamp: data.timestamp
      });
    }
    
    // Log complete raw data for Laravel API reference
    console.log("📄 COMPLETE RAW DATA (for Laravel API):");
    console.log(JSON.stringify(data, null, 2));
    console.log("📦 ========================================\n");

    // Validate required fields
    if (!data.merchantId) {
      console.warn("⚠️ Device info received without merchantId");
    }

    // Forward device info to Laravel API
    try {
      console.log('📤 Forwarding device info to Laravel API...');
      
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
        console.log('✅ Device info forwarded to Laravel successfully:', laravelResult);
        
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







