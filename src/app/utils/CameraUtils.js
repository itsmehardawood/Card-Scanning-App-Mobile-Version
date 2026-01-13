
/**
 * 🎯 CAMERA UTILITIES FOR CARD DETECTION
 * 
 * This module handles camera initialization, frame capture, and cleanup.
 * 
 * FRAME CAPTURE SAFETY:
 * - Ensures only one frame capture operation at a time
 * - Proper async handling with toBlob()
 * - Frame counter should be managed by calling hook
 * - Built-in safeguards against multiple simultaneous captures
 * 
 * PERMISSION HANDLING:
 * - Detects "Only This Time" permission issues
 * - Automatic permission re-request functionality
 * - Comprehensive error handling for mobile webview
 * - Enhanced WebView compatibility
 * 
 * MULTI-CAMERA SUPPORT:
 * - Enumerates all video input devices
 * - Filters back-facing vs front-facing cameras
 * - Selects torch-capable camera for back-side card scanning
 * - Falls back to default environment camera if no torch camera found
 * - Enhanced Samsung multi-camera device support
 */

// Camera Utilities for Card Detection

// 🧪 TEST MODE: Set to true to bypass torch requirements for laptop testing
// In production, this should be false
const TEST_MODE = true; // Set to false for production

// 🔒 CAPTURE LOCK: Prevents multiple simultaneous frame captures
let isCapturing = false;

// 📷 SELECTED CAMERA TRACKING: Track which camera was selected for torch support
let selectedCameraDeviceId = null;
let selectedCameraLabel = null;
let selectedCameraHasTorch = false;

// 🔍 WEBVIEW DETECTION
const isWebView = () => {
  const userAgent = navigator.userAgent;
  const isIOSWebView = /iPhone|iPad|iPod/.test(userAgent) && (/Version\//.test(userAgent) || window.webkit);
  const isAndroidWebView = /Android/.test(userAgent) && (/wv/.test(userAgent) || window.AndroidInterface);
  
  return isIOSWebView || isAndroidWebView || window.ReactNativeWebView !== undefined;
};

// 📱 DEVICE TYPE DETECTION
const isSamsungDevice = () => {
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes('samsung') || userAgent.includes('sm-');
};

// 📱 iOS DEVICE DETECTION
export const isIOSDevice = () => {
  const userAgent = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(userAgent);
};

// 🐛 DEBUG: Send logs to server for remote debugging
const logToServer = async (type, message, data = {}) => {
  try {
    // Always send logs (enabled for production debugging)
    // To disable, set: window.DISABLE_CAMERA_DEBUG = true
    const debugDisabled = typeof window !== 'undefined' && window.DISABLE_CAMERA_DEBUG;
    
    if (debugDisabled) {
      return;
    }
    
    console.log(`📤 Sending to server: [${type}] ${message}`);
    
    const response = await fetch('/securityscan/api/debug-camera', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        message,
        ...data,
        timestamp: Date.now()
      })
    });
    
    if (!response.ok) {
      console.warn(`⚠️ Debug log failed: ${response.status}`);
    }
  } catch (error) {
    // Log to console but don't disrupt camera operations
    console.warn('⚠️ Could not send debug log to server:', error.message);
  }
};

// 📹 ENUMERATE ALL VIDEO INPUT DEVICES
export const enumerateVideoDevices = async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      console.log('📹 MediaDevices API not available');
      return [];
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    
    console.log(`📹 Found ${videoDevices.length} video input device(s):`);
    videoDevices.forEach((device, index) => {
      console.log(`  ${index + 1}. ${device.label || 'Unknown Camera'} (ID: ${device.deviceId.substring(0, 8)}...)`);
    });
    
    return videoDevices;
  } catch (error) {
    console.error('❌ Error enumerating video devices:', error);
    return [];
  }
};

// 🎯 SCORE CAMERA QUALITY FOR CARD SCANNING
// Higher score = better camera for card scanning (avoid telephoto, prefer wide)
const scoreCameraForScanning = (device) => {
  const label = (device.label || '').toLowerCase();
  let score = 0;
  
  // 🏆 BEST: Wide/Main cameras (normal field of view)
  if (label.includes('dual wide') || label.includes('wide camera')) {
    score += 100; // Highest priority
  }
  if (label.includes('main')) {
    score += 90;
  }
  if (label.includes('wide') && !label.includes('ultra')) {
    score += 80;
  }
  
  // ✅ GOOD: Generic back cameras
  if (label.includes('back camera') && !label.includes('ultra') && !label.includes('telephoto')) {
    score += 70;
  }
  if (label.includes('dual camera')) {
    score += 60;
  }
  if (label.includes('triple camera')) {
    score += 50; // Lower priority - might use telephoto internally
  }
  
  // ⚠️ AVOID: Ultra wide (fish-eye distortion)
  if (label.includes('ultra')) {
    score -= 50;
  }
  
  // ❌ WORST: Telephoto cameras (too zoomed in)
  if (label.includes('telephoto') || label.includes('tele') || label.includes('zoom')) {
    score -= 100; // Strongly avoid
  }
  
  return score;
};

// 🔍 CLASSIFY CAMERA AS FRONT OR BACK FACING
const classifyCameraFacing = (device) => {
  const label = (device.label || '').toLowerCase();
  
  // Common back camera indicators
  const backIndicators = ['back', 'rear', 'environment', 'main', 'wide', 'ultra', 'telephoto', 'macro', '후면', '뒤'];
  // Common front camera indicators  
  const frontIndicators = ['front', 'selfie', 'user', 'facetime', '전면', '앞'];
  
  for (const indicator of backIndicators) {
    if (label.includes(indicator)) {
      return 'back';
    }
  }
  
  for (const indicator of frontIndicators) {
    if (label.includes(indicator)) {
      return 'front';
    }
  }
  
  // If no clear indication, check for camera index patterns (camera 0 is usually back on Android)
  if (label.includes('camera 0') || label.includes('camera2 0')) {
    return 'back';
  }
  if (label.includes('camera 1') || label.includes('camera2 1')) {
    return 'front';
  }
  
  return 'unknown';
};

// 🔦 CHECK IF A SPECIFIC CAMERA SUPPORTS TORCH (by device ID)
const checkCameraTorchSupport = async (deviceId) => {
  let testStream = null;
  try {
    // Handle missing or invalid deviceId
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length === 0) {
      console.log('🔦 ❌ Invalid device ID provided, skipping torch check');
      console.log(`🔦 deviceId value: ${deviceId}, type: ${typeof deviceId}`);
      return { supported: false, capabilities: null, error: 'INVALID_DEVICE_ID' };
    }
    
    const deviceIdShort = deviceId.length > 8 ? deviceId.substring(0, 8) + '...' : deviceId;
    console.log(`🔦 ========================================`);
    console.log(`🔦 Testing torch support for device: ${deviceIdShort}`);
    console.log(`🔦 Full device ID: ${deviceId}`);
    console.log(`🔦 Requesting getUserMedia...`);
    
    // Get a minimal stream from this specific camera
    testStream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 320 },
        height: { ideal: 240 }
      }
    });
    
    console.log(`🔦 ✅ Got media stream`);
    
    const videoTrack = testStream.getVideoTracks()[0];
    if (!videoTrack) {
      console.log('🔦 ❌ No video track obtained from stream');
      return { supported: false, capabilities: null, error: 'NO_VIDEO_TRACK' };
    }
    
    // console.log(`🔦 Video track obtained: ${videoTrack.label}`);
    // console.log(`🔦 Getting track capabilities...`);
    
    const capabilities = videoTrack.getCapabilities();
    // console.log(`🔦 Capabilities:`, JSON.stringify(capabilities, null, 2));
    
    // IMPORTANT: Don't trust capabilities API - many Android WebViews report wrong info
    // Instead, actually TRY to enable torch and see if it works
    console.log(`🔦 Attempting to enable torch (real test)...`);
    
    let torchActuallySupported = false;
    try {
      await videoTrack.applyConstraints({
        advanced: [{ torch: true }]
      });
      
      // Check if torch was actually enabled
      const settings = videoTrack.getSettings();
      torchActuallySupported = settings.torch === true;
      
      console.log(`🔦 Torch enable result: ${torchActuallySupported ? '✅ WORKS' : '❌ FAILED'}`);
      console.log(`🔦 Settings.torch value:`, settings.torch);
      
      // Turn it back off
      if (torchActuallySupported) {
        await videoTrack.applyConstraints({
          advanced: [{ torch: false }]
        });
        console.log(`🔦 Torch disabled after test`);
      }
    } catch (torchError) {
      console.log(`🔦 Torch enable threw error: ${torchError.message}`);
      torchActuallySupported = false;
    }
    
    console.log(`🔦 Camera ${deviceIdShort} torch support: ${torchActuallySupported ? '✅ YES' : '❌ NO'}`);
    console.log(`🔦 (Capabilities reported: ${capabilities?.torch})`);
    console.log(`🔦 ========================================`);
    
    return { 
      supported: torchActuallySupported, 
      capabilities,
      trackLabel: videoTrack.label 
    };
  } catch (error) {
    const deviceIdShort = deviceId && deviceId.length > 8 ? deviceId.substring(0, 8) + '...' : (deviceId || 'unknown');
    console.log(`🔦 ========================================`);
    console.log(`🔦 ❌ ERROR testing torch for device ${deviceIdShort}`);
    console.warn(`🔦 Error name: ${error.name}`);
    console.warn(`🔦 Error message: ${error.message}`);
    console.log(`🔦 ========================================`);
    return { supported: false, capabilities: null, error: error.message };
  } finally {
    // Always clean up the test stream
    if (testStream) {
      testStream.getTracks().forEach(track => track.stop());
      console.log(`🔦 Test stream cleaned up`);
    }
  }
};

