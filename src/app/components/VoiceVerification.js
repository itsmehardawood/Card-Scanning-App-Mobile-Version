"use client";
import React, { useState, useRef, useEffect } from "react";

const VoiceVerification = ({ 
  isOpen, 
  onClose, 
  phoneNumber, 
  merchantId,
  onSuccess,
  mode = "register", // "register" or "verify"
  onCameraStop = null, // Callback to stop camera before mic access
  onCameraRestart = null // Callback to restart camera after recording
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      
      logToAndroid("Voice Verification opened", diagnosticInfo);
      setDebugInfo(`WebView: ${isWebView()} | Mode: ${mode}`);
      
      // Run microphone test WITHOUT stopping camera to diagnose issue
      logToAndroid("🧪 DIAGNOSTIC: Testing microphone access WITHOUT camera stop");
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          logToAndroid("✅ DIAGNOSTIC: Microphone accessible!", {
            tracks: stream.getAudioTracks().length,
            trackLabel: stream.getAudioTracks()[0]?.label
          });
          // Stop immediately - this is just a test
          stream.getTracks().forEach(t => t.stop());
        })
        .catch(err => {
          logToAndroid("❌ DIAGNOSTIC: Microphone NOT accessible even without camera", {
            error: err.name,
            message: err.message,
            diagnosis: "WebView microphone access is blocked - check WebChromeClient.onPermissionRequest"
          });
        });
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
      
      // CRITICAL: Stop camera on EVERY attempt to ensure resources are freed
      // Android WebView may not release camera resources immediately
      if (onCameraStop) {
        logToAndroid("Stopping camera to free resources for microphone", { attempt: currentRetry });
        try {
          await onCameraStop();
          // Longer delay for Android WebView - increases with each retry
          const waitTime = 1000 + (currentRetry * 500); // 1s, 1.5s, 2s, 2.5s
          logToAndroid(`Waiting ${waitTime}ms for camera resources to release`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          logToAndroid("Camera stopped successfully");
        } catch (stopError) {
          logToAndroid("Error stopping camera", { error: stopError.message });
          // Continue anyway - try to get mic access
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
          logToAndroid("✅ MediaRecorder supports MIME type", { 
            mimeType, 
            platform: isIOS ? 'iOS' : 'Android' 
          });
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
          logToAndroid("Audio chunk received", { size: event.data.size });
        }
      };

      mediaRecorder.onstop = () => {
        // Use the actual MIME type from the MediaRecorder
        const actualMimeType = mediaRecorderRef.current?.mimeType || mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
        setAudioBlob(audioBlob);
        setHasRecorded(true);
        
        logToAndroid("Recording stopped", { 
          blobSize: audioBlob.size,
          blobType: audioBlob.type,
          actualMimeType: actualMimeType,
          chunks: audioChunksRef.current.length
        });
        
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
      
      logToAndroid("Recording started successfully", { 
        state: mediaRecorder.state,
        mimeType 
      });
      
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
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      logToAndroid("Stopping recording");
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  };

  const handleRecordClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
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

    if (!phoneNumber) {
      setError("Phone number not found. Please restart the scanning process.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      // Create FormData
      const formData = new FormData();
      formData.append("user_id", phoneNumber);
      formData.append("merchant_id", merchantId);
      
      // Use appropriate file extension based on actual blob type
      let fileName = "voice_recording.webm"; // Default
      let explicitType = audioBlob.type; // Use actual blob type
      
      if (audioBlob.type.includes('mp4')) {
        fileName = "voice_recording.m4a";
      } else if (audioBlob.type.includes('ogg')) {
        fileName = "voice_recording.ogg";
      } else if (audioBlob.type.includes('wav')) {
        fileName = "voice_recording.wav";
      } else if (audioBlob.type.includes('webm')) {
        fileName = "voice_recording.webm";
      }
      
      // Create a new blob with explicit type to ensure MIME type is preserved
      const fileBlob = new Blob([audioBlob], { type: explicitType });
      formData.append("file", fileBlob, fileName);

      const apiEndpoint = mode === "verify" 
        ? `${process.env.NEXT_PUBLIC_API_URL}/voice/verify`
        : `${process.env.NEXT_PUBLIC_API_URL}/voice/register`;

      logToAndroid(`Submitting voice ${mode}`, {
        endpoint: apiEndpoint,
        user_id: phoneNumber,
        merchant_id: merchantId,
        file_size: audioBlob.size,
        file_type: audioBlob.type,
        file_name: fileName,
        explicit_type: explicitType,
        blob_size_check: audioBlob.size > 0 ? '✅ Has data' : '❌ EMPTY BLOB'
      });

      // Send to API
      const response = await fetch(apiEndpoint, {
        method: "POST",
        body: formData,
      });

      const responseText = await response.text();
      logToAndroid("API Response", { 
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
        
        logToAndroid(`Voice ${mode} successful`, result);
        
        // Call success callback
        if (onSuccess) {
          onSuccess(result);
        }
        
        // Close popup
        onClose();
      } else {
        logToAndroid(`Voice ${mode} failed`, { 
          status: response.status,
          error: responseText 
        });
        setError(`Voice ${mode} failed (${response.status}). Please try again.`);
      }
    } catch (err) {
      logToAndroid(`Error submitting voice ${mode}`, { 
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
                <span className="inline-block animate-spin mr-2">⏳</span>
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
