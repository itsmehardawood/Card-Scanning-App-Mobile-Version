

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
 */

// Camera Utilities for Card Detection

// 🔒 CAPTURE LOCK: Prevents multiple simultaneous frame captures
let isCapturing = false;

// 🔍 WEBVIEW DETECTION
const isWebView = () => {
  const userAgent = navigator.userAgent;
  const isIOSWebView = /iPhone|iPad|iPod/.test(userAgent) && (/Version\//.test(userAgent) || window.webkit);
  const isAndroidWebView = /Android/.test(userAgent) && (/wv/.test(userAgent) || window.AndroidInterface);
  
  return isIOSWebView || isAndroidWebView || window.ReactNativeWebView !== undefined;
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

// 🎯 ENHANCED CAMERA INITIALIZATION WITH WEBVIEW SUPPORT
export const initializeCamera = async (videoRef, onPermissionDenied = null) => {
  try {
    console.log('📹 Starting camera initialization...');
    console.log('📱 WebView environment:', isWebView());
    
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

    // Step 3: Attempt camera access (this will trigger permission prompt if needed)
    console.log('📹 Requesting camera access...');
    
    const constraints = {
      video: { 
        width: { ideal: 1280, min: 640, max: 1920 },
        height: { ideal: 720, min: 480, max: 1080 },
        facingMode: 'environment'
      } 
    };

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (getUserMediaError) {
      console.error('❌ getUserMedia failed:', getUserMediaError);
      
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

    // Step 4: Validate stream
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

    console.log('✅ Camera stream obtained:', {
      trackCount: videoTracks.length,
      trackLabel: videoTracks[0].label || 'Unknown Camera',
      trackState: videoTracks[0].readyState,
      streamActive: stream.active
    });

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
export const requestCameraPermissions = async (videoRef, onPermissionDenied = null) => {
  console.log('🔄 Re-requesting camera permissions (WebView compatible)...');
  
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

    // Step 2: Wait for cleanup (important in WebView)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 3: Force a fresh permission check by attempting access
    console.log('🔄 Attempting fresh camera access...');
    
    // Try with minimal constraints first to trigger permission prompt
    const testStream = await navigator.mediaDevices.getUserMedia({
      video: { 
       width: 320, 
        height: 240,
        facingMode: 'environment'
      }
    });
    
    // Stop test stream immediately
    testStream.getTracks().forEach(track => track.stop());
    console.log('✅ Permission test successful');

    // Step 4: Now initialize with full constraints
    return await initializeCamera(videoRef, onPermissionDenied);
    
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

// � CHECK TORCH SUPPORT
export const checkTorchSupport = async (videoRef) => {
  try {
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

    const capabilities = videoTrack.getCapabilities();
    const hasTorch = capabilities && 'torch' in capabilities;
    
    console.log('🔦 Torch capability check:', {
      supported: hasTorch,
      capabilities: capabilities
    });
    
    return hasTorch;
  } catch (error) {
    console.error('❌ Error checking torch support:', error);
    return false;
  }
};

// 🔦 ENABLE TORCH/FLASHLIGHT
export const enableTorch = async (videoRef) => {
  try {
    console.log('🔦 Attempting to enable torch...');
    
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

    // Check if torch is supported
    const capabilities = videoTrack.getCapabilities();
    const hasTorch = capabilities && 'torch' in capabilities;
    
    if (!hasTorch) {
      console.warn('⚠️ Torch not supported on this device');
      return { success: false, reason: 'NOT_SUPPORTED' };
    }

    // Try to apply torch constraint
    try {
      await videoTrack.applyConstraints({
        advanced: [{ torch: true }]
      });
      
      console.log('✅ Torch enabled successfully via advanced constraints');
      return { success: true, method: 'advanced' };
    } catch (advancedError) {
      console.warn('⚠️ Advanced torch constraint failed:', advancedError.message);
      
      // Fallback: Try basic constraint
      try {
        await videoTrack.applyConstraints({
          torch: true
        });
        
        console.log('✅ Torch enabled successfully via basic constraint');
        return { success: true, method: 'basic' };
      } catch (basicError) {
        console.error('❌ Basic torch constraint failed:', basicError.message);
        return { success: false, reason: 'CONSTRAINT_FAILED', error: basicError.message };
      }
    }
  } catch (error) {
    console.error('❌ Error enabling torch:', error);
    return { success: false, reason: 'ERROR', error: error.message };
  }
};

// 🔦 DISABLE TORCH/FLASHLIGHT
export const disableTorch = async (videoRef) => {
  try {
    console.log('🔦 Disabling torch...');
    
    if (!videoRef.current?.srcObject) {
      return { success: true, reason: 'NO_STREAM' };
    }

    const stream = videoRef.current.srcObject;
    const videoTrack = stream.getVideoTracks()[0];
    
    if (!videoTrack) {
      return { success: true, reason: 'NO_TRACK' };
    }

    // Try to disable torch
    try {
      await videoTrack.applyConstraints({
        advanced: [{ torch: false }]
      });
      console.log('✅ Torch disabled successfully');
      return { success: true };
    } catch (error) {
      console.warn('⚠️ Error disabling torch:', error.message);
      return { success: false, error: error.message };
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
    
    // console.log('📷 Starting frame capture:', {
    //   videoWidth: video.videoWidth,
    //   videoHeight: video.videoHeight,
    //   canvasWidth: canvas.width,
    //   canvasHeight: canvas.height,
    //   isCapturing: true
    // });
    
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
    
    // Ensure crop area is within video bounds and has positive dimensions
    const finalCropX = Math.max(0, Math.min(cropX, videoWidth - 1));
    const finalCropY = Math.max(0, Math.min(cropY, videoHeight - 1));
    const finalCropWidth = Math.max(1, Math.min(cropWidth, videoWidth - finalCropX));
    const finalCropHeight = Math.max(1, Math.min(cropHeight, videoHeight - finalCropY));
    
    console.log('📐 Crop coordinates calculated:', {
      screen: { x: relativeX, y: relativeY, w: relativeWidth, h: relativeHeight },
      video: { width: videoWidth, height: videoHeight },
      scale: { x: scaleX, y: scaleY },
      crop: { x: finalCropX, y: finalCropY, w: finalCropWidth, h: finalCropHeight }
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

// 🔧 DIAGNOSTIC UTILITIES
export const getCameraDiagnostics = async (videoRef = null) => {
  const info = {
    isWebView: isWebView(),
    userAgent: navigator.userAgent,
    hasMediaDevices: 'mediaDevices' in navigator,
    hasGetUserMedia: 'getUserMedia' in (navigator.mediaDevices || {}),
    hasPermissions: 'permissions' in navigator,
    hasEnumerateDevices: 'enumerateDevices' in (navigator.mediaDevices || {}),
  };
  
  try {
    info.permissionStatus = await checkCameraPermissions();
  } catch (error) {
    info.permissionError = error.message;
  }
  
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      info.cameras = devices.filter(d => d.kind === 'videoinput').length;
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
          const settings = videoTrack.getSettings();
          info.torchEnabled = settings?.torch || false;
        }
      }
    } catch (error) {
      info.torchError = error.message;
    }
  }
  
  return info;
};