// 📷 FIND BEST CAMERA FOR CARD SCANNING (with torch preference)
export const findBestCameraForScan = async (scanSide = 'back') => {
  console.log(`📷 Finding best camera for ${scanSide}-side card scan...`);
  console.log(`📱 Device info: Samsung=${isSamsungDevice()}, WebView=${isWebView()}`);
  
  // Log to server for remote debugging
  await logToServer('device-info', 'Camera scan started', {
    deviceInfo: {
      isSamsung: isSamsungDevice(),
      isWebView: isWebView(),
      userAgent: navigator.userAgent
    },
    extra: { scanSide }
  });
  
  try {
    // First, we need camera permission to see device labels
    // Request minimal permission to enumerate devices with labels
    let tempStream = null;
    try {
      tempStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: scanSide === 'front' ? 'user' : 'environment' } 
      });
    } catch (e) {
      console.warn('⚠️ Could not get temp stream for device enumeration:', e.message);
    }
    
    const devices = await enumerateVideoDevices();
    
    // Debug log - check raw device objects
    console.log('📷 Raw devices from enumeration:', devices.map(d => ({
      label: d.label,
      deviceId: d.deviceId,
      kind: d.kind,
      hasDeviceId: !!d.deviceId,
      deviceIdType: typeof d.deviceId
    })));
    
    // Log all cameras to server
    await logToServer('device-info', `Found ${devices.length} cameras`, {
      cameras: devices.map(d => ({
        label: d.label || 'Unknown',
        deviceId: d.deviceId,
        deviceIdPresent: !!d.deviceId,
        deviceIdType: typeof d.deviceId,
        facing: classifyCameraFacing(d)
      }))
    });
    
    // Clean up temp stream
    if (tempStream) {
      tempStream.getTracks().forEach(track => track.stop());
    }
    
    if (devices.length === 0) {
      console.log('📷 No video devices found, will use default');
      return { deviceId: null, hasTorch: false, facing: 'unknown', label: 'default' };
    }
    
    // Classify all cameras
    const classifiedCameras = devices.map(device => {
      // Explicitly extract properties to avoid any spread operator issues
      const cameraObj = {
        deviceId: device.deviceId,
        groupId: device.groupId,
        kind: device.kind,
        label: device.label,
        facing: classifyCameraFacing(device)
      };
      
      console.log(`📷 Classifying camera: ${device.label}`, {
        originalDeviceId: device.deviceId,
        newObjDeviceId: cameraObj.deviceId,
        deviceIdMatch: device.deviceId === cameraObj.deviceId
      });
      
      return cameraObj;
    });
    
    console.log('📷 Classified cameras:');
    classifiedCameras.forEach(cam => {
      console.log(`  - ${cam.label || 'Unknown'}: facing=${cam.facing}, deviceId=${cam.deviceId ? cam.deviceId.substring(0, 12) + '...' : 'MISSING'}`);
    });
    
    console.log('📷 Classified cameras full details:', classifiedCameras.map(c => ({
      label: c.label,
      deviceId: c.deviceId,
      facing: c.facing,
      hasDeviceId: !!c.deviceId,
      deviceIdLength: c.deviceId ? c.deviceId.length : 0
    })));
    
    // Filter cameras based on scan side
    const targetFacing = scanSide === 'front' ? 'front' : 'back';
    let targetCameras = classifiedCameras.filter(cam => cam.facing === targetFacing);
    
    console.log(`📷 After filtering for ${targetFacing}: ${targetCameras.length} cameras`);
    targetCameras.forEach((cam, idx) => {
      console.log(`  [${idx}] label=${cam.label}, deviceId=${cam.deviceId}, facing=${cam.facing}`);
    });
    
    // If no cameras match the target facing, include unknown cameras for back scan
    if (targetCameras.length === 0 && scanSide === 'back') {
      console.log('📷 No clearly back-facing cameras found, including unknown facing cameras');
      targetCameras = classifiedCameras.filter(cam => cam.facing !== 'front');
      console.log(`📷 After including unknown: ${targetCameras.length} cameras`);
    }
    
    // If still no cameras, use all cameras
    if (targetCameras.length === 0) {
      console.log('📷 No matching cameras found, using all available cameras');
      targetCameras = classifiedCameras;
    }
    
    console.log(`📷 ${targetCameras.length} candidate camera(s) for ${scanSide}-side scan`);
    console.log('📷 Target cameras RAW:', targetCameras);
    console.log('📷 Target cameras details:', targetCameras.map(c => ({
      label: c.label,
      deviceId: c.deviceId,
      deviceIdShort: c.deviceId ? c.deviceId.substring(0, 12) + '...' : 'MISSING',
      facing: c.facing,
      hasDeviceId: !!c.deviceId,
      deviceIdType: typeof c.deviceId,
      deviceIdLength: c.deviceId ? c.deviceId.length : 0
    })));
    
    // 🎯 FILTER AND PRIORITIZE CAMERAS: Remove telephoto/ultra-wide, keep only main/wide cameras
    if (scanSide === 'back' && targetCameras.length > 1) {
      console.log('🎯 Filtering and scoring cameras to prioritize main/wide cameras...');
      
      // STEP 1: Filter out telephoto and ultra-wide cameras completely
      const filteredCameras = targetCameras.filter(cam => {
        const label = (cam.label || '').toLowerCase();
        const isTelephoto = label.includes('telephoto') || label.includes('tele') || label.includes('zoom');
        const isUltraWide = label.includes('ultra');
        
        if (isTelephoto) {
          console.log(`🚫 EXCLUDING telephoto camera: ${cam.label}`);
          return false;
        }
        if (isUltraWide) {
          console.log(`🚫 EXCLUDING ultra-wide camera: ${cam.label}`);
          return false;
        }
        return true;
      });
      
      console.log(`✅ Filtered ${targetCameras.length} → ${filteredCameras.length} cameras (removed telephoto/ultra-wide)`);
      
      // STEP 2: Score remaining cameras and sort
      const scoredCameras = filteredCameras.map(cam => ({
        ...cam,
        score: scoreCameraForScanning(cam)
      }));
      
      // Sort by score (highest first)
      scoredCameras.sort((a, b) => b.score - a.score);
      
      console.log('🎯 Camera priority ranking (after filtering):');
      scoredCameras.forEach((cam, idx) => {
        console.log(`  ${idx + 1}. [Score: ${cam.score}] ${cam.label}`);
      });
      
      // Update targetCameras with filtered and sorted list
      targetCameras = scoredCameras;
      
      console.log('✅ Will ONLY test main/wide cameras for torch - NO telephoto or ultra-wide');
    }
    
    // For back-side scan, prioritize torch-capable cameras
    if (scanSide === 'back' && targetCameras.length > 0) {
      console.log('🔦 ========================================');
      console.log('🔦 STARTING TORCH CAPABILITY CHECK');
      console.log('🔦 ========================================');
      console.log(`🔦 Will test ${targetCameras.length} camera(s) for torch support`);
      
      // Log each camera before sending to server
      targetCameras.forEach((c, idx) => {
        console.log(`🔦 Camera ${idx}: label=${c.label}, deviceId=${c.deviceId}, facing=${c.facing}`);
      });
      
      const camerasForLog = targetCameras.map(c => {
        const logObj = {
          label: c.label || 'Unknown',
          deviceId: c.deviceId || 'N/A',
          facing: c.facing || 'unknown',
          hasDeviceId: !!c.deviceId
        };
        console.log('🔦 Prepared for server log:', logObj);
        return logObj;
      });
      
      console.log('🔦 Sending to server:', JSON.stringify(camerasForLog, null, 2));
      
      await logToServer('torch-check-start', `Testing ${targetCameras.length} cameras for torch`, {
        cameras: camerasForLog
      });
      
      for (let i = 0; i < targetCameras.length; i++) {
        const camera = targetCameras[i];
        console.log(`\n🔦 [${i + 1}/${targetCameras.length}] Testing camera: ${camera.label || 'Unknown'}`);
        console.log(`🔦   - Device ID present: ${!!camera.deviceId}`);
        console.log(`🔦   - Device ID type: ${typeof camera.deviceId}`);
        console.log(`🔦   - Device ID value: ${camera.deviceId || 'NULL/UNDEFINED'}`);
        
        // Skip cameras without valid deviceId
        if (!camera.deviceId || typeof camera.deviceId !== 'string' || camera.deviceId.length === 0) {
          console.log(`⏭️ ⚠️ SKIPPING - Invalid deviceId`);
          await logToServer('torch-test-skip', `Skipped: ${camera.label}`, {
            camera: { label: camera.label, deviceId: camera.deviceId },
            reason: 'Invalid deviceId'
          });
          continue;
        }
        
        console.log(`🔦 Testing camera: ${camera.label || 'Unknown'} (${camera.deviceId.substring(0, 12)}...)`);
        console.log(`🔦 Calling checkCameraTorchSupport...`);
        
        const torchResult = await checkCameraTorchSupport(camera.deviceId);
        console.log(`🔦 Torch test result:`, torchResult);
        
        // Log torch test result to server
        await logToServer('torch-test', `Torch test: ${camera.label}`, {
          camera: {
            label: camera.label,
            deviceId: camera.deviceId,
            facing: camera.facing
          },
          torchResult: {
            supported: torchResult.supported,
            error: torchResult.error,
            capabilities: torchResult.capabilities,
            trackLabel: torchResult.trackLabel
          }
        });
        
        if (torchResult.supported) {
          console.log('🔦 ========================================');
          console.log(`🔦 ✅ FOUND TORCH-CAPABLE CAMERA!`);
          console.log(`🔦 Camera: ${camera.label || torchResult.trackLabel}`);
          console.log(`🔦 Device ID: ${camera.deviceId}`);
          console.log('🔦 ========================================');
          
          const selectedCamera = {
            deviceId: camera.deviceId,
            hasTorch: true,
            facing: camera.facing,
            label: camera.label || torchResult.trackLabel || 'Unknown',
            capabilities: torchResult.capabilities
          };
          
          // Log to server
          await logToServer('camera-selection', 'Torch-capable camera found', {
            camera: selectedCamera
          });
          
          console.log('🔦 Returning torch-capable camera:', selectedCamera);
          return selectedCamera;
        } else {
          console.log(`🔦 ❌ Camera does NOT support torch`);
          console.log(`🔦   Reason: ${torchResult.error || 'No torch in capabilities'}`);
        }
      }
      
      console.log('\n🔦 ========================================');
      console.log('🔦 ❌ NO TORCH-CAPABLE CAMERA FOUND');
      console.log(`🔦 Tested ${targetCameras.length} camera(s), none have torch`);
      
      if (TEST_MODE) {
        console.log('🧪 TEST MODE ENABLED - Bypassing torch requirement');
        console.log('🧪 Using first available back camera for testing');
        const testCamera = targetCameras[0];
        
        await logToServer('torch-check-complete', 'No torch camera found - TEST MODE bypass', {
          testedCount: targetCameras.length,
          testMode: true,
          selectedCamera: testCamera.label
        });
        
        return {
          deviceId: testCamera.deviceId || null,
          hasTorch: false, // No torch in test mode
          facing: testCamera.facing,
          label: testCamera.label || 'Test Camera',
          testMode: true
        };
      }
      
      console.log('🔦 ⚠️ CANNOT PROCEED - Torch required for back-side scan');
      console.log('🔦 ========================================');
      
      await logToServer('torch-check-complete', 'No torch camera found - FAILING', {
        testedCount: targetCameras.length,
        message: 'No torch-capable back camera available - scan cannot proceed',
        scanSide: scanSide
      });
      
      // For back-side scan, torch is REQUIRED - return error
      return { 
        deviceId: null, 
        hasTorch: false, 
        facing: 'back', 
        label: 'No torch camera', 
        error: 'NO_TORCH_CAMERA',
        message: 'Back-side card scanning requires a camera with flashlight support. No torch-capable camera found on this device.'
      };
    }
    
    // For front-side scan (no torch requirement), return first matching camera
    if (scanSide === 'front' && targetCameras.length > 0) {
      const selectedCamera = targetCameras[0];
      console.log(`📷 Selected front camera: ${selectedCamera.label || 'Unknown'}`);
      
      const result = {
        deviceId: selectedCamera.deviceId || null,
        hasTorch: false,
        facing: selectedCamera.facing,
        label: selectedCamera.label || 'Unknown'
      };
      
      await logToServer('camera-selection', 'Front camera selected (no torch needed)', {
        camera: result
      });
      
      return result;
    }
    
    // Fallback: No suitable camera found
    console.log('❌ No suitable camera found');
    await logToServer('camera-selection', 'No suitable camera found', {
      scanSide,
      targetCamerasCount: targetCameras.length
    });
    
    return { 
      deviceId: null, 
      hasTorch: false, 
      facing: 'unknown', 
      label: 'No camera', 
      error: 'NO_CAMERA',
      message: 'No suitable camera found for scanning'
    };
    
  } catch (error) {
    console.error('❌ Error finding best camera:', error);
    
    // Log error to server
    await logToServer('error', 'Camera selection failed', {
      error: error.message
    });
    
    return { deviceId: null, hasTorch: false, facing: 'unknown', label: 'default', error: error.message };
  }
};

