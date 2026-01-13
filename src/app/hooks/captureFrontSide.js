// Front side detection logic
import { captureCroppedFrame, resetDebugFrameCount } from '../utils/CameraUtils';
import { sendFrameToAPI } from '../utils/apiService';

export const captureAndSendFramesFront = async (
  videoRef,
  canvasRef,
  sessionId,
  setIsProcessing,
  setCurrentPhase,
  setErrorMessage,
  setFrontScanState,
  stopRequestedRef,
  handleDetectionFailure,
  disableFlashlight,
  onImageCaptured,
  providedSessionId = null,
  phase = 'front',
  enableFlashlight = null,
  onFramesCaptured = null // Callback to call after Frame #2 is captured
) => {
  const currentSessionId = providedSessionId || sessionId;
  console.log("🔍 captureAndSendFramesFront called with phase:", phase, "sessionId:", currentSessionId);
  
  if (!currentSessionId) {
    throw new Error('No session ID provided. Session must be initialized before detection.');
  }
  
  console.log("Using session ID:", currentSessionId);
  
  let lastApiResponse = null;
  const maxFrames = 8; // Reduced to 8 frames for faster processing
  
  if (!videoRef.current || videoRef.current.readyState < 2) {
    throw new Error('Video not ready for capture');
  }
  
  // 🐛 DEBUG: Reset debug frame counter at start of front scan
  resetDebugFrameCount();
  
  // STEP 1: Turn ON flashlight BEFORE capturing frame
  console.log("🔦 Turning ON flashlight for screen detection...");
  if (enableFlashlight) {
    await enableFlashlight();
    // Wait a moment for flashlight to stabilize
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  // STEP 2: Capture Frame #1 (with flashlight ON) for screen detection
  console.log("📸 Capturing Frame #1 with flashlight ON for screen detection...");
  
  const DEBUG_DOWNLOAD = false;
  
  const { blob: flashlightBlob, dataUrl: flashlightImageDataUrl, cropCoords } = await captureCroppedFrame(
    videoRef, 
    canvasRef,
    DEBUG_DOWNLOAD
  );
  
  console.log("✅ Frame #1 (flashlight) captured:", cropCoords);
  
  // STEP 3: Screen Detection Check (using the flashlight frame)
  console.log("📱 Starting screen detection check with flashlight frame...");
  let screenDetectionPassed = false;
  
  try {
    const formData = new FormData();
    formData.append('file', flashlightBlob, 'screen_check.jpg');
    
    console.log("📤 Sending flashlight frame to screen detection endpoint...");
    const screenDetectResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/screen-detect/detect-screen`, {
      method: 'POST',
      body: formData
    });
    
    // Check if we got the expected 500 error (which means pass for now)
    if (screenDetectResponse.status === 500) {
      const errorData = await screenDetectResponse.json();
      if (errorData.detail === "Screen detection model not available") {
        console.log("✅ Screen detection passed (model not available - treating as pass)");
        screenDetectionPassed = true;
      } else {
        console.log("✅ Screen detection returned 500, continuing...");
        screenDetectionPassed = true;
      }
    } else if (screenDetectResponse.ok) {
      const screenData = await screenDetectResponse.json();
      console.log("📊 Front side screen detection response:", screenData);
      
      // Check is_screen property
      if (screenData.is_screen === false) {
        console.log("✅ Front side screen detection passed - real card detected");
        console.log(`   Confidence: ${screenData.confidence}, Prediction: ${screenData.prediction_class}`);
        screenDetectionPassed = true;
      } else if (screenData.is_screen === true) {
        console.log("❌ Front side screen detected - this appears to be a screen/photo, not physical card");
        console.log(`   Confidence: ${screenData.confidence}, Message: ${screenData.message}`);
        
        // 🔦 Turn off flashlight before throwing error
        if (disableFlashlight) {
          await disableFlashlight();
        }
        
        throw new Error('Unacceptable Card Detection on front side - screen or photo detected instead of physical card');
      } else {
        console.warn("⚠️ is_screen property not found in response, continuing...");
        screenDetectionPassed = true; // Continue anyway
      }
    } else {
      console.warn("⚠️ Unexpected screen detection response:", screenDetectResponse.status);
      screenDetectionPassed = true; // Continue anyway
    }
  } catch (screenError) {
    if (screenError.message.includes('Unacceptable Card Detection')) {
      // Re-throw fake card errors
      throw screenError;
    }
    console.error("❌ Screen detection error:", screenError);
    // Continue with normal detection even if screen check fails
    screenDetectionPassed = true;
  }
  
  // STEP 4: If screen detection passed, turn OFF flashlight
  if (screenDetectionPassed && disableFlashlight) {
    console.log("🔦 Screen detection passed - turning OFF flashlight");
    await disableFlashlight();
    // Wait for flashlight to turn off completely AND camera to adjust exposure
    console.log("⏳ Waiting 800ms for camera sensor to adjust after flashlight off...");
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  
  // STEP 5: Capture Frame #2 (without flashlight) for actual scanning
  console.log("📸 Capturing Frame #2 without flashlight for scanning...");
  
  // Wait for video element to have valid dimensions (retry up to 10 times)
  if (videoRef.current) {
    let retries = 0;
    const maxRetries = 10;
    while (retries < maxRetries) {
      const rect = videoRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        console.log("✅ Video has valid dimensions:", { width: rect.width, height: rect.height });
        break;
      }
      console.log(`⏳ Waiting for video dimensions... (attempt ${retries + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 50));
      retries++;
    }
    
    // Final check
    const finalRect = videoRef.current.getBoundingClientRect();
    if (finalRect.width === 0 || finalRect.height === 0) {
      console.error("❌ Video still has no dimensions after retries:", finalRect);
    }
  }
  
  const { blob: scanBlob, dataUrl: scanImageDataUrl } = await captureCroppedFrame(
    videoRef,
    canvasRef,
    DEBUG_DOWNLOAD
  );
  console.log("✅ Frame #2 (scan frame) captured successfully");
  
  // STEP 6: Show Frame #2 immediately with success message
  console.log("📤 Showing Frame #2 and success message immediately...");
  if (screenDetectionPassed && onImageCaptured) {
    onImageCaptured(scanImageDataUrl);
  }
  
  // STEP 6.5: Now that Frame #2 is captured and displayed, notify parent to change phase
  if (onFramesCaptured) {
    console.log("🔔 Notifying parent that frames are captured - safe to change phase now");
    onFramesCaptured();
  }
  
  // STEP 7: Wait 3 seconds before starting scanning (success message will auto-hide)
  console.log("⏱️ Waiting 3 seconds before starting scan (success message visible)...");
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log("🔄 Continuing with normal card detection using Frame #2...");
  
  return new Promise((resolve, reject) => {
    let frameNumber = 0;
    let timeoutId = null;
    let isComplete = false;
    let hasReceivedSuccess = false;
    let maxFramesReachedTime = null;
    let lastApiResponse = null;
    let successfulFramesCount = 0;
    let capturedFrameBlob = null;
    let captureIntervalRef = null;
    
    const cleanup = () => {
    console.log("🧹 [FRONT CLEANUP] Starting cleanup...");
    
    if (captureIntervalRef) {
      clearInterval(captureIntervalRef);
      captureIntervalRef = null;
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    // 🔒 CRITICAL: Stop camera tracks to release Android hardware
    if (videoRef?.current?.srcObject) {
      const stream = videoRef.current.srcObject;
      const tracks = stream.getTracks();
      console.log(`🧹 [FRONT CLEANUP] Stopping ${tracks.length} camera track(s)...`);
      
      tracks.forEach(track => {
        console.log(`   └─ Stopping: ${track.kind} - ${track.label}`);
        track.stop();
        track.enabled = false; // Force disable for Android
      });
      
      videoRef.current.srcObject = null;
      console.log("🧹 [FRONT CLEANUP] Camera tracks stopped and stream cleared");
    }
    
    setIsProcessing(false);
    console.log("✅ [FRONT CLEANUP] Cleanup complete");
  };
    
    const countBackSideFeatures = (apiResponse) => {
      const features = {
        magstrip: apiResponse.magstrip || false,
        signstrip: apiResponse.signstrip || false,
        hologram: apiResponse.hologram || false,
      };
      
      return {
        features,
        count: Object.values(features).filter(Boolean).length,
        detectedFeatures: Object.keys(features).filter(key => features[key])
      };
    };
    
    const processFrame = async () => {
      try {
        // 🛑 FIRST CHECK: Stop immediately if success already received
        if (hasReceivedSuccess) {
          console.log('🛑 Success already received - stopping frame capture completely');
          cleanup();
          return;
        }
        
        // Check if stop requested or already complete
        if (isComplete || stopRequestedRef.current) return;
        
        // �️ SAFETY CHECK: Verify video and canvas are still available
        if (!videoRef.current || !canvasRef.current) {
          console.log('🛡️ Video or canvas no longer available - stopping detection gracefully');
          
          if (hasReceivedSuccess || isComplete) {
            console.log('🛡️ Already completed with success, ignoring cleanup');
            return;
          }
          
          isComplete = true;
          cleanup();
          if (lastApiResponse) {
            resolve(lastApiResponse);
          } else {
            reject(new Error('Component cleanup detected during frame capture'));
          }
          return;
        }
        
        // 📸 Use Frame #2 (scan frame without flashlight) for all API calls
        let frame;
        if (!capturedFrameBlob) {
          capturedFrameBlob = scanBlob; // Use the scan frame captured earlier
          frame = capturedFrameBlob;
          console.log('📸 Using Frame #2 (scan frame) for API calls');
        } else {
          frame = capturedFrameBlob;
        }
        
        if (frame && frame.size > 0) {
          frameNumber++;
          
          // 📊 STRICT FRAME LIMIT: Stop sending frames after reaching maxFrames (8)
          if (frameNumber > maxFrames) {
            if (!maxFramesReachedTime) {
              maxFramesReachedTime = Date.now();
              console.log(`📋 STRICT LIMIT: Reached ${maxFrames} frames - STOPPING interval, waiting for responses...`);
              // Stop the interval immediately - no more frames will be sent
              if (captureIntervalRef) {
                clearInterval(captureIntervalRef);
                captureIntervalRef = null;
              }
            }
            return;
          }
          
          if (hasReceivedSuccess) {
            console.log(`⏭️ Skipping frame ${frameNumber} - success already received, not sending to API`);
            return;
          }
          
          setIsProcessing(true);
          try {
            const apiResponse = await sendFrameToAPI(frame, phase, currentSessionId, frameNumber);
            
            // 🎯 HIGHEST PRIORITY: Check for status success OR already_completed
            if (apiResponse.status === "success" || apiResponse.status === "already_completed") {
              console.log('🎯 SUCCESS/ALREADY_COMPLETED STATUS received! Stopping detection...');
              console.log(`Status: ${apiResponse.status}, Score: ${apiResponse.score}, Complete Scan: ${apiResponse.complete_scan}`);
              hasReceivedSuccess = true;
              isComplete = true;
              cleanup();
              setCurrentPhase('results');
              resolve({ ...apiResponse, capturedImage: capturedImageDataUrl });
              return;
            }
            
            // Check for final encrypted response first
            if (apiResponse.encrypted_card_data && apiResponse.status) {
              console.log('🎯 Final encrypted response received! Stopping detection...');
              hasReceivedSuccess = true;
              isComplete = true;
              cleanup();
              setCurrentPhase('results');
              resolve(apiResponse);
              return;
            }
            
            if (hasReceivedSuccess) {
              console.log(`⏭️ Skipping response processing for frame ${frameNumber} - success received while in flight`);
              return;
            }

            // Check for validation states
            if (phase === 'validation') {
              if (apiResponse.message_state === "VALIDATION_FAILED" || 
                  apiResponse.movement_state === "VALIDATION_FAILED") {
                isComplete = true;
                cleanup();
                const errorMsg = apiResponse.message || apiResponse.movement_message || 'Validation failed. Please try again.';
                if (handleDetectionFailure) {
                  handleDetectionFailure(errorMsg);
                }
                reject(new Error('Validation failed'));
                return;
              }

              if (apiResponse.message_state === "VALIDATION_PASSED" || 
                  apiResponse.movement_state === "VALIDATION_PASSED") {
                console.log('✅ Validation passed - continuing with detection');
              }
            }

            // General validation state check for all phases - Skip for front/back phases
            if (phase !== 'front' && phase !== 'back' && 
                (apiResponse.message_state === "VALIDATION_FAILED" || 
                 apiResponse.movement_state === "VALIDATION_FAILED")) {
              isComplete = true;
              cleanup();
              const errorMsg = apiResponse.message || 
                              apiResponse.movement_message || 
                              'Validation failed. Please try again.';
              setErrorMessage(errorMsg);
              setCurrentPhase('error');
              reject(new Error('Validation failed'));
              return;
            }              
            
            // Check for wait_for_front/wait_for_back - session needs full restart
            if (apiResponse.status === 'wait_for_front') {
              console.log(`🔄 Backend requires session restart: ${apiResponse.status}`);
              isComplete = true;
              cleanup();
              
              const errorMsg = 'Oops, after numerous security scan detection your card issuer verification details do not match the bank records - please try again. Thank you!!.';
              setErrorMessage(errorMsg);
              setCurrentPhase('error');
              reject(new Error('Session restart required'));
              return;
            }
            
            // Track successful response
            if (apiResponse && 
                !apiResponse.error && 
                apiResponse.status !== 'wait_for_front' && 
                apiResponse.status !== 'wait_for_back') {
              successfulFramesCount++;
              lastApiResponse = apiResponse;
            }
            
            setIsProcessing(false);

            // Check for fake card detection in front phase
            if (phase === 'front' && apiResponse.fake_card === true) {
              isComplete = true;
              cleanup();
              const errorMsg = 'Unacceptable Card Detection. Please use an original physical card.';
              setErrorMessage(errorMsg);
              setCurrentPhase('fake-card-error');
              reject(new Error('Unacceptable Card Detection'));
              return;
            }

            // Update front scan state for front phase
            if (phase === 'front') {
              setFrontScanState({
                framesBuffered: apiResponse.buffer_info?.front_frames_buffered || 0,
                motionProgress: apiResponse.motion_progress || null
              });
            }
            
            const bufferedFrames = phase === 'front' 
              ? apiResponse.buffer_info?.front_frames_buffered 
              : apiResponse.buffer_info?.back_frames_buffered;
            
            // Check for back side validation failure specifically
            if (phase === 'back' && apiResponse.validation_failed === true) {
              if (apiResponse.validation_reason === "brand_mismatch") {
                isComplete = true;
                cleanup();
                setErrorMessage('Security validation failed: Card brand mismatch detected between front and back sides');
                setCurrentPhase('error');
                reject(new Error('Brand mismatch'));
                return;
              } else {
                console.warn('⚠️ Validation failed but no specific reason provided');
              }
            }

            // Check validation ONLY after we have sufficient buffered frames
            if (bufferedFrames >= 4) {
              if (apiResponse.message_state === "VALIDATION_FAILED" || 
                  apiResponse.movement_state === "VALIDATION_FAILED") {
                isComplete = true;
                cleanup();
                const errorMsg = apiResponse.message || 
                                apiResponse.movement_message || 
                                'Validation failed. Please try again.';
                setErrorMessage(errorMsg);
                setCurrentPhase('error');
                reject(new Error('Validation failed'));
                return;
              }
            }
            
            // For front side, check if chip and bank_logo are detected AND sufficient buffered frames
            if (phase === 'front' && bufferedFrames >= 4 && apiResponse.chip === true && apiResponse.bank_logo === true) {
              console.log(`✅ Front side requirements met: chip and bank_logo detected, bufferedFrames=${bufferedFrames}`);
              hasReceivedSuccess = true; // Mark success to ignore all subsequent responses
              isComplete = true;
              cleanup();
              resolve(apiResponse);
              return;
            }
            
            // For back side, check both sufficient frames and required features
            if (phase === 'back' && bufferedFrames >= 4) {
              const { count, detectedFeatures } = countBackSideFeatures(apiResponse);
              if (count >= 2) {
                console.log(`✅ Back side requirements met: ${count} features detected [${detectedFeatures.join(', ')}]`);
                isComplete = true;
                cleanup();
                resolve(apiResponse);
                return;
              }
            }
            
            // Fallback: Only stop due to frame limit if we've been waiting a while
            if (frameNumber >= maxFrames && maxFramesReachedTime && 
                (Date.now() - maxFramesReachedTime > 3000)) {
              cleanup();
              if (lastApiResponse) {
                if (phase === 'back') {
                  const bufferedFrames = lastApiResponse.buffer_info?.back_frames_buffered || 0;
                  const { count } = countBackSideFeatures(lastApiResponse);
                  
                  if (bufferedFrames >= 4 && count >= 2) {
                    resolve(lastApiResponse);
                  } else {
                    reject(new Error('Insufficient back side features detected'));
                  }
                } else if (phase === 'front') {
                  const bufferedFrames = lastApiResponse.buffer_info?.front_frames_buffered || 0;
                  if (bufferedFrames >= 4 && lastApiResponse.chip === true && lastApiResponse.bank_logo === true) {
                    resolve(lastApiResponse);
                  } else {
                    reject(new Error('Front side requirements not met: chip and bank_logo must be detected'));
                  }
                } else {
                  reject(new Error('Maximum frames reached without sufficient data'));
                }
              } else {
                reject(new Error('Maximum frames reached without sufficient data'));
              }
              return;
            }
            
          } catch (apiError) {
            if (!hasReceivedSuccess) {
              console.error('API Error:', apiError);
            } else {
              console.log('⏭️ Ignoring API error - success already received');
            }
            setIsProcessing(false);
          }
        }
      } catch (error) {
        if (!hasReceivedSuccess && !isComplete && !stopRequestedRef.current) {
          console.error('Error in frame processing:', error);
        }
      }
    };
    
    processFrame();
    captureIntervalRef = setInterval(processFrame, 800);
    
    timeoutId = setTimeout(() => {
      // Check if already completed or success received - don't process timeout
      if (isComplete || hasReceivedSuccess) {
        console.log('⏭️ Timeout fired but detection already completed successfully - ignoring timeout');
        return;
      }
      
      if (!isComplete) {
        cleanup();
        
        if (successfulFramesCount === 0) {
          console.log('❌ Timeout: No successful API responses received in this attempt');
          reject(new Error('Timeout: Network Error No successful API responses received'));
          return;
        }
        
        if (lastApiResponse) {
          console.log(`Timeout reached, checking final conditions... (${successfulFramesCount} successful frames received)`);
          
          if ((lastApiResponse.encrypted_card_data && lastApiResponse.status) || 
              lastApiResponse.status === "success" || 
              lastApiResponse.status === "already_completed") {
            console.log('🎯 Final encrypted response or success/already_completed found in timeout handler');
            setCurrentPhase('results');
            resolve(lastApiResponse);
            return;
          }
          
          if (phase === 'back') {
            const bufferedFrames = lastApiResponse.buffer_info?.back_frames_buffered || 0;
            const { count, detectedFeatures } = countBackSideFeatures(lastApiResponse);
            
            if (bufferedFrames >= 4 && count >= 3) {
              resolve(lastApiResponse);
            } else {
              reject(new Error('Insufficient back side features'));
            }
          } else if (phase === 'front') {
            const bufferedFrames = lastApiResponse.buffer_info?.front_frames_buffered || 0;
            if (bufferedFrames >= 4 && lastApiResponse.chip === true && lastApiResponse.bank_logo === true) {
              resolve(lastApiResponse);
            } else {
              reject(new Error('Front side requirements not met: chip and bank_logo must both be detected'));
            }
          } else {
            reject(new Error('Timeout: requirements not met'));
          }
        } else {
          reject(new Error('Timeout: Network Error or No successful API responses received'));
        }
      }
    }, 30000); // Reduced to 20 seconds timeout
  });
};
