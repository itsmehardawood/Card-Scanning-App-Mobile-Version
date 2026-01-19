"use client";
import React, { useState, useRef, useEffect } from "react";

const VoiceVerification = ({ 
  isOpen, 
  onClose, 
  phoneNumber, 
  merchantId,
  onSuccess,
  mode = "register" // "register" or "verify"
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);
  const [debugInfo, setDebugInfo] = useState("");
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const streamRef = useRef(null);
  const retryCountRef = useRef(0); // Use ref to avoid closure issues

  // Detect if we're in a WebView
  const isWebView = () => {
    const ua = navigator.userAgent;
    return ua.includes('wv') || ua.includes('WebView') || (window.Android !== undefined);
  };

  // Log to Android (if available) and console
  const logToAndroid = (message, data = {}) => {
    const logData = {
      component: "VoiceVerification",
      message,
      timestamp: new Date().toISOString(),
      ...data
    };
    
    console.log(`🎤 ${message}`, data);
    
    // Send to client-log API for server-side logging
    fetch('/securityscan/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logData)
    }).catch(err => console.error('Failed to log:', err));
  };

  // Log environment info on mount
  useEffect(() => {
    if (isOpen) {
      const diagnosticInfo = {
        mode: mode,
        isWebView: isWebView(),
        userAgent: navigator.userAgent,
        mediaDevices: !!navigator.mediaDevices,
        getUserMedia: !!navigator.mediaDevices?.getUserMedia,
        phoneNumber: phoneNumber ? "present" : "missing",
        merchantId: merchantId || "missing"
      };
      
      logToAndroid("Voice Verification opened at initial stage", diagnosticInfo);
      setDebugInfo(`WebView: ${isWebView()} | Mode: ${mode}`);
      logToAndroid("✅ Voice Verification ready - camera not yet initialized");
    }
  }, [isOpen, mode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = async (currentRetry = 0) => {
    try {
      setError("");
      setIsRetrying(false);
      logToAndroid("Starting recording attempt", { retryCount: currentRetry });
      
      // FIRST: Check if microphone permissions are available at all
      if (currentRetry === 0) {
        logToAndroid("Checking microphone permissions before stopping camera");
        
        // Try to check permissions API if available
        if (navigator.permissions && navigator.permissions.query) {
          try {
            const micPermission = await navigator.permissions.query({ name: 'microphone' });
            logToAndroid("Microphone permission state", { state: micPermission.state });
            
            if (micPermission.state === 'denied') {
              throw new Error("PERMISSION_DENIED: Microphone permission is denied in system settings. Please enable microphone access for this app.");
            }
          } catch (permError) {
            logToAndroid("Permission check not supported or failed", { error: permError.message });
            // Continue - some browsers don't support permissions API
          }
        }
      }
      
      // Check if mediaDevices is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("MediaDevices API not supported");
      }

      logToAndroid("Requesting microphone access");
      
      // Request microphone access with simpler constraints for better Android compatibility
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true // Use simple constraint for maximum compatibility
      });
      
      streamRef.current = stream;
      logToAndroid("Microphone access granted", {
        tracks: stream.getAudioTracks().length,
        trackLabel: stream.getAudioTracks()[0]?.label
      });
      
      // Determine best MIME type for mobile compatibility
      // MediaRecorder does NOT support audio/mpeg - use native formats only
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      let mimeType = '';
      
      const supportedTypes = isIOS 
        ? [
            'audio/mp4',                // iOS native
            'audio/wav',
            'audio/webm',
            'audio/ogg'
          ]
        : [
            'audio/webm;codecs=opus',   // Android native (best quality)
            'audio/webm',
            'audio/mp4',
            'audio/ogg',
            'audio/wav'
          ];
      
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
        
          break;
        }
      }
      
      if (!mimeType) {
        logToAndroid("⚠️ No preferred MIME type supported, using browser default");
        // Let browser choose default format
      }
      
      // Create MediaRecorder with mobile-compatible settings
      const mediaRecorder = mimeType 
        ? new MediaRecorder(stream, { 
            mimeType,
            audioBitsPerSecond: 128000
          })
        : new MediaRecorder(stream); // Use browser default if no MIME type supported
        
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          // logToAndroid("Audio chunk received", { size: event.data.size });
        }
      };

      mediaRecorder.onstop = () => {
        // Use the actual MIME type from the MediaRecorder
        const actualMimeType = mediaRecorderRef.current?.mimeType || mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
        setAudioBlob(audioBlob);
        setHasRecorded(true);
        
    
        
        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => {
            track.stop();
            logToAndroid("Track stopped", { label: track.label });
          });
          streamRef.current = null;
        }
      };

      mediaRecorder.onerror = (event) => {
        logToAndroid("MediaRecorder error", { error: event.error });
        setError("Recording error occurred. Please try again.");
      };

      // Start recording
      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
      setRecordingTime(0);
      
   
      
      // Start timer
      timerIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      logToAndroid("Error accessing microphone", { 
        error: err.message,
        name: err.name,
        stack: err.stack,
        retryCount: currentRetry
      });
      
      let errorMessage = "Unable to access microphone. ";
      
      // Check if this is a permission issue that needs to be handled in Android manifest
      if (err.message.includes('PERMISSION_DENIED')) {
        setError(err.message);
        setDebugInfo(`Permission denied at system level`);
        setIsRetrying(false);
        setRetryAttempt(0);
        return;
      }
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = "⚠️ MICROPHONE PERMISSION DENIED\n\n";
        errorMessage += "The Android app does not have microphone permission.\n\n";
        errorMessage += "SOLUTION:\n";
        errorMessage += "1. Add this to AndroidManifest.xml:\n";
        errorMessage += "   <uses-permission android:name=\"android.permission.RECORD_AUDIO\" />\n\n";
        errorMessage += "2. Or go to Android Settings → Apps → [App Name] → Permissions → Enable Microphone";
        setError(errorMessage);
        setDebugInfo(`${err.name}: ${err.message}`);
        setIsRetrying(false);
        setRetryAttempt(0);
      } else if (err.name === 'NotFoundError') {
        errorMessage += "No microphone found on your device.";
        setError(errorMessage);
        setDebugInfo(`${err.name}: ${err.message}`);
        setIsRetrying(false);
        setRetryAttempt(0);
      } else if (err.name === 'NotReadableError' || err.message.includes('Could not start audio source')) {
        // Retry with increasing delays for audio source conflicts
        const nextRetry = currentRetry + 1;
        if (nextRetry <= 3) {
          const delay = nextRetry * 1000; // 1s, 2s, 3s, 4s
          setIsRetrying(true);
          setRetryAttempt(nextRetry);
          errorMessage = `Camera/audio conflict detected. Retrying in ${delay/1000} seconds... (Attempt ${nextRetry}/3)`;
          setError(errorMessage);
          setDebugInfo(`Retry ${nextRetry}: Waiting ${delay}ms`);
          
          logToAndroid("Retrying microphone access", { 
            delay, 
            attempt: nextRetry 
          });
          
          setTimeout(() => {
            startRecording(nextRetry); // Pass the new retry count directly
          }, delay);
        } else {
          errorMessage = "⚠️ MICROPHONE ACCESS BLOCKED\n\n";
          errorMessage += "Root Cause: WebView cannot access microphone\n\n";
          setError(errorMessage);
          setDebugInfo(`${err.name}: ${err.message} (Max retries reached)`);
          setIsRetrying(false);
          setRetryAttempt(0);
        }
      } else {
        errorMessage += err.message;
        setError(errorMessage);
        setDebugInfo(`${err.name}: ${err.message}`);
      }
    }
  };

  const stopRecording = () => {
    try {
      const recorder = mediaRecorderRef.current;
      
    
      
      if (!recorder) {
        logToAndroid("⚠️ No mediaRecorder found");
        setIsRecording(false);
        return;
      }
      
      // Check if actually recording
      if (recorder.state === "recording") {
        logToAndroid("Stopping recording - recorder is active");
        
        // CRITICAL: Stop the recorder
        recorder.stop();
        
        // Immediately update UI state
        setIsRecording(false);
        
        // Clear the timer
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
        
        // Stop all audio tracks immediately
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => {
            track.stop();
            // logToAndroid("Audio track stopped", { label: track.label });
          });
          streamRef.current = null;
        }
        
        logToAndroid("✅ Recording stopped successfully");
      } else if (recorder.state === "inactive") {
        logToAndroid("⚠️ Recorder is already inactive, just updating UI");
        setIsRecording(false);
        
        // Still ensure streams are stopped
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => {
            track.stop();
            // logToAndroid("Audio track stopped (cleanup)", { label: track.label });
          });
          streamRef.current = null;
        }
      } else {
        logToAndroid("⚠️ Unexpected recorder state", { state: recorder.state });
        setIsRecording(false);
      }
    } catch (err) {
      logToAndroid("❌ Error stopping recording", { error: err.message });
      setIsRecording(false); // Force UI update even on error
    }
  };

  const handleRecordClick = () => {
  
    
    if (isRecording) {
      stopRecording();
    } else {
      // Only start new recording if the previous one is fully complete
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        logToAndroid("⚠️ Recorder still in recording state, forcing stop first");
        mediaRecorderRef.current.stop();
      }
      
      setRetryAttempt(0); // Reset retry count on new recording attempt
      setIsRetrying(false);
      startRecording(0); // Start with retry count 0
    }
  };

  const handleSubmit = async () => {
    if (!audioBlob) {
      setError("Please record your voice first.");
      return;
    }

    // Ensure blob has data
    if (audioBlob.size === 0) {
      setError("Recorded audio is empty. Please record again.");
      logToAndroid("Attempted submit with empty audio blob", { size: 0 });
      return;
    }

    // Use dummy phone if missing
    const userId = phoneNumber || "923020447034";
    if (!phoneNumber) logToAndroid("Using dummy phone number for testing", { user_id: userId });

    setIsSubmitting(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("user_id", userId);
      formData.append("merchant_id", merchantId);

      

      // Strip codec params (e.g. "audio/webm;codecs=opus" → "audio/webm")
      const cleanMimeType = (audioBlob.type || "audio/webm").split(';')[0].trim();
   

      const extMap = {
        "audio/mp4": "m4a",
        "audio/wav": "wav",
        "audio/ogg": "ogg",
        "audio/webm": "webm",
        "audio/mpeg": "mp3"
      };
      const fileExt = extMap[cleanMimeType] || "webm";
      const fileName = `voice_recording.${fileExt}`;

      // Append original blob directly (do NOT wrap it again)
      formData.append("file", audioBlob, fileName);



      const apiEndpoint = mode === "verify" 
        ? `${process.env.NEXT_PUBLIC_API_URL}/voice/verify`
        : `${process.env.NEXT_PUBLIC_API_URL}/voice/register`;

        //   const apiEndpoint = mode === "verify" 
        // ? `https://api.cardnest.io/voice/verify`
        // : `https://api.cardnest.io/voice/register`;

      // logToAndroid(`Submitting voice ${mode}`, {
      //   endpoint: apiEndpoint,
      //   method: "POST",
      //   body_type: "FormData with 3 fields (user_id, merchant_id, file)"
      // });

      // Send to API
      const response = await fetch(apiEndpoint, {
        method: "POST",
        body: formData,
        // DO NOT set Content-Type header - let browser set it with boundary
      });

      const responseText = await response.text();
      logToAndroid("API Response received", { 
        status: response.status, 
        response: responseText 
      });

      if (response.ok) {
        let result;
        try {
          result = JSON.parse(responseText);
        } catch {
          result = { message: responseText };
        }
        
        logToAndroid(`✅ Voice ${mode} successful`, result);
        
        // Show success message to user
        setShowSuccess(true);
        setIsSubmitting(false);
        
        // Wait 1.5 seconds to show success message, then call parent callback
        setTimeout(() => {
          // Call success callback - parent will handle closing and cleanup
          if (onSuccess) {
            onSuccess(result);
          }
          
          // ❌ DO NOT call onClose() here - let parent handle it after processing
          // The parent's onSuccess handler will:
          // 1. Mark result as verified
          // 2. Retrieve encrypted data
          // 3. Close the popup via setShowVoiceVerification(false)
        }, 1500);
      } else {
        logToAndroid(`❌ Voice ${mode} failed`, { 
          status: response.status,
          error: responseText 
        });
        // Surface server error detail to user for debugging
        const serverMsg = responseText || `HTTP ${response.status}`;
        setError(`Voice ${mode} failed (${response.status}): ${serverMsg}`);
      }
    } catch (err) {
      logToAndroid(`❌ Error submitting voice ${mode}`, { 
        error: err.message,
        stack: err.stack 
      });
      setError(`Failed to submit voice ${mode}. Please check your connection.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    logToAndroid("User skipped voice verification");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        {/* Success Message - Full Screen Takeover */}
        {showSuccess && (
          <div className="absolute inset-0 bg-white rounded-lg flex flex-col items-center justify-center z-10">
            <div className="text-center">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                <span className="text-green-600 text-4xl">✓</span>
              </div>
              <h3 className="text-2xl font-bold text-green-600 mb-2">
                {mode === "verify" ? "Verification Successful!" : "Registration Successful!"}
              </h3>
              <p className="text-gray-600 text-sm">
                {mode === "verify" 
                  ? "Your identity has been verified. Loading your results..."
                  : "Your voice has been registered. Processing your card scan..."
                }
              </p>
              <div className="mt-4">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
              </div>
            </div>
          </div>
        )}
        
        {/* Header */}
        <div className="text-center mb-6">
          {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 text-sm text-center">{error}</p>
          </div>
        )}
        
        {/* Debug Info (only in development) */}
        {debugInfo && process.env.NODE_ENV === 'development' && (
          <div className="mb-4 p-2 bg-gray-100 border border-gray-300 rounded text-xs">
            <p className="text-gray-600">{debugInfo}</p>
          </div>
        )}
          
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            {mode === "verify" ? "Voice Verification" : "Voice Registration"}
          </h3>
          <p className="text-gray-600 text-sm">
            {mode === "verify" 
              ? "Please verify your identity by speaking the phrase below."
              : "For additional security, we need to verify and associate your voice with your account."
            }
          </p>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-blue-900 text-sm font-medium mb-2">
            {mode === "verify" 
              ? "Please say this phrase 1 time clearly:"
              : "Please say this phrase 3 times clearly:"
            }
          </p>
          <p className="text-blue-700 text-lg font-semibold text-center py-2">
            &ldquo;Today is Monday&rdquo;
          </p>
          <p className="text-blue-600 text-xs mt-2 text-center">
            {mode === "verify"
              ? "Click the button below and say the phrase 1 time to verify your identity"
              : "Click the button below and repeat the phrase 3 times in one recording"
            }
          </p>
        </div>

        {/* Recording Status */}
        {hasRecorded && !isRecording && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-green-700 text-sm text-center">
               Voice recorded successfully ({recordingTime}s)
            </p>
          </div>
        )}

        {/* Recording Timer */}
        {isRecording && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 text-sm text-center font-mono">
              🔴 Recording... {recordingTime}s
            </p>
          </div>
        )}

        {/* Retry Status */}
        {isRetrying && !isRecording && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-700 text-sm text-center">
              ⏳ Retrying microphone access...
            </p>
          </div>
        )}

      

        {/* Record Button */}
        <button
          onClick={handleRecordClick}
          disabled={isSubmitting || isRetrying }
          className={`w-full py-4 rounded-lg font-semibold text-white transition-all mb-3 ${
            isRecording
              ? "bg-red-600 hover:bg-red-700 animate-pulse"
              : isRetrying
              ? "bg-yellow-500 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {isRecording ? (
            <>
              <span className="inline-block w-3 h-3 bg-white rounded-full mr-2 animate-pulse"></span>
              Stop Recording
            </>
          ) : (
            <>
               {hasRecorded ? "Record Again" : "Start Recording"}
            </>
          )}
        </button>

        {/* Action Buttons */}
        <div className="flex gap-3">
        
          <button
            onClick={handleSubmit}
            disabled={!audioBlob || isSubmitting || isRecording}
            className="flex-1 py-3 rounded-lg font-medium text-white bg-green-600 hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                Submitting...
              </>
            ) : (
              "Submit & Continue"
            )}
          </button>
        </div>

        {/* Info Text */}
        <p className="text-xs text-gray-500 text-center mt-4">
          Your voice data will be securely stored and used only for verification purposes.
        </p>
      </div>
    </div>
  );
};

export default VoiceVerification;