// 📷 GET SELECTED CAMERA INFO
export const getSelectedCameraInfo = () => {
  return {
    deviceId: selectedCameraDeviceId,
    label: selectedCameraLabel,
    hasTorch: selectedCameraHasTorch
  };
};

// 📱 ENHANCED CAMERA PERMISSIONS CHECK (WebView Compatible)
// Uses multiple methods to accurately detect camera permission status
export const checkCameraPermissions = async () => {
  try {
    console.log('🔍 Checking camera permissions (WebView compatible)...');
    
    // Method 1: Try Permissions API (may not work in all WebViews)
    if (navigator.permissions) {
      try {
        const result = await navigator.permissions.query({ name: 'camera' });
        console.log('📹 Permissions API result:', result.state);
        
        // Only trust 'denied' state, others might be unreliable in WebView
        if (result.state === 'denied') {
          return 'denied';
        }
        
        // For 'granted' and 'prompt', we'll verify with actual device test
        if (result.state === 'granted') {
          // Double-check with device enumeration
          const actualStatus = await verifyPermissionWithDevices();
          return actualStatus || result.state;
        }
        
        return result.state;
      } catch (permError) {
        console.log('📹 Permissions API failed:', permError.message);
        // Continue to fallback methods
      }
    }

    // Method 2: Try device enumeration (works better in WebView)
    return await verifyPermissionWithDevices();
    
  } catch (error) {
    console.error('❌ Permission check failed:', error);
    return 'unknown';
  }
};

// 🔍 VERIFY PERMISSIONS WITH DEVICE ENUMERATION
// More reliable method for WebView environments
const verifyPermissionWithDevices = async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      console.log('📱 MediaDevices API not available');
      return 'unknown';
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(device => device.kind === 'videoinput');
    
    if (cameras.length === 0) {
      console.log('📹 No camera devices found');
      return 'no-camera';
    }

    // If we can see device labels, permission is likely granted
    const hasLabels = cameras.some(camera => camera.label && camera.label.trim() !== '');
    
    if (hasLabels) {
      console.log('📹 Device labels visible - permission likely granted');
      return 'granted';
    } else {
      console.log('📹 Device labels hidden - permission needed');
      return 'prompt';
    }
    
  } catch (error) {
    console.error('❌ Device enumeration failed:', error);
    return 'unknown';
  }
};

