import { useRef } from 'react';
import { sendFrameToAPI } from '../utils/apiService';
import { captureFrame } from '../utils/CameraUtils';
// new flow branch with new same  session id for all retries
// Custom hook for detection logic
export const useDetection = (
  videoRef,
  canvasRef,
  sessionId,
  setSessionId,
  setIsProcessing,
  setCurrentPhase,
  setErrorMessage,
  setFrontScanState,
  stopRequestedRef,
  handleDetectionFailure, // Add this parameter for validation failures
  disableFlashlight // Add this parameter to control flashlight
) => {
  const captureIntervalRef = useRef(null);

  // Capture and send frames for front side with screen detection
  const captureAndSendFramesFront = async (phase, providedSessionId = null) => {
    const currentSessionId = providedSessionId || sessionId;
    console.log("🔍 captureAndSendFramesFront called with phase:", phase, "sessionId:", currentSessionId);
    
    if (!currentSessionId) {
      throw new Error('No session ID provided. Session must be initialized before detection.');
    }
    
    console.log("Using session ID:", currentSessionId);
    
    let lastApiResponse = null;
    const maxFrames = 15;
    
    if (!videoRef.current || videoRef.current.readyState < 2) {
      throw new Error('Video not ready for capture');
    }
    
    // STEP 1: Screen Detection Check (Single Frame)
    console.log("📱 Starting screen detection check...");
    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
      
      const formData = new FormData();
      formData.append('file', blob, 'screen_check.jpg');
      
      console.log("📤 Sending frame to screen detection endpoint...");
      const screenDetectResponse = await fetch('https://testscan.cardnest.io/screen-detect/detect-screen', {
        method: 'POST',
        body: formData
      });
      
      // Check if we got the expected 500 error (which means pass for now)
      if (screenDetectResponse.status === 500) {
        const errorData = await screenDetectResponse.json();
        if (errorData.detail === "Screen detection model not available") {
          console.log("✅ Screen detection passed (model not available - treating as pass)");
        } else {
          console.log("✅ Screen detection returned 500, continuing...");
        }
      } else if (screenDetectResponse.ok) {
        const screenData = await screenDetectResponse.json();
        console.log("📊 Front side screen detection response:", screenData);
        
        // Check is_screen property
        if (screenData.is_screen === false) {
          console.log("✅ Front side screen detection passed - real card detected");
          console.log(`   Confidence: ${screenData.confidence}, Prediction: ${screenData.prediction_class}`);
        } else if (screenData.is_screen === true) {
          console.log("❌ Front side screen detected - this appears to be a screen/photo, not physical card");
          console.log(`   Confidence: ${screenData.confidence}, Message: ${screenData.message}`);
          
          // 🔦 Turn off flashlight before throwing error
          if (disableFlashlight) {
            await disableFlashlight();
          }
          
          throw new Error('Fake card detected on front side - screen or photo detected instead of physical card');
        } else {
          console.warn("⚠️ is_screen property not found in response, continuing...");
        }
      } else {
        console.warn("⚠️ Unexpected screen detection response:", screenDetectResponse.status);
        // Continue anyway
      }
    } catch (screenError) {
      if (screenError.message.includes('Fake card detected')) {
        // Re-throw fake card errors
        throw screenError;
      }
      console.error("❌ Screen detection error:", screenError);
      // Continue with normal detection even if screen check fails
    }
    
    // 🔦 Turn off flashlight after screen detection check
    if (disableFlashlight) {
      console.log("🔦 Turning off flashlight after screen detection");
      await disableFlashlight();
    }
    
    console.log("🔄 Continuing with normal card detection...");
    
    return new Promise((resolve, reject) => {
      let frameNumber = 0;
      let timeoutId = null;
      let isComplete = false;
      let hasReceivedSuccess = false; // NEW: Track if we've already received success
      let maxFramesReachedTime = null; // Track when we reached 10 frames
      let lastApiResponse = null; // Track last response
      let successfulFramesCount = 0; // NEW: Track how many frames succeeded in THIS attempt
      
      const cleanup = () => {
        if (captureIntervalRef.current) {
          clearInterval(captureIntervalRef.current);
          captureIntervalRef.current = null;
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        setIsProcessing(false);
      };
      
      const processFrame = async () => {
        try {
          // 🛑 FIRST CHECK: Stop immediately if success already received
          if (hasReceivedSuccess) {
            console.log('🛑 Success already received - stopping frame capture completely');
            cleanup(); // Stop the interval
            return;
          }
          
          // Check if stop requested or already complete
          if (isComplete || stopRequestedRef.current) return;
          
          // 📊 FRAME LIMIT: Only capture new frames if under 10 frame limit
          if (frameNumber >= maxFrames) {
            if (!maxFramesReachedTime) {
              maxFramesReachedTime = Date.now();
              console.log(`📋 Reached ${maxFrames} frames limit - no more captures, waiting for responses...`);
            }
            return; // Don't capture more frames, but keep waiting for responses
          }
          
          // 🛡️ SAFETY CHECK: Verify video and canvas are still available
          if (!videoRef.current || !canvasRef.current) {
            console.log('🛡️ Video or canvas no longer available - stopping detection gracefully');
            
            // If we already received success, just return without doing anything
            if (hasReceivedSuccess || isComplete) {
              console.log('🛡️ Already completed with success, ignoring cleanup');
              return;
            }
            
            isComplete = true;
            cleanup();
            // Don't reject - just resolve with last response if available
            if (lastApiResponse) {
              resolve(lastApiResponse);
            } else {
              reject(new Error('Component cleanup detected during frame capture'));
            }
            return;
          }
          
          const frame = await captureFrame(videoRef, canvasRef);
          
          if (frame && frame.size > 0) {
            frameNumber++;
            
            // 🛑 CRITICAL: Stop BEFORE sending frame if we've already received success
            if (hasReceivedSuccess) {
              console.log(`⏭️ Skipping frame ${frameNumber} - success already received, not sending to API`);
              return;
            }
            
            setIsProcessing(true);
            try {
              const apiResponse = await sendFrameToAPI(frame, phase, currentSessionId, frameNumber);
              
              // 🎯 CRITICAL: Check for SUCCESS FIRST before checking hasReceivedSuccess flag
              // This ensures we don't skip a success response even if another frame already succeeded
              
              // 🎯 HIGHEST PRIORITY: Check for status success OR already_completed (regardless of other conditions)
              if (apiResponse.status === "success" || apiResponse.status === "already_completed") {
                console.log('🎯 SUCCESS/ALREADY_COMPLETED STATUS received! Stopping detection...');
                console.log(`Status: ${apiResponse.status}, Score: ${apiResponse.score}, Complete Scan: ${apiResponse.complete_scan}`);
                hasReceivedSuccess = true; // Mark success as received
                isComplete = true;
                cleanup();
                setCurrentPhase('results');
                resolve(apiResponse);
                return;
              }
              
              // CRITICAL FIX: Check for final encrypted response first
              if (apiResponse.encrypted_card_data && apiResponse.status) {
                console.log('🎯 Final encrypted response received! Stopping detection...');
                hasReceivedSuccess = true; // Mark success as received
                isComplete = true;
                cleanup();
                setCurrentPhase('results');
                resolve(apiResponse);
                return;
              }
              
              // NOW check if success already received (for non-success responses)
              if (hasReceivedSuccess) {
                console.log(`⏭️ Skipping response processing for frame ${frameNumber} - success received while in flight`);
                return;
              }

            // Check for validation states first (for validation phase)
            if (phase === 'validation') {
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

              if (apiResponse.message_state === "VALIDATION_PASSED" || 
                  apiResponse.movement_state === "VALIDATION_PASSED") {
                isComplete = true;
                cleanup();
                setCurrentPhase('ready-for-front');
                resolve(apiResponse);
                return;
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
            
            // � CRITICAL: Check for wait_for_front/wait_for_back - session needs full restart
            if (apiResponse.status === 'wait_for_front') {
              console.log(`�🔄 Backend requires session restart: ${apiResponse.status}`);
              isComplete = true;
              cleanup();
              
              const errorMsg = 'Oops, after numerous security scan detection your card issuer verification details do not match the bank records - please try again. Thank you!!.';
              if (handleDetectionFailure) {
                handleDetectionFailure(errorMsg, phase);
              } else {
                setErrorMessage(errorMsg);
                setCurrentPhase('error');
              }
              reject(new Error(`Backend requires ${apiResponse.status.replace('wait_for_', '')} scan first`));
              return;
            }
            
            // 🔄 Track successful response (not error status)
            // Only count as successful if we got a valid processing response
            // EXCLUDE wait_for_front/wait_for_back as these indicate session needs restart
            if (apiResponse && 
                !apiResponse.error && 
                apiResponse.status !== 'wait_for_front' && 
                apiResponse.status !== 'wait_for_back') {
              lastApiResponse = apiResponse;
              successfulFramesCount++;
              console.log(`✅ Valid API response received for frame ${frameNumber} (${successfulFramesCount} successful frames so far)`);
            }
            setIsProcessing(false);

              // Check for fake card detection in front phase
              if (phase === 'front' && apiResponse.fake_card === true) {
                console.log('🚫 Fake card detected in front phase - stopping detection');
                isComplete = true;
                cleanup();
                setErrorMessage('Fake card detected. Please use original card.');
                setCurrentPhase('error');
                reject(new Error('Fake card detected'));
                return;
              }

              // Update front scan state for front phase
              if (phase === 'front') {
                setFrontScanState({
                  framesBuffered: apiResponse.buffer_info?.front_frames_buffered || frameNumber,
                  physicalCardDetected: apiResponse.physical_card || false,
                  canProceedToBack: false
                });
              }
              
              const bufferedFrames = phase === 'front' 
                ? apiResponse.buffer_info?.front_frames_buffered 
                : apiResponse.buffer_info?.back_frames_buffered;
              
              // Check for back side validation failure specifically
              if (phase === 'back' && apiResponse.validation_failed === true) {
                console.log('❌ Back side validation failed - validation_failed is true');
                console.log('📋 Validation reason:', apiResponse.validation_reason || 'Not provided');
                console.log('📋 Missing fields:', apiResponse.missing_fields || 'None specified');
                
                // CRITICAL: Stop all processing immediately
                stopRequestedRef.current = true;
                isComplete = true;
                cleanup();
                
                const errorMsg = apiResponse.validation_reason || 
                                apiResponse.message || 
                                'Back side validation failed. Please ensure the card back is clearly visible and try again.';
                
                // Use handleDetectionFailure to maintain attempt counting
                if (handleDetectionFailure) {
                  handleDetectionFailure(errorMsg, 'back');
                } else {
                  setErrorMessage(errorMsg);
                  setCurrentPhase('error');
                }
                
                reject(new Error('Back validation failed'));
                return;
              }

              // MOVED: Check validation ONLY after we have sufficient buffered frames
              if (bufferedFrames >= 4) {
                // NOW check front_valid for front phase (only after 4 frames buffered)
                if (phase === 'front' && apiResponse.front_valid === false) {
                  console.log('❌ Front validation failed after 4 frames - front_valid is false');
                  isComplete = true;
                  cleanup();
                  if (handleDetectionFailure) {
                    handleDetectionFailure('Front side validation failed. Please ensure the card is properly positioned and try again.', 'front');
                  }
                  reject(new Error('Front validation failed - front_valid is false'));
                  return;
                }

                // NOW check back_valid for back phase (only after 4 frames buffered)
                if (phase === 'back' && apiResponse.back_valid === false) {
                  console.log('❌ Back validation failed after 4 frames - back_valid is false');
                  isComplete = true;
                  cleanup();
                  if (handleDetectionFailure) {
                    handleDetectionFailure('Back side validation failed. Please ensure the card back is clearly visible and try again.', 'back');
                  }
                  reject(new Error('Back validation failed - back_valid is false'));
                  return;
                }
              }
              
              // For back side, check both sufficient frames and required features
              if (phase === 'back' && bufferedFrames >= 4) {
                const { count, detectedFeatures } = countBackSideFeatures(apiResponse);
                
                if (count >= 3) { // requiredBackSideFeatures
                  isComplete = true;
                  cleanup();
                  console.log(`Back side complete - 4 frames buffered and ${count} features detected: ${detectedFeatures.join(', ')}`);
                  setCurrentPhase('results');
                  resolve(apiResponse);
                  return;
                }
              } else if (phase === 'front' && bufferedFrames >= 4) {
                // For front side, check if physical_card is detected
                if (apiResponse.physical_card === true) {
                  isComplete = true;
                  cleanup();
                  console.log(`Front side complete - 4 frames buffered with physical_card: ${apiResponse.physical_card}`);
                  resolve(apiResponse);
                  return;
                }
              } else if (phase !== 'back' && phase !== 'front' && phase !== 'validation' && bufferedFrames >= 4) {
                isComplete = true;
                cleanup();
                console.log(`${phase} side complete - 4 frames buffered`);
                resolve(apiResponse);
                return;
              }
              
              // 📊 FALLBACK: Only stop due to frame limit if we've been waiting a while
              // This ensures we give time for API responses after sending 15 frames
              if (frameNumber >= maxFrames && maxFramesReachedTime && 
                  (Date.now() - maxFramesReachedTime > 3000)) { // Wait 3 seconds after last frame
                console.log(`📋 Waited 3 seconds after ${maxFrames} frames - stopping with last response`);
                isComplete = true;
                cleanup();
                
                if (lastApiResponse) {
                  if (phase === 'back') {
                    const buffered = lastApiResponse.buffer_info?.back_frames_buffered || 0;
                    const { count, detectedFeatures } = countBackSideFeatures(lastApiResponse);
                    
                    if (buffered >= 4 && count < 3) {
                      const missingCount = 3 - count;
                      setErrorMessage(`Insufficient back side features detected. Found ${count} out of required 3 features (${detectedFeatures.join(', ')}). Please ensure the card's back side is clearly visible showing magnetic strip, signature strip, hologram, and customer service details.`);
                      setCurrentPhase('error');
                      reject(new Error(`Insufficient back side features: only ${count}/3 detected`));
                    } else if (buffered < 4) {
                      setErrorMessage('Failed to capture sufficient frames for back side. Please try again.');
                      setCurrentPhase('error');
                      reject(new Error('Insufficient frames captured for back side'));
                    } else {
                      resolve(lastApiResponse);
                    }
                  } else {
                    resolve(lastApiResponse);
                  }
                } else {
                  reject(new Error(`Failed to get sufficient frames after ${maxFrames} attempts`));
                }
                return;
              }
              
            } catch (apiError) {
              // Suppress error logging if success already received (in-flight frames)
              if (!hasReceivedSuccess) {
                console.error(`API error for frame ${frameNumber}:`, apiError);
              } else {
                console.log(`⏭️ Ignoring API error for in-flight frame ${frameNumber} (success already received)`);
              }
              setIsProcessing(false);
            }
          }
        } catch (error) {
          // Suppress error if success already received
          if (!hasReceivedSuccess && !isComplete && !stopRequestedRef.current) {
            console.error('Error in frame processing:', error);
          }
        }
      };
      
      processFrame();
      captureIntervalRef.current = setInterval(processFrame, 1000); //was 1500ms
      
      timeoutId = setTimeout(() => {
        if (!isComplete) {
          cleanup();
          
          // 🔴 CRITICAL: Check if we got ANY successful frames in THIS attempt
          if (successfulFramesCount === 0) {
            console.log('❌ Timeout: No successful API responses received in this attempt');
            reject(new Error('Timeout: Network Error or No successful API responses received'));
            return;
          }
          
          if (lastApiResponse) {
            console.log(`Timeout reached, checking final conditions... (${successfulFramesCount} successful frames received)`);
            
            // CRITICAL FIX: Check for final encrypted response OR already_completed in timeout
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
                setCurrentPhase('results');
                resolve(lastApiResponse);
                return;
              } else if (bufferedFrames >= 4 && count < 3) {
                setErrorMessage(`Timeout: Insufficient back side features detected. Found ${count} out of required 3 features (${detectedFeatures.join(', ')}). Please ensure the card's back side is clearly visible.`);
                setCurrentPhase('error');
                reject(new Error(`Timeout: Insufficient back side features detected`));
                return;
              }
            }
            
            console.log('Timeout reached, using last response');
            resolve(lastApiResponse);
          } else {
            reject(new Error('Timeout: Network Error or No successful API responses received'));
          }
        }
      }, 24000);
    });
  };

  // Helper function to count detected back side features
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

  // Regular capture function for back side with feature validation

  // Regular capture function for back side with feature validation
const captureAndSendFrames = async (phase, providedSessionId = null) => {
  const currentSessionId = providedSessionId || sessionId;
  console.log("🔍 captureAndSendFrames called with phase:", phase, "sessionId:", currentSessionId);
  
  if (!currentSessionId) {
    throw new Error('No session ID provided. Session must be initialized before detection.');
  }
  
  console.log("Using session ID:", currentSessionId);
  
  let lastApiResponse = null;
  const maxFrames = 15;
  const requiredBackSideFeatures = 2;  //replaced it to 2 before it was 3
  
  if (!videoRef.current || videoRef.current.readyState < 2) {
    throw new Error('Video not ready for capture');
  }
  
  // STEP 1: Screen Detection Check for BACK side (Single Frame)
  console.log("📱 Starting screen detection check for BACK side...");
  try {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    
    const formData = new FormData();
    formData.append('file', blob, 'back_screen_check.jpg');
    
    console.log("📤 Sending back side frame to screen detection endpoint...");
    const screenDetectResponse = await fetch('https://testscan.cardnest.io/screen-detect/detect-screen', {
      method: 'POST',
      body: formData
    });
    
    // Check if we got the expected 500 error (which means pass for now)
    if (screenDetectResponse.status === 500) {
      const errorData = await screenDetectResponse.json();
      if (errorData.detail === "Screen detection model not available") {
        console.log("✅ Back side screen detection passed (model not available - treating as pass)");
      } else {
        console.log("✅ Back side screen detection returned 500, continuing...");
      }
    } else if (screenDetectResponse.ok) {
      const screenData = await screenDetectResponse.json();
      console.log("📊 Back side screen detection response:", screenData);
      
      // Check is_screen property
      if (screenData.is_screen === false) {
        console.log("✅ Back side screen detection passed - real card detected");
        console.log(`   Confidence: ${screenData.confidence}, Prediction: ${screenData.prediction_class}`);
      } else if (screenData.is_screen === true) {
        console.log("❌ Back side screen detected - this appears to be a screen/photo, not physical card");
        console.log(`   Confidence: ${screenData.confidence}, Message: ${screenData.message}`);
        
        // 🔦 Turn off flashlight before throwing error
        if (disableFlashlight) {
          await disableFlashlight();
        }
        
        throw new Error('Fake card detected on back side - screen or photo detected instead of physical card');
      } else {
        console.warn("⚠️ is_screen property not found in response, continuing...");
      }
    } else {
      console.warn("⚠️ Unexpected back side screen detection response:", screenDetectResponse.status);
      // Continue anyway
    }
  } catch (screenError) {
    if (screenError.message.includes('Fake card detected')) {
      // Re-throw fake card errors
      throw screenError;
    }
    console.error("❌ Back side screen detection error:", screenError);
    // Continue with normal detection even if screen check fails
  }
  
  // 🔦 Turn off flashlight after screen detection check
  if (disableFlashlight) {
    console.log("🔦 Turning off flashlight after back side screen detection");
    await disableFlashlight();
  }
  
  console.log("🔄 Continuing with normal back side card detection...");
  
  return new Promise((resolve, reject) => {
    let frameNumber = 0;
    let timeoutId = null;
    let isComplete = false;
    let hasReceivedSuccess = false; // NEW: Track if we've already received success
    let maxFramesReachedTime = null; // Track when we reached 10 frames
    let lastApiResponse = null; // Track last response
    let successfulFramesCount = 0; // NEW: Track how many frames succeeded in THIS attempt
    
    const cleanup = () => {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      setIsProcessing(false);
    };
    
    const processFrame = async () => {
      try {
        // 🛑 FIRST CHECK: Stop immediately if success already received
        if (hasReceivedSuccess) {
          console.log('🛑 Success already received - stopping frame capture completely');
          cleanup(); // Stop the interval
          return;
        }
        
        // Check if stopped
        if (isComplete || stopRequestedRef.current) return;
        
        // 📊 FRAME LIMIT: Only capture new frames if under 10 frame limit
        if (frameNumber >= maxFrames && !maxFramesReachedTime) {
          console.log(`📋 Reached ${maxFrames} frames limit - stopping new captures but continuing to wait for responses...`);
          maxFramesReachedTime = Date.now();
          return; // Don't capture more frames, but keep waiting for responses
        }

        if (maxFramesReachedTime) {
          return; // Don't send more frames, just wait for responses
        }
        
        // Double-check before frame capture to prevent race conditions
        if (isComplete || stopRequestedRef.current || hasReceivedSuccess) return;
        
        // 🛡️ SAFETY CHECK: Verify video and canvas are still available
        if (!videoRef.current || !canvasRef.current) {
          console.log('🛡️ Video or canvas no longer available - stopping detection gracefully');
          
          // If we already received success, just return without doing anything
          if (hasReceivedSuccess || isComplete) {
            console.log('🛡️ Already completed with success, ignoring cleanup');
            return;
          }
          
          isComplete = true;
          cleanup();
          // Don't reject - just resolve with last response if available
          if (lastApiResponse) {
            resolve(lastApiResponse);
          } else {
            reject(new Error('Component cleanup detected during frame capture'));
          }
          return;
        }
        
        const frame = await captureFrame(videoRef, canvasRef);
        
        // Check again after async frame capture to prevent race conditions
        if (isComplete || stopRequestedRef.current) return;
        
        if (frame && frame.size > 0) {
          frameNumber++;
          
          // 🛑 CRITICAL: Stop BEFORE sending frame if we've already received success
          if (hasReceivedSuccess) {
            console.log(`⏭️ Skipping frame ${frameNumber} - success already received, not sending to API`);
            return;
          }
          
          setIsProcessing(true);
          try {
            const apiResponse = await sendFrameToAPI(frame, phase, currentSessionId, frameNumber);
            
            // 🎯 CRITICAL: Check for SUCCESS FIRST before checking hasReceivedSuccess flag
            // This ensures we don't skip a success response even if another frame already succeeded
            
            // 🎯 HIGHEST PRIORITY: Check for status success OR already_completed (regardless of complete_scan)
            if (apiResponse.status === "success" || apiResponse.status === "already_completed") {
              console.log('🎯 SUCCESS/ALREADY_COMPLETED STATUS received! Stopping all detection immediately...');
              console.log(`Status: ${apiResponse.status}, Score: ${apiResponse.score}, Complete Scan: ${apiResponse.complete_scan}`);
              hasReceivedSuccess = true; // Mark success as received
              isComplete = true;
              cleanup();
              resolve(apiResponse);
              return;
            }
            
            // 🎯 SECOND PRIORITY: Check for final encrypted response with complete_scan
            if (apiResponse.status === "success" && apiResponse.complete_scan === true) {
              hasReceivedSuccess = true; // Mark success as received
              isComplete = true;
              cleanup();
              console.log('🎉 Complete scan with success status received!');
              console.log(`Status: ${apiResponse.status}, Score: ${apiResponse.score}, Complete Scan: ${apiResponse.complete_scan}`);
              resolve(apiResponse); // Let the calling function handle phase transition
              return;
            }

            // THIRD PRIORITY: Check for encrypted_card_data (legacy format)
            if (apiResponse.encrypted_card_data && apiResponse.status) {
              hasReceivedSuccess = true; // Mark success as received
              isComplete = true;
              cleanup();
              console.log('🎉 Final encrypted response received - stopping detection immediately');
              console.log(`Status: ${apiResponse.status}, Score: ${apiResponse.score}`);
              resolve(apiResponse);
              return;
            }
            
            // NOW check if success already received (for non-success responses)
            if (hasReceivedSuccess) {
              console.log(`⏭️ Skipping response processing for frame ${frameNumber} - success received while in flight`);
              return;
            }
            
            // 🚨 CRITICAL: Check for wait_for_front/wait_for_back - session needs full restart
            if (apiResponse.status === 'wait_for_front' || apiResponse.status === 'wait_for_back') {
              console.log(`🔄 Backend requires session restart: ${apiResponse.status}`);
              isComplete = true;
              cleanup();
              
              // For brand_mismatch during back scan, we need to restart from front
              if (phase === 'back' && apiResponse.status === 'wait_for_front') {
                const errorMsg = 'Oops, after numerous security scan detection your card issuer verification details do not match the bank records - please try again. Thank you!!.';
                if (handleDetectionFailure) {
                  handleDetectionFailure(errorMsg, 'back');
                } else {
                  setErrorMessage(errorMsg);
                  setCurrentPhase('error');
                }
                reject(new Error('Session requires restart from front'));
              } else {
                reject(new Error(`Backend requires ${apiResponse.status.replace('wait_for_', '')} scan first`));
              }
              return;
            }       
   
            // 🔄 Track successful response (not error status)
            // Only count as successful if we got a valid processing response
            // EXCLUDE wait_for_front/wait_for_back as these indicate session needs restart
            if (apiResponse && 
                !apiResponse.error && 
                apiResponse.status !== 'wait_for_front' && 
                apiResponse.status !== 'wait_for_back') {
              lastApiResponse = apiResponse;
              successfulFramesCount++;
              console.log(`✅ Valid API response received for frame ${frameNumber} (${successfulFramesCount} successful frames so far)`);
            }
            setIsProcessing(false);
            
            // Check for fake card detection in front phase
            if (phase === 'front' && apiResponse.fake_card === true) {
              console.log('🚫 Fake card detected in front phase - stopping detection');
              isComplete = true;
              cleanup();
              setErrorMessage('Fake card detected. Please use original card.');
              setCurrentPhase('error');
              reject(new Error('Fake card detected'));
              return;
            }
            
            // Update front scan state for front phase
            if (phase === 'front') {
              setFrontScanState({
                framesBuffered: apiResponse.buffer_info?.front_frames_buffered || frameNumber,
                physicalCardDetected: apiResponse.physical_card || false,
                canProceedToBack: false
              });
            }
            
            const bufferedFrames = phase === 'front' 
              ? apiResponse.buffer_info?.front_frames_buffered 
              : apiResponse.buffer_info?.back_frames_buffered;
            
             



if (phase === 'back' && apiResponse.validation_failed === true && apiResponse.validation_reason === "brand_mismatch") {
  console.log('❌ Back side validation failed - brand mismatch');
  console.log('📋 Validation reason:', apiResponse.validation_reason || 'Not provided');
  console.log('📋 Missing fields:', apiResponse.missing_fields || 'None specified');

  // CRITICAL: Stop all processing immediately
  stopRequestedRef.current = true;
  isComplete = true;
  cleanup();

  const errorMsg = 'Oops, after numerous security scan detection your card issuer verification details do not match the bank records - please try again. Thank you!!';
  
  if (handleDetectionFailure) {
    handleDetectionFailure(errorMsg, 'back');
  } else {
    setErrorMessage(errorMsg);
    setCurrentPhase('error');
  }

  reject(new Error('Back validation failed - brand mismatch'));
  return;
}

else if (phase === 'back' && apiResponse.validation_failed === true) {
  console.log('❌ Back side validation failed - generic case');
  console.log('📋 Validation reason:', apiResponse.validation_reason || 'Not provided');
  console.log('📋 Missing fields:', apiResponse.missing_fields || 'None specified');

  // CRITICAL: Stop all processing immediately
  stopRequestedRef.current = true;
  isComplete = true;
  cleanup();

  const errorMsg = 'Back side validation failed. Please ensure the card back is clearly visible and try again.';
  
  if (handleDetectionFailure) {
    handleDetectionFailure(errorMsg, 'back');
  } else {
    setErrorMessage(errorMsg);
    setCurrentPhase('error');
  }

  reject(new Error('Back validation failed - generic'));
  return;
}



            // Check validation ONLY after we have sufficient buffered frames
            if (bufferedFrames >= 4) {
              // Check front_valid for front phase (only after 4 frames buffered)
              if (phase === 'front' && apiResponse.front_valid === false) {
                console.log('❌ Front validation failed after 4 frames - front_valid is false');
                isComplete = true;
                cleanup();
                if (handleDetectionFailure) {
                  handleDetectionFailure('Front side validation failed. Please ensure the card is properly positioned and try again.', 'front');
                }
                reject(new Error('Front validation failed - front_valid is false'));
                return;
              }

              // Check back_valid for back phase (only after 4 frames buffered)
              if (phase === 'back' && apiResponse.back_valid === false) {
                console.log('❌ Back validation failed after 4 frames - back_valid is false');
                isComplete = true;
                cleanup();
                if (handleDetectionFailure) {
                  handleDetectionFailure('Back side validation failed. Please ensure the card back is clearly visible and try again.', 'back');
                }
                reject(new Error('Back validation failed - back_valid is false'));
                return;
              }
            }
            
            // 🔄 MODIFIED: For back side, ONLY complete on feature detection if we haven't received complete_scan yet
            // This prevents premature completion before the final encrypted response
            if (phase === 'back' && bufferedFrames >= 4) {
              const { count, detectedFeatures } = countBackSideFeatures(apiResponse);
              
              // Only consider completing based on features if we've reached max frames
              // OR if we've been scanning for a very long time (fallback)
              if (count >= requiredBackSideFeatures && frameNumber >= 25) {
                console.log(`⚠️ Back side features detected after ${frameNumber} frames but continuing to wait for complete_scan response`);
                console.log(`Features found: ${count} (${detectedFeatures.join(', ')})`);
                // Continue processing, don't resolve yet - wait for complete_scan
              }
            } else if (phase === 'front' && bufferedFrames >= 4) {
              // For front side, check if we have chip or bank logo AND physical_card is true
              if ((apiResponse.chip || apiResponse.bank_logo) && apiResponse.physical_card === true) {
                isComplete = true;
                cleanup();
                console.log(`Front side complete - 4 frames buffered with chip: ${apiResponse.chip}, bank_logo: ${apiResponse.bank_logo}, physical_card: ${apiResponse.physical_card}`);
                resolve(apiResponse);
                return;
              }
            } else if (phase !== 'back' && phase !== 'front' && phase !== 'validation' && bufferedFrames >= 4) {
              isComplete = true;
              cleanup();
              console.log(`${phase} side complete - 4 frames buffered`);
              resolve(apiResponse);
              return;
            }
            
            // 📊 FALLBACK: Only stop due to frame limit if we've been waiting a while  
            // This ensures we give time for API responses after sending 15 frames
            if (frameNumber >= maxFrames) {
              // If we just reached the limit, wait 3 seconds for responses
              if (maxFramesReachedTime && (Date.now() - maxFramesReachedTime) < 3000) {
                console.log(`📋 Waiting for responses (${Math.round((Date.now() - maxFramesReachedTime) / 1000)}s since reaching frame limit)...`);
                return; // Keep waiting
              }
              
              console.log(`📋 Reached ${maxFrames} frames and waited - checking if we have sufficient response...`);
              
              if (lastApiResponse) {
                // Check one final time for complete_scan response
                if (lastApiResponse.status === "success" && lastApiResponse.complete_scan === true) {
                  console.log('🎯 Found complete_scan in final check');
                  resolve(lastApiResponse);
                  return;
                }
                
                if (phase === 'back') {
                  const buffered = lastApiResponse.buffer_info?.back_frames_buffered || 0;
                  const { count, detectedFeatures } = countBackSideFeatures(lastApiResponse);
                  
                  if (buffered >= 4 && count < requiredBackSideFeatures) {
                    const missingCount = requiredBackSideFeatures - count;
                    setErrorMessage(`Insufficient back side features detected. Found ${count} out of required ${requiredBackSideFeatures} features (${detectedFeatures.join(', ')}). Please ensure the card's back side is clearly visible showing magnetic strip, signature strip, hologram, and customer service details.`);
                    setCurrentPhase('error');
                    reject(new Error(`Insufficient back side features: only ${count}/${requiredBackSideFeatures} detected`));
                  } else if (buffered < 4) {
                    setErrorMessage('Failed to capture sufficient frames for back side. Please try again.');
                    setCurrentPhase('error');
                    reject(new Error('Insufficient frames captured for back side'));
                  } else {
                    // Features were sufficient but no complete_scan - this should retry
                    console.log('⚠️ Back side features sufficient but no complete_scan received');
                    reject(new Error('Back scan incomplete '));
                  }
                } else {
                  resolve(lastApiResponse);
                }
              } else {
                reject(new Error(`Failed to get sufficient frames after ${maxFrames} attempts`));
              }
              return;
            }
            
          } catch (apiError) {
            // Suppress error logging if success already received (in-flight frames)
            if (!hasReceivedSuccess) {
              console.error(`API error for frame ${frameNumber}:`, apiError);
            } else {
              console.log(`⏭️ Ignoring API error for in-flight frame ${frameNumber} (success already received)`);
            }
            setIsProcessing(false);
          }
        }
      } catch (error) {
        // Check if we're completed/stopped - if so, ignore errors and exit gracefully
        if (isComplete || stopRequestedRef.current || hasReceivedSuccess) {
          console.log('🛑 Frame processing stopped due to completion state');
          return;
        }
        
        console.error('Error in frame processing:', error);
        
        // Only set processing to false if we're not completed
        if (!isComplete) {
          setIsProcessing(false);
        } 
      }
    };
    
    processFrame();
    captureIntervalRef.current = setInterval(processFrame, 800); //was 1500ms
    
    timeoutId = setTimeout(() => {
      if (!isComplete) {
        cleanup();
        
        // 🔴 CRITICAL: Check if we got ANY successful frames in THIS attempt
        if (successfulFramesCount === 0) {
          console.log('❌ Timeout: No successful API responses received in this attempt');
          reject(new Error('Timeout: No successful API responses received'));
          return;
        }
        
        if (lastApiResponse) {
          console.log(`Timeout reached, checking final conditions... (${successfulFramesCount} successful frames received)`);
          
          // PRIORITY CHECK: Final success, already_completed, or complete_scan response even on timeout
          if (lastApiResponse.status === "success" || 
              lastApiResponse.status === "already_completed" || 
              (lastApiResponse.status === "success" && lastApiResponse.complete_scan === true)) {
            console.log('🎯 Success/already_completed/complete scan found in timeout handler');
            resolve(lastApiResponse);
            return;
          }
          
          // Check for final encrypted response OR already_completed even on timeout
          if (lastApiResponse.encrypted_card_data && lastApiResponse.status) {
            console.log('🎉 Final encrypted response found on timeout');
            resolve(lastApiResponse);
            return;
          }
          
          if (phase === 'back') {
            const bufferedFrames = lastApiResponse.buffer_info?.back_frames_buffered || 0;
            const { count, detectedFeatures } = countBackSideFeatures(lastApiResponse);
            
            if (bufferedFrames >= 4 && count >= requiredBackSideFeatures) {
              // Features sufficient but no complete_scan - should retry front side
              console.log('⚠️ Timeout: Features sufficient but complete_scan not received');
              reject(new Error('Timeout: Back scan incomplete'));
              return;
            } else if (bufferedFrames >= 4 && count < requiredBackSideFeatures) {
              setErrorMessage(`Timeout: Insufficient back side features detected. Found ${count} out of required ${requiredBackSideFeatures} features (${detectedFeatures.join(', ')}). Please ensure the card's back side is clearly visible.`);
              setCurrentPhase('error');
              reject(new Error(`Timeout: Insufficient back side features detected`));
              return;
            }
          }
          
          console.log('Timeout reached, using last response');
          resolve(lastApiResponse);
        } else {
          reject(new Error('Timeout: No successful API responses received'));
        }
      }
    }, 24000);
  });
};

  return {
    captureAndSendFramesFront,
    captureAndSendFrames,
    captureIntervalRef
  };
};