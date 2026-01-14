// API endpoint for camera debugging logs
// This endpoint logs detailed camera selection, torch support, and device information

export async function POST(request) {
  try {
    const data = await request.json();
    
    const timestamp = new Date().toISOString();
    
    // Color-coded log types
    const logType = data.type || 'info';
    const logPrefix = {
      'camera-selection': '📷 CAMERA SELECTION',
      'torch-test': '🔦 TORCH TEST',
      'device-info': '📱 DEVICE INFO',
      'error': '❌ CAMERA ERROR',
      'success': '✅ CAMERA SUCCESS',
      'warning': '⚠️ CAMERA WARNING'
    }[logType] || '🔍 CAMERA DEBUG';
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${logPrefix} [${timestamp}]`);
    console.log(`${'='.repeat(60)}`);
    
    // Log the main message
    if (data.message) {
      console.log(`Message: ${data.message}`);
    }
    
    // Log camera details
    if (data.camera) {
      console.log('\n📷 Camera Details:');
      console.log(`  - Label: ${data.camera.label || 'Unknown'}`);
      console.log(`  - Device ID: ${data.camera.deviceId || 'N/A'}`);
      console.log(`  - Facing: ${data.camera.facing || 'unknown'}`);
      console.log(`  - Torch Support: ${data.camera.hasTorch ? 'YES ✅' : 'NO ❌'}`);
    }
    
    // Log all available cameras
    if (data.cameras && Array.isArray(data.cameras)) {
      console.log(`\n📹 All Cameras (${data.cameras.length}):`);
      data.cameras.forEach((cam, index) => {
        console.log(`  ${index + 1}. ${cam.label || 'Unknown'}`);
        console.log(`     - Facing: ${cam.facing || 'unknown'}`);
        console.log(`     - Device ID: ${cam.deviceId ? cam.deviceId.substring(0, 12) + '...' : 'N/A'}`);
        if (cam.hasTorch !== undefined) {
          console.log(`     - Torch: ${cam.hasTorch ? 'YES ✅' : 'NO ❌'}`);
        }
      });
    }
    
    // Log device information
    if (data.deviceInfo) {
      console.log('\n📱 Device Information:');
      console.log(`  - Samsung: ${data.deviceInfo.isSamsung ? 'YES' : 'NO'}`);
      console.log(`  - WebView: ${data.deviceInfo.isWebView ? 'YES' : 'NO'}`);
      console.log(`  - User Agent: ${data.deviceInfo.userAgent || 'N/A'}`);
    }
    
    // Log torch operation result
    if (data.torchResult) {
      console.log('\n🔦 Torch Operation:');
      console.log(`  - Success: ${data.torchResult.success ? 'YES ✅' : 'NO ❌'}`);
      console.log(`  - Method: ${data.torchResult.method || 'N/A'}`);
      console.log(`  - Reason: ${data.torchResult.reason || 'N/A'}`);
      if (data.torchResult.error) {
        console.log(`  - Error: ${data.torchResult.error}`);
      }
    }
    
    // Log any additional data
    if (data.extra) {
      console.log('\n📊 Additional Data:');
      console.log(JSON.stringify(data.extra, null, 2));
    }
    
    // Log error details
    if (data.error) {
      console.log('\n❌ Error Details:');
      console.log(data.error);
    }
    
    console.log(`${'='.repeat(60)}\n`);
    
    return Response.json({ success: true, timestamp });
  } catch (error) {
    console.error('❌ Error in debug-camera API:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