// 🎯 ENHANCED CAMERA INITIALIZATION WITH WEBVIEW SUPPORT AND MULTI-CAMERA SELECTION
// scanSide: 'front' for front-side card scan (user-facing camera), 'back' for back-side card scan (environment camera)
// isIOSFlag: set to true to skip multicamera process and use primary camera only
export const initializeCamera = async (videoRef, onPermissionDenied = null, scanSide = 'back', isIOSFlag = false) => {
  try {
    console.log('📹 Starting camera initialization...');
    const iosDevice = isIOSFlag || isIOSDevice();
    console.log(`📱 WebView environment: ${isWebView()}, Samsung device: ${isSamsungDevice()}, iOS device: ${iosDevice}`);
    console.log(`🎯 Scan side: ${scanSide}`);
    
    // Step 1: Check current permission status
    const permissionStatus = await checkCameraPermissions();
    console.log('🔐 Permission status:', permissionStatus);

    // Step 2: Handle definitive denial
    if (permissionStatus === 'denied') {
      console.log('🚫 Permission explicitly denied');
      if (onPermissionDenied) {
        onPermissionDenied('PERMISSION_DENIED');
      }
      throw new Error('PERMISSION_DENIED');
    }

    if (permissionStatus === 'no-camera') {
      console.log('📹 No camera device available');
      if (onPermissionDenied) {
        onPermissionDenied('NO_CAMERA');
      }
      throw new Error('NO_CAMERA');
    }

    // Step 3: For iOS devices, skip multicamera process and use primary camera
    let bestCamera;
    if (iosDevice) {
      console.log('📱 iOS device detected - using primary camera without multicamera selection process');
      const facingMode = scanSide === 'front' ? 'user' : 'environment';
      bestCamera = {
        deviceId: null, // Let browser select the appropriate camera
        label: 'Primary Camera',
        hasTorch: false, // iOS handles torch differently, avoid complications
        facing: scanSide,
        error: null
      };
      console.log('📱 iOS camera setup:', bestCamera);
    } else {
      // Step 3: Find the best camera for this scan side (with torch preference for back scan)
      console.log('📷 Searching for optimal camera...');
      bestCamera = await findBestCameraForScan(scanSide);
    }
    
    // Step 3.1: Check if camera selection returned an error
    if (bestCamera.error) {
      console.log('❌ Camera selection failed:', bestCamera.error);
      console.log('📝 Error message:', bestCamera.message);
      
      if (bestCamera.error === 'NO_TORCH_CAMERA' && scanSide === 'back') {
        console.log('🔦 ❌ CRITICAL: No torch-capable camera available for back-side scan');
        if (onPermissionDenied) {
          onPermissionDenied('NO_TORCH_CAMERA', bestCamera.message);
        }
        throw new Error('NO_TORCH_CAMERA: ' + bestCamera.message);
      }
      
      if (bestCamera.error === 'NO_CAMERA') {
        console.log('📹 No camera device available');
        if (onPermissionDenied) {
          onPermissionDenied('NO_CAMERA');
        }
        throw new Error('NO_CAMERA');
      }
    }
    
    console.log('📷 Best camera selection result:', {
      deviceId: bestCamera.deviceId ? bestCamera.deviceId.substring(0, 8) + '...' : 'default',
      label: bestCamera.label,
      hasTorch: bestCamera.hasTorch,
      facing: bestCamera.facing,
      error: bestCamera.error || 'none'
    });
    
    // Step 3.2: For back-side scan, verify torch capability (unless in TEST_MODE)
    if (scanSide === 'back' && !bestCamera.hasTorch) {
      if (TEST_MODE) {
        console.log('🧪 TEST MODE: Skipping torch verification for back-side scan');
        console.log('🧪 Proceeding without torch capability for testing purposes');
      } else {
        console.log('🔦 ❌ CRITICAL: Selected camera does not have torch capability');
        const errorMsg = 'Back-side card scanning requires a camera with flashlight. The selected camera does not support torch/flashlight.';
        if (onPermissionDenied) {
          onPermissionDenied('NO_TORCH_CAMERA', errorMsg);
        }
        throw new Error('NO_TORCH_CAMERA: ' + errorMsg);
      }
    }
    
    if (scanSide === 'back' && bestCamera.hasTorch) {
      console.log('🔦 ✅ VERIFIED: Using torch-capable camera for back-side scan');
      console.log(`🔦 Camera: ${bestCamera.label}`);
    }

    // Step 4: Build constraints based on camera selection
    let constraints;
    
    if (bestCamera.deviceId) {
      // Use specific device ID for the selected camera
      constraints = {
        video: {
          deviceId: { exact: bestCamera.deviceId },
          width: { ideal: 1280, min: 640, max: 1920 },
          height: { ideal: 720, min: 480, max: 1080 }
        }
      };
      console.log(`📹 Using specific camera: ${bestCamera.label} (torch: ${bestCamera.hasTorch})`);
    } else {
      // Fallback to facingMode if no specific device selected
      const facingMode = scanSide === 'front' ? 'user' : 'environment';
      constraints = {
        video: { 
          width: { ideal: 1280, min: 640, max: 1920 },
          height: { ideal: 720, min: 480, max: 1080 },
          facingMode: facingMode
        } 
      };
      console.log(`📹 Using facingMode: ${facingMode} (no specific camera selected)`);
    }

    // Step 5: Attempt camera access
    console.log('📹 Requesting camera access...');
    
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (getUserMediaError) {
      console.error('❌ getUserMedia failed with specific constraints:', getUserMediaError);
      
      // For back-side scan with torch requirement, DO NOT fallback to facingMode
      // This would potentially select a camera without torch
      if (bestCamera.deviceId && bestCamera.hasTorch && scanSide === 'back') {
        console.log('🔦 ❌ CRITICAL: Failed to access torch-capable camera');
        console.log('🔦 ❌ Will NOT fallback to facingMode (might lose torch capability)');
        const errorMsg = 'Failed to access the torch-capable camera. Cannot proceed with back-side scan without flashlight.';
        if (onPermissionDenied) {
          onPermissionDenied('TORCH_CAMERA_ACCESS_FAILED', errorMsg);
        }
        throw new Error('TORCH_CAMERA_ACCESS_FAILED: ' + errorMsg);
      }
      
      // If specific device failed for non-torch scenarios, try fallback to facingMode
      if (bestCamera.deviceId && scanSide === 'front') {
        console.log('🔄 Retrying with facingMode fallback...');
        const fallbackConstraints = {
          video: { 
            width: { ideal: 1280, min: 640, max: 1920 },
            height: { ideal: 720, min: 480, max: 1080 },
            facingMode: 'user'
          } 
        };
        
        try {
          stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
          console.log('✅ Fallback to facingMode succeeded');
          // Reset selected camera info since we're using fallback
          selectedCameraDeviceId = null;
          selectedCameraLabel = 'fallback';
          selectedCameraHasTorch = false;
        } catch (fallbackError) {
          console.error('❌ Fallback also failed:', fallbackError);
          throw getUserMediaError; // Throw original error
        }
      } else {
        // Handle specific WebView errors
        if (getUserMediaError.name === 'NotAllowedError') {
          console.log('🚫 Camera permission denied by user');
          if (onPermissionDenied) {
            onPermissionDenied('PERMISSION_DENIED');
          }
          throw new Error('PERMISSION_DENIED');
        } else if (getUserMediaError.name === 'NotFoundError') {
          console.log('📹 No camera device found');
          if (onPermissionDenied) {
            onPermissionDenied('NO_CAMERA');
          }
          throw new Error('NO_CAMERA');
        } else if (getUserMediaError.name === 'NotReadableError') {
          console.log('📹 Camera in use by another application');
          if (onPermissionDenied) {
            onPermissionDenied('CAMERA_IN_USE');
          }
          throw new Error('CAMERA_IN_USE');
        } else {
          console.log('❌ Generic camera error:', getUserMediaError.message);
          if (onPermissionDenied) {
            onPermissionDenied('GENERIC_ERROR');
          }
          throw new Error('CAMERA_ACCESS_FAILED');
        }
      }
    }

    // Step 6: Validate stream
    if (!stream || !stream.active) {
      console.error('❌ Invalid stream received');
      if (onPermissionDenied) {
        onPermissionDenied('INVALID_STREAM');
      }
      throw new Error('INVALID_STREAM');
    }

    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) {
      console.error('❌ No video tracks in stream');
      stream.getTracks().forEach(track => track.stop());
      if (onPermissionDenied) {
        onPermissionDenied('NO_VIDEO_TRACK');
      }
      throw new Error('NO_VIDEO_TRACK');
    }

    // Store selected camera info
    const activeTrack = videoTracks[0];
    selectedCameraDeviceId = bestCamera.deviceId || activeTrack.getSettings()?.deviceId || null;
    selectedCameraLabel = activeTrack.label || bestCamera.label || 'Unknown Camera';
    
    // Check torch support on the actual active stream
    const capabilities = activeTrack.getCapabilities();
    selectedCameraHasTorch = capabilities && 'torch' in capabilities;

    console.log('✅ Camera stream obtained:', {
      trackCount: videoTracks.length,
      trackLabel: selectedCameraLabel,
      trackState: activeTrack.readyState,
      streamActive: stream.active,
      hasTorch: selectedCameraHasTorch,
      scanSide: scanSide,
      capabilities: capabilities
    });
    
    // CRITICAL VERIFICATION: For back-side scan, ensure torch is available (unless in TEST_MODE)
    if (scanSide === 'back' && !selectedCameraHasTorch) {
      if (TEST_MODE) {
        console.log('🧪 TEST MODE: Skipping torch verification on active stream');
        console.log('🧪 Stream obtained without torch capability - allowed for testing');
      } else {
        console.log('🔦 ❌ CRITICAL VERIFICATION FAILED');
        console.log('🔦 ❌ Stream obtained but camera does NOT have torch capability');
        console.log('🔦 ❌ This should not happen - stopping stream');
        
        // Stop the stream immediately
        stream.getTracks().forEach(track => track.stop());
        
        const errorMsg = 'Critical verification failed: The camera stream does not support torch/flashlight as required for back-side scanning.';
        if (onPermissionDenied) {
          onPermissionDenied('NO_TORCH_VERIFICATION_FAILED', errorMsg);
        }
        throw new Error('NO_TORCH_VERIFICATION_FAILED: ' + errorMsg);
      }
    }
    
    if (scanSide === 'back' && selectedCameraHasTorch) {
      console.log('🔦 ✅✅ VERIFICATION PASSED: Torch capability confirmed on active stream');
    }

    // Log final camera selection summary
    console.log('📷 === CAMERA SELECTION SUMMARY ===');
    console.log(`   Camera: ${selectedCameraLabel}`);
    console.log(`   Torch Support: ${selectedCameraHasTorch ? 'YES ✅' : 'NO ❌'}`);
    console.log(`   Scan Side: ${scanSide}`);
    console.log(`   Device ID: ${selectedCameraDeviceId ? selectedCameraDeviceId.substring(0, 12) + '...' : 'N/A'}`);    console.log(`   Scan Side: ${scanSide}`);
    console.log(`   Device ID: ${selectedCameraDeviceId ? selectedCameraDeviceId.substring(0, 12) + '...' : 'N/A'}`);
    console.log('===================================');

    // Step 5: Assign to video element and wait for it to be ready
    if (!videoRef.current) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('VIDEO_REF_NULL');
    }

    videoRef.current.srcObject = stream;

    // Step 6: Wait for video to be ready (crucial for WebView)
    return new Promise((resolve, reject) => {
      const video = videoRef.current;
      let resolved = false;

      const cleanup = () => {
        video.removeEventListener('loadeddata', onLoadedData);
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('error', onError);
      };

      const onLoadedData = () => {
        if (resolved) return;
        resolved = true;
        console.log('✅ Video data loaded successfully');
        cleanup();
        resolve(stream);
      };

      const onLoadedMetadata = () => {
        if (resolved) return;
        console.log('📹 Video metadata loaded:', {
          width: video.videoWidth,
          height: video.videoHeight,
          readyState: video.readyState
        });
        
        // If we have dimensions and data, we're good
        if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
          resolved = true;
          cleanup();
          resolve(stream);
        }
      };

      const onError = (error) => {
        if (resolved) return;
        resolved = true;
        console.error('❌ Video element error:', error);
        cleanup();
        // Stop stream on video error
        stream.getTracks().forEach(track => track.stop());
        reject(new Error('VIDEO_ELEMENT_ERROR'));
      };

      video.addEventListener('loadeddata', onLoadedData);
      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('error', onError);

      // Timeout for WebView environments (they can be slow)
      setTimeout(() => {
        if (resolved) return;
        
        // Check if video is actually working despite no events
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          resolved = true;
          console.log('✅ Video ready (timeout fallback)');
          cleanup();
          resolve(stream);
        } else {
          resolved = true;
          console.error('❌ Video load timeout');
          cleanup();
          stream.getTracks().forEach(track => track.stop());
          reject(new Error('VIDEO_LOAD_TIMEOUT'));
        }
      }, 15000); // Longer timeout for WebView
    });

  } catch (error) {
    console.error('❌ Camera initialization failed:', error);
    
    // Re-throw with consistent error messages
    if (error.message.startsWith('PERMISSION_') || 
        error.message.startsWith('NO_CAMERA') || 
        error.message.startsWith('CAMERA_') ||
        error.message.startsWith('VIDEO_') ||
        error.message.startsWith('INVALID_')) {
      throw error;
    }
    
    // Generic fallback
    if (onPermissionDenied) {
      onPermissionDenied('GENERIC_ERROR');
    }
    throw new Error('CAMERA_ACCESS_FAILED');
  }
};

// 🔄 RE-REQUEST CAMERA PERMISSIONS (Enhanced for WebView)
// scanSide: 'front' for front-side card scan, 'back' for back-side card scan
export const requestCameraPermissions = async (videoRef, onPermissionDenied = null, scanSide = 'back') => {
  console.log(`🔄 Re-requesting camera permissions (WebView compatible) for ${scanSide}-side scan...`);
  
  try {
    // Step 1: Clean up any existing stream
    if (videoRef.current?.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => {
        console.log('🔌 Stopping existing track:', track.kind, track.label);
        track.stop();
      });
      videoRef.current.srcObject = null;
    }
    
    // Reset selected camera tracking
    selectedCameraDeviceId = null;
    selectedCameraLabel = null;
    selectedCameraHasTorch = false;

    // Step 2: Wait for cleanup (important in WebView)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 3: Force a fresh permission check by attempting access
    console.log('🔄 Attempting fresh camera access...');
    
    // Try with minimal constraints first to trigger permission prompt
    const facingMode = scanSide === 'front' ? 'user' : 'environment';
    const testStream = await navigator.mediaDevices.getUserMedia({
      video: { 
       width: 320, 
        height: 240,
        facingMode: facingMode
      }
    });
    
    // Stop test stream immediately
    testStream.getTracks().forEach(track => track.stop());
    console.log('✅ Permission test successful');

    // Step 4: Now initialize with full constraints and camera selection
    return await initializeCamera(videoRef, onPermissionDenied, scanSide);
    
  } catch (error) {
    console.error('❌ Camera permission re-request failed:', error);
    
    if (error.name === 'NotAllowedError') {
      if (onPermissionDenied) {
        onPermissionDenied('PERMISSION_DENIED');
      }
      throw new Error('PERMISSION_DENIED');
    }
    
    throw error;
  }
};

// 🔦 CHECK TORCH SUPPORT (Enhanced for multi-camera)
export const checkTorchSupport = async (videoRef) => {
  try {
    // First check our tracked selection
    if (selectedCameraHasTorch) {
      console.log('🔦 Torch supported (from camera selection)');
      return true;
    }
    
    if (!videoRef.current?.srcObject) {
      console.log('🔦 No video stream available for torch check');
      return false;
    }

    const stream = videoRef.current.srcObject;
    const videoTrack = stream.getVideoTracks()[0];
    
    if (!videoTrack) {
      console.log('🔦 No video track found');
      return false;
    }

    // Don't trust capabilities API - actually test torch
    const capabilities = videoTrack.getCapabilities();
    console.log('🔦 Checking torch support (will test actual functionality)...');
    
    let actualTorchSupport = false;
    try {
      // Try to enable torch briefly
      await videoTrack.applyConstraints({
        advanced: [{ torch: true }]
      });
      
      const settings = videoTrack.getSettings();
      actualTorchSupport = settings.torch === true;
      
      // Turn it back off
      if (actualTorchSupport) {
        await videoTrack.applyConstraints({
          advanced: [{ torch: false }]
        });
      }
    } catch (error) {
      console.log('🔦 Torch test failed:', error.message);
      actualTorchSupport = false;
    }
    
    selectedCameraHasTorch = actualTorchSupport;
    
    console.log('🔦 Torch capability check:', {
      supported: actualTorchSupport,
      cameraLabel: videoTrack.label || selectedCameraLabel || 'Unknown',
      capabilitiesReported: capabilities?.torch,
      actualTest: actualTorchSupport ? 'WORKS' : 'FAILED'
    });
    
    return actualTorchSupport;
  } catch (error) {
    console.error('❌ Error checking torch support:', error);
    return false;
  }
};

// 🔦 ENABLE TORCH/FLASHLIGHT (Enhanced for multi-camera reliability)
export const enableTorch = async (videoRef) => {
  try {
    // 📱 Skip torch operations on iOS - it causes zoom issues
    if (isIOSDevice()) {
      console.log('📱 iOS device detected - skipping torch enable to avoid zoom issues');
      return { success: false, reason: 'iOS_SKIPPED', iosDevice: true };
    }

    console.log('🔦 Attempting to enable torch...');
    console.log(`🔦 Selected camera: ${selectedCameraLabel || 'Unknown'}, Expected torch: ${selectedCameraHasTorch}`);
    
    if (!videoRef.current?.srcObject) {
      console.warn('⚠️ No video stream available');
      return { success: false, reason: 'NO_STREAM' };
    }

    const stream = videoRef.current.srcObject;
    const videoTrack = stream.getVideoTracks()[0];
    
    if (!videoTrack) {
      console.warn('⚠️ No video track found');
      return { success: false, reason: 'NO_TRACK' };
    }

    // Log current track info for debugging
    console.log('🔦 Current video track:', {
      label: videoTrack.label,
      readyState: videoTrack.readyState,
      muted: videoTrack.muted,
      enabled: videoTrack.enabled
    });

    // Check if torch is supported
    const capabilities = videoTrack.getCapabilities();
    const hasTorch = capabilities && 'torch' in capabilities;
    
    if (!hasTorch) {
      console.warn('⚠️ Torch not supported on current camera:', videoTrack.label);
      console.warn('⚠️ Available capabilities:', capabilities ? Object.keys(capabilities) : 'none');
      
      const result = { success: false, reason: 'NOT_SUPPORTED', cameraLabel: videoTrack.label };
      
      // Log to server
      await logToServer('torch-test', 'Torch not supported', {
        camera: {
          label: videoTrack.label,
          deviceId: selectedCameraDeviceId
        },
        torchResult: result
      });
      
      // On Samsung devices, try switching to a torch-capable camera
      if (isSamsungDevice()) {
        console.log('📱 Samsung device detected - torch may be on a different camera lens');
      }
      
      return { success: false, reason: 'NOT_SUPPORTED', cameraLabel: videoTrack.label };
    }

    // 🔒 CRITICAL: Lock camera device to prevent iOS from switching lenses
    // Re-apply device constraint WITH torch to keep same camera active
    const currentDeviceId = selectedCameraDeviceId || videoTrack.getSettings()?.deviceId;
    
    if (currentDeviceId) {
      console.log('🔒 Locking camera device during torch enable:', currentDeviceId.substring(0, 12) + '...');
    }
    
    // Try to apply torch constraint using multiple methods for better compatibility
    
    // Method 1: Advanced constraints with device lock (most compatible)
    try {
      const constraints = {
        advanced: [{ torch: true }]
      };
      
      // Add device lock if we have deviceId
      if (currentDeviceId) {
        constraints.deviceId = { exact: currentDeviceId };
      }
      
      await videoTrack.applyConstraints(constraints);
      
      // Verify torch is actually enabled
      const settings = videoTrack.getSettings();
      if (settings.torch === true) {
        console.log('✅ Torch enabled successfully via advanced constraints');
        console.log(`🔦 Camera: ${videoTrack.label}`);
        console.log(`🔒 Device locked: ${settings.deviceId?.substring(0, 12)}...`);
        
        const result = { success: true, method: 'advanced', cameraLabel: videoTrack.label };
        
        // Log success to server
        await logToServer('success', 'Torch enabled successfully', {
          camera: {
            label: videoTrack.label,
            deviceId: selectedCameraDeviceId
          },
          torchResult: result
        });
        
        return result;
      }
    } catch (advancedError) {
      console.warn('⚠️ Advanced torch constraint failed:', advancedError.message);
    }
    
    // Method 2: Basic constraint (fallback)
    try {
      await videoTrack.applyConstraints({
        torch: true
      });
      
      const settings = videoTrack.getSettings();
      if (settings.torch === true) {
        console.log('✅ Torch enabled successfully via basic constraint');
        console.log(`🔦 Camera: ${videoTrack.label}`);
        
        const result = { success: true, method: 'basic', cameraLabel: videoTrack.label };
        
        // Log success to server
        await logToServer('success', 'Torch enabled (basic method)', {
          camera: {
            label: videoTrack.label,
            deviceId: selectedCameraDeviceId
          },
          torchResult: result
        });
        
        return result;
      }
    } catch (basicError) {
      console.warn('⚠️ Basic torch constraint failed:', basicError.message);
    }
    
    // Method 3: Try with ImageCapture API (some devices support this better)
    if ('ImageCapture' in window) {
      try {
        const imageCapture = new ImageCapture(videoTrack);
        const photoCapabilities = await imageCapture.getPhotoCapabilities();
        
        if (photoCapabilities.fillLightMode && photoCapabilities.fillLightMode.includes('flash')) {
          console.log('🔦 ImageCapture flash mode available, but torch control may differ');
        }
      } catch (icError) {
        console.warn('⚠️ ImageCapture API check failed:', icError.message);
      }
    }
    
    // Final verification
    const finalSettings = videoTrack.getSettings();
    if (finalSettings.torch === true) {
      console.log('✅ Torch appears to be enabled (verified via settings)');
      
      const result = { success: true, method: 'verified', cameraLabel: videoTrack.label };
      
      await logToServer('success', 'Torch enabled (verified)', {
        camera: {
          label: videoTrack.label,
          deviceId: selectedCameraDeviceId
        },
        torchResult: result
      });
      
      return result;
    }
    
    console.error('❌ All torch enable methods failed');
    const failResult = { success: false, reason: 'ALL_METHODS_FAILED', cameraLabel: videoTrack.label };
    
    // Log failure to server
    await logToServer('error', 'All torch enable methods failed', {
      camera: {
        label: videoTrack.label,
        deviceId: selectedCameraDeviceId
      },
      torchResult: failResult
    });
    
    return failResult;
    
  } catch (error) {
    console.error('❌ Error enabling torch:', error);
    
    // Log error to server
    await logToServer('error', 'Torch enable error', {
      error: error.message
    });
    
    return { success: false, reason: 'ERROR', error: error.message };
  }
};

// 🔦 DISABLE TORCH/FLASHLIGHT (Enhanced)
export const disableTorch = async (videoRef) => {
  try {
    // 📱 Skip torch operations on iOS - it causes zoom issues
    if (isIOSDevice()) {
      console.log('📱 iOS device detected - skipping torch disable');
      return { success: true, reason: 'iOS_SKIPPED', iosDevice: true };
    }

    console.log('🔦 Disabling torch...');
    
    if (!videoRef.current?.srcObject) {
      return { success: true, reason: 'NO_STREAM' };
    }

    const stream = videoRef.current.srcObject;
    const videoTrack = stream.getVideoTracks()[0];
    
    if (!videoTrack) {
      return { success: true, reason: 'NO_TRACK' };
    }

    // Check current torch state first
    const settings = videoTrack.getSettings();
    if (settings.torch === false || settings.torch === undefined) {
      console.log('🔦 Torch already off');
      return { success: true, reason: 'ALREADY_OFF' };
    }

    // 🔒 CRITICAL: Lock camera device to prevent iOS from switching lenses when disabling torch
    const currentDeviceId = selectedCameraDeviceId || videoTrack.getSettings()?.deviceId;
    
    if (currentDeviceId) {
      console.log('🔒 Locking camera device during torch disable:', currentDeviceId.substring(0, 12) + '...');
    }
    
    // Try to disable torch
    try {
      const constraints = {
        advanced: [{ torch: false }]
      };
      
      // Add device lock if we have deviceId
      if (currentDeviceId) {
        constraints.deviceId = { exact: currentDeviceId };
      }
      
      await videoTrack.applyConstraints(constraints);
      
      // Verify the device didn't change
      const settings = videoTrack.getSettings();
      console.log('✅ Torch disabled successfully');
      console.log(`🔒 Device still locked: ${settings.deviceId?.substring(0, 12)}...`);
      
      return { success: true };
    } catch (advancedError) {
      console.warn('⚠️ Advanced torch disable failed, trying basic:', advancedError.message);
      
      try {
        const constraints = { torch: false };
        if (currentDeviceId) {
          constraints.deviceId = { exact: currentDeviceId };
        }
        
        await videoTrack.applyConstraints(constraints);
        console.log('✅ Torch disabled via basic constraint');
        return { success: true, method: 'basic' };
      } catch (basicError) {
        console.warn('⚠️ Basic torch disable also failed:', basicError.message);
        return { success: false, error: basicError.message };
      }
    }
  } catch (error) {
    console.error('❌ Error in disableTorch:', error);
    return { success: false, error: error.message };
  }
};

// �📹 CHECK IF CAMERA IS WORKING (Enhanced)
export const isCameraWorking = (videoRef) => {
  if (!videoRef.current) {
    console.log('📹 Video ref is null');
    return false;
  }

  const video = videoRef.current;
  
  // Check if video has a source
  if (!video.srcObject) {
    console.log('📹 No video source object');
    return false;
  }

  // Check if stream is active
  const stream = video.srcObject;
  if (!stream.active) {
    console.log('📹 Stream is not active');
    return false;
  }

  const tracks = stream.getTracks();
  if (tracks.length === 0) {
    console.log('📹 No tracks found in stream');
    return false;
  }

  const videoTrack = tracks.find(track => track.kind === 'video');
  if (!videoTrack) {
    console.log('📹 No video track found');
    return false;
  }

  if (videoTrack.readyState !== 'live') {
    console.log('📹 Video track is not live:', videoTrack.readyState);
    return false;
  }

  // Check video dimensions
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    console.log('📹 Video has no dimensions');
    return false;
  }

  // Check if video is ready
  if (video.readyState < 2) {
    console.log('📹 Video not ready:', video.readyState);
    return false;
  }

  console.log('✅ Camera is working properly');
  return true;
};

// 🎯 FRAME CAPTURE FUNCTION (unchanged - already good)
export const captureFrame = (videoRef, canvasRef) => {
  return new Promise((resolve, reject) => {
    try {
      // 🔒 CHECK CAPTURE LOCK: Wait for current capture to complete instead of rejecting
      if (isCapturing) {
        console.log('⏳ Frame capture in progress - waiting for completion...');
        
        // Wait for current capture to complete, then try again
        const waitForCapture = () => {
          if (!isCapturing) {
            // Retry the capture
            captureFrameInternal(videoRef, canvasRef, resolve, reject);
          } else {
            // Wait a bit more and check again
            setTimeout(waitForCapture, 100);
          }
        };
        
        setTimeout(waitForCapture, 100);
        return;
      }
      
      // Start the actual capture
      captureFrameInternal(videoRef, canvasRef, resolve, reject);
      
    } catch (error) {
      // 🔓 RELEASE CAPTURE LOCK on error
      isCapturing = false;
      console.error('❌ Frame capture error:', error);
      reject(error);
    }
  });
};

// 🎨 INTERNAL CAPTURE FUNCTION (unchanged)
const captureFrameInternal = (videoRef, canvasRef, resolve, reject) => {
  try {
    // 🔓 SET CAPTURE LOCK
    isCapturing = true;
    
    if (!videoRef.current || !canvasRef.current) {
      console.log('⚠️ Video or canvas reference is null - likely due to component cleanup');
      isCapturing = false; // Release lock
      reject(new Error('Video or canvas reference is null'));
      return;
    }
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Check if video is ready
    if (video.readyState < 2) {
      console.log('⚠️ Video not ready for capture');
      isCapturing = false; // Release lock
      reject(new Error('Video not ready for capture'));
      return;
    }
    
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      console.log('⚠️ Video has no dimensions');
      isCapturing = false; // Release lock
      reject(new Error('Video has no dimensions')); 
      return;
    }
    
    const ctx = canvas.getContext('2d');
    
  canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
 
    
    // 🎨 DRAW VIDEO FRAME to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // 🔄 CONVERT CANVAS to blob (async operation)
    canvas.toBlob((blob) => {
      // 🔓 RELEASE CAPTURE LOCK
      isCapturing = false;
      
      if (blob && blob.size > 0) {
        console.log(`✅ Frame capture completed: ${blob.size} bytes, type: ${blob.type}`);
        resolve(blob);
      } else {
        console.error('❌ Failed to create blob from canvas');
        reject(new Error('Failed to create blob from canvas'));
      }
    }, 'image/jpeg', 0.9); // High quality JPEG
    
  } catch (error) {
    // 🔓 RELEASE CAPTURE LOCK on error
    isCapturing = false;
    console.error('❌ Frame capture internal error:', error);
    reject(error);
  }
};

// 🧹 CLEANUP CAMERA STREAM (Enhanced)
export const cleanupCamera = async (videoRef) => {
  try {
    if (videoRef.current?.srcObject) {
      // 🔦 Disable torch before cleanup
      try {
        await disableTorch(videoRef);
      } catch (torchError) {
        console.warn('⚠️ Error disabling torch during cleanup:', torchError);
      }
      
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => {
        console.log('🔌 Stopping track:', track.kind, track.label || 'Unknown');
        track.stop();
      });
      videoRef.current.srcObject = null;
    }
    
    // 🔓 RESET CAPTURE LOCK on cleanup
    isCapturing = false;
    
    // Reset selected camera tracking
    selectedCameraDeviceId = null;
    selectedCameraLabel = null;
    selectedCameraHasTorch = false;
    
    console.log('📹 Camera cleanup completed and capture lock reset');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    isCapturing = false;
  }
};

// 🔓 RESET CAPTURE LOCK
export const resetCaptureState = () => {
  isCapturing = false;
  console.log('🔄 Capture state reset manually');
};

// � FRAME CROPPING UTILITIES

/**
 * Get the crop coordinates for the card border area
 * Maps the white border position to video coordinates
 */
export const getCropCoordinates = (videoRef) => {
  try {
    const video = videoRef.current;
    const borderElement = document.getElementById('card-border-frame');
    
    if (!video || !borderElement) {
      console.warn('⚠️ Video or border element not found');
      return null;
    }

    // Get video element's position and size on screen
    const videoRect = video.getBoundingClientRect();
    
    // Get border element's position and size on screen
    const borderRect = borderElement.getBoundingClientRect();
    
    // Validate that elements have dimensions
    if (videoRect.width === 0 || videoRect.height === 0) {
      console.warn('⚠️ Video element has no screen dimensions:', videoRect);
      return null;
    }
    
    if (borderRect.width === 0 || borderRect.height === 0) {
      console.warn('⚠️ Border element has no screen dimensions:', borderRect);
      return null;
    }
    
    // Calculate border position relative to video element (in screen pixels)
    const relativeX = borderRect.left - videoRect.left;
    const relativeY = borderRect.top - videoRect.top;
    const relativeWidth = borderRect.width;
    const relativeHeight = borderRect.height;
    
    // Validate relative position is within video bounds
    if (relativeX < 0 || relativeY < 0 || 
        relativeX >= videoRect.width || relativeY >= videoRect.height) {
      console.warn('⚠️ Border is outside video element bounds:', {
        relativeX, relativeY, videoRect
      });
      return null;
    }
    
    // Get actual video dimensions (native resolution)
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    
    if (videoWidth === 0 || videoHeight === 0) {
      console.warn('⚠️ Video has no native dimensions:', { videoWidth, videoHeight });
      return null;
    }
    
    // Calculate scale factors (screen pixels to video pixels)
    const scaleX = videoWidth / videoRect.width;
    const scaleY = videoHeight / videoRect.height;
    
    // Map border coordinates to video coordinates
    const cropX = Math.round(relativeX * scaleX);
    const cropY = Math.round(relativeY * scaleY);
    const cropWidth = Math.round(relativeWidth * scaleX);
    const cropHeight = Math.round(relativeHeight * scaleY);
    
    // 📏 REDUCE ZOOM: Add padding around the crop area (50% less zoom)
    // Instead of cropping exactly at the border, expand outward to capture more context
    const paddingPercent = 0.09; // Add 13% padding on each side
    const paddingX = Math.round(cropWidth * paddingPercent);
    const paddingY = Math.round(cropHeight * paddingPercent);
    
    const expandedCropX = cropX - paddingX;
    const expandedCropY = cropY - paddingY;
    const expandedCropWidth = cropWidth + (paddingX * 2);
    const expandedCropHeight = cropHeight + (paddingY * 2);
    
    // Ensure crop area is within video bounds and has positive dimensions
    const finalCropX = Math.max(0, Math.min(expandedCropX, videoWidth - 1));
    const finalCropY = Math.max(0, Math.min(expandedCropY, videoHeight - 1));
    const finalCropWidth = Math.max(1, Math.min(expandedCropWidth, videoWidth - finalCropX));
    const finalCropHeight = Math.max(1, Math.min(expandedCropHeight, videoHeight - finalCropY));
    
    console.log('📐 Crop coordinates calculated (with 15% padding to reduce zoom):', {
      screen: { x: relativeX, y: relativeY, w: relativeWidth, h: relativeHeight },
      video: { width: videoWidth, height: videoHeight },
      scale: { x: scaleX, y: scaleY },
      original: { x: cropX, y: cropY, w: cropWidth, h: cropHeight },
      padding: { x: paddingX, y: paddingY },
      expanded: { x: finalCropX, y: finalCropY, w: finalCropWidth, h: finalCropHeight }
    });
    
    return {
      x: finalCropX,
      y: finalCropY,
      width: finalCropWidth,
      height: finalCropHeight
    };
  } catch (error) {
    console.error('❌ Error calculating crop coordinates:', error);
    return null;
  }
};

/**
 * Capture and crop frame to only the card border area
 * Returns both blob and data URL of the cropped image
 */
export const captureCroppedFrame = async (videoRef, canvasRef, debugDownload = false) => {
  return new Promise((resolve, reject) => {
    try {
      if (!videoRef.current || !canvasRef.current) {
        reject(new Error('Video or canvas reference is null'));
        return;
      }
      
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // Check if video is ready
      if (video.readyState < 2) {
        reject(new Error('Video not ready for capture'));
        return;
      }
      
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        reject(new Error('Video has no dimensions'));
        return;
      }
      
      // Get crop coordinates
      const cropCoords = getCropCoordinates(videoRef);
      
      if (!cropCoords) {
        console.warn('⚠️ Could not get crop coordinates, using full frame');
        // Fallback to full frame
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
      } else {
        // Validate crop dimensions before proceeding
        if (cropCoords.width <= 0 || cropCoords.height <= 0) {
          console.error('❌ Invalid crop dimensions:', cropCoords);
          reject(new Error('Invalid crop dimensions'));
          return;
        }
        
        // Set canvas to crop dimensions
        canvas.width = cropCoords.width;
        canvas.height = cropCoords.height;
        
        const ctx = canvas.getContext('2d');
        
        // Clear canvas first
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw only the cropped region from video
        // ctx.drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
        ctx.drawImage(
          video,
          cropCoords.x,      // source x (where to start in video)
          cropCoords.y,      // source y
          cropCoords.width,  // source width (how much to take from video)
          cropCoords.height, // source height
          0,                 // destination x (where to place on canvas)
          0,                 // destination y
          cropCoords.width,  // destination width (canvas size)
          cropCoords.height  // destination height
        );
        
        console.log('✅ Frame cropped to card border area:', {
          original: { w: video.videoWidth, h: video.videoHeight },
          cropped: { w: cropCoords.width, h: cropCoords.height }
        });
      }
      
      // Validate canvas has content
      if (canvas.width === 0 || canvas.height === 0) {
        reject(new Error('Canvas has invalid dimensions'));
        return;
      }
      
      // Get data URL for immediate display
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      
      // 🐛 DEBUG: Download frame for verification if requested
      if (debugDownload) {
        downloadDebugFrame(dataUrl, cropCoords);
      }
      
      // Convert to blob for API with timeout
      let blobCreated = false;
      const blobTimeout = setTimeout(() => {
        if (!blobCreated) {
          reject(new Error('Frame creation timeout'));
        }
      }, 5000); // 5 second timeout
      
      canvas.toBlob((blob) => {
        blobCreated = true;
        clearTimeout(blobTimeout);
        
        if (blob && blob.size > 0) {
          console.log(`✅ Cropped frame ready: ${blob.size} bytes`);
          resolve({ blob, dataUrl, cropCoords });
        } else {
          reject(new Error('Failed to create frame from the screen'));
        }
      }, 'image/jpeg', 0.95);
      
    } catch (error) {
      console.error('❌ Frame crop error:', error);
      reject(error);
    }
  });
};

/**
 * 🐛 DEBUG: Download frame to device for verification
 * This should be removed before production deployment
 */
let debugFrameCount = 0;
const MAX_DEBUG_FRAMES = 2; // Only download first 2 frames

export const downloadDebugFrame = (dataUrl, cropCoords) => {
  if (debugFrameCount >= MAX_DEBUG_FRAMES) {
    return; // Stop after 2 frames
  }
  
  debugFrameCount++;
  
  try {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `cropped-frame-${debugFrameCount}-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log(`🐛 DEBUG: Downloaded frame ${debugFrameCount}/${MAX_DEBUG_FRAMES}`, cropCoords);
    
    if (debugFrameCount === MAX_DEBUG_FRAMES) {
      console.log('🐛 DEBUG: Maximum debug frames reached. No more downloads will occur.');
    }
  } catch (error) {
    console.error('❌ Error downloading debug frame:', error);
  }
};

/**
 * Reset debug frame counter (call this when starting a new scan session)
 */
export const resetDebugFrameCount = () => {
  debugFrameCount = 0;
  console.log('🔄 Debug frame counter reset');
};

// 🔧 DIAGNOSTIC UTILITIES (Enhanced with multi-camera info)
export const getCameraDiagnostics = async (videoRef = null) => {
  const info = {
    isWebView: isWebView(),
    isSamsung: isSamsungDevice(),
    userAgent: navigator.userAgent,
    hasMediaDevices: 'mediaDevices' in navigator,
    hasGetUserMedia: 'getUserMedia' in (navigator.mediaDevices || {}),
    hasPermissions: 'permissions' in navigator,
    hasEnumerateDevices: 'enumerateDevices' in (navigator.mediaDevices || {}),
    selectedCamera: {
      deviceId: selectedCameraDeviceId ? selectedCameraDeviceId.substring(0, 12) + '...' : null,
      label: selectedCameraLabel,
      hasTorch: selectedCameraHasTorch
    }
  };
  
  try {
    info.permissionStatus = await checkCameraPermissions();
  } catch (error) {
    info.permissionError = error.message;
  }
  
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(d => d.kind === 'videoinput');
      info.cameraCount = cameras.length;
      info.cameras = cameras.map(cam => ({
        label: cam.label || 'Unknown',
        deviceId: cam.deviceId ? cam.deviceId.substring(0, 8) + '...' : 'N/A',
        facing: classifyCameraFacing(cam)
      }));
    }
  } catch (error) {
    info.deviceEnumError = error.message;
  }
  
  // 🔦 Check torch support if videoRef is provided
  if (videoRef) {
    try {
      info.torchSupported = await checkTorchSupport(videoRef);
      
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject;
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const capabilities = videoTrack.getCapabilities();
          info.torchCapabilities = capabilities?.torch || null;
          info.currentTrackLabel = videoTrack.label;
          const settings = videoTrack.getSettings();
          info.torchEnabled = settings?.torch || false;
          info.deviceId = settings?.deviceId ? settings.deviceId.substring(0, 8) + '...' : 'N/A';
        }
      }
    } catch (error) {
      info.torchError = error.message;
    }
  }
  
  console.log('🔧 Camera Diagnostics:', info);
  return info;
};

// 🔄 SWITCH CAMERA (utility to switch between front/back cameras)
export const switchCamera = async (videoRef, targetSide = 'back', onPermissionDenied = null) => {
  console.log(`🔄 Switching to ${targetSide} camera...`);
  
  try {
    // Cleanup current camera
    await cleanupCamera(videoRef);
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Initialize with new camera
    return await initializeCamera(videoRef, onPermissionDenied, targetSide);
  } catch (error) {
    console.error('❌ Error switching camera:', error);
    throw error;
  }
};