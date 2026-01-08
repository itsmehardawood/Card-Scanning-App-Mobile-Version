"use client";
import React, { useState, useEffect, useRef } from "react";

// Import components
import ControlPanel from "./components/ControlPanel";
import StatusInformation from "./components/StatusInfo";
import CameraView from "./components/CameraView";
import VoiceVerification from "./components/VoiceVerification";

// Import utilities
import {
  initializeCamera,
  captureFrame,
  cleanupCamera,
  checkCameraPermissions,
  requestCameraPermissions,
  isCameraWorking,
  isIOSDevice,
} from "./utils/CameraUtils";
import { sendFrameToAPI, reportFailure } from "./utils/apiService";
import { useDetection } from "./hooks/UseDetection";
import Image from "next/image";

// Constants for attempt limits and timeouts
const MAX_ATTEMPTS = 5;
const DETECTION_TIMEOUT = 60000; // 60 seconds

const CardDetectionApp = () => {


  // Authentication state
  const [authData, setAuthData] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  const [Merchant, setMerchant] = useState(null);
  const [merchantName, setMerchantName] = useState(null);
  const [merchantLogo, setMerchantLogo] = useState(null);

  // Existing state management
  const [currentPhase, setCurrentPhase] = useState("idle");
  const [detectionActive, setDetectionActive] = useState(false);
  const [finalOcrResults, setFinalOcrResults] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [secureResultId, setSecureResultId] = useState(null);

  // Camera permission state
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState("unknown");
  const [showPermissionAlert, setShowPermissionAlert] = useState(false);
  const [cameraInitialized, setCameraInitialized] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [isIOSDeviceDetected, setIsIOSDeviceDetected] = useState(false);

  // Prompt text state for positioning guidance
  const [showPromptText, setShowPromptText] = useState(false);
  const [promptText, setPromptText] = useState("");

  // Attempt tracking state
  const [attemptCount, setAttemptCount] = useState(0);
  const [maxAttemptsReached, setMaxAttemptsReached] = useState(false);
  const [currentOperation, setCurrentOperation] = useState(""); // 'front', 'back'
  const [fakeCardDetectedPhase, setFakeCardDetectedPhase] = useState(null); // Track which phase detected fake card
  const [debugInfo, setDebugInfo] = useState("");
  const [existingLogoUrl, setExistingLogoUrl] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [formData, setFormData] = useState({
    displayName: "",
    logo: null,
  });
  // Updated frontScanState to include bankLogoDetected
  const [frontScanState, setFrontScanState] = useState({
    framesBuffered: 0,
    chipDetected: false,
    bankLogoDetected: false,
    physicalCardDetected: false,
    canProceedToBack: false,
    motionProgress: null,
    showMotionPrompt: false,
    hideMotionPrompt: false,
    motionPromptTimestamp: null,
  });

  // Captured image state for displaying static frame during scanning
  const [capturedImage, setCapturedImage] = useState(null);
  const [showCaptureSuccessMessage, setShowCaptureSuccessMessage] = useState(false);

  // Flashlight state
  const [flashlightEnabled, setFlashlightEnabled] = useState(false);

  // Voice verification state
  const [showVoiceVerification, setShowVoiceVerification] = useState(false);
  const [voiceVerificationMode, setVoiceVerificationMode] = useState("register"); // "register" or "verify"
  const [isCameraPaused, setIsCameraPaused] = useState(false);

  const [merchantInfo, setMerchantInfo] = useState({
    display_name: "",
    display_logo: "",
    merchant_id: "",
    loading: false,
    error: null,
  });

  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const capturedFrames = useRef([]);
  const countdownIntervalRef = useRef(null);
  const stopRequestedRef = useRef(false);
  const detectionTimeoutRef = useRef(null);
  const currentSessionRef = useRef(null);
  const backSuccessReceivedRef = useRef(false); // Track if back success already received to prevent double processing

  const fetchMerchantDisplayInfo = async (merchantId) => {
    if (!merchantId) {
      console.log("🚫 No merchantId provided to fetchMerchantDisplayInfo");
      return;
    } 

    try {
      console.log("🔍 Fetching merchant display info for:", merchantId);
      setDebugInfo("Fetching existing display info...");

      const response = await fetch(
        `http://52.55.249.9:8001/api/getmerchantDisplayInfo?merchantId=${encodeURIComponent(
          merchantId
        )}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      console.log("📡 GET API Response status:", response.status);

      let result;
      const contentType = response.headers.get("content-type");

      if (contentType && contentType.includes("application/json")) {
        result = await response.json();
      } else {
        const textResult = await response.text();
        console.log("Non-JSON response:", textResult);

        try {
          result = JSON.parse(textResult);
        } catch {
          result = { message: textResult };
        }
      }

      console.log("📊 GET API Response result:", result);

      // new version to make sure https

      if (response.ok && (result.status === true || result.success === true)) {
        if (result.data) {
          const { display_name, display_logo } = result.data;

          if (display_name) {
            console.log("✅ Setting merchant name:", display_name);
            setMerchantName(display_name);
          }

          if (display_logo) {
            // 🔒 Force HTTPS
            const safeLogo = display_logo.replace(/^http:\/\//i, "http://");
            console.log("✅ Setting merchant logo:", safeLogo);
            setMerchantLogo(safeLogo);
          }

          setDebugInfo("Existing data loaded successfully");
        } else {
          setDebugInfo("No existing data found");
        }
      } else {
        setDebugInfo("No existing data found or API error");
      }
    } catch (error) {
      console.error("❌ Error fetching merchant display info:", error);
      setDebugInfo(`Error fetching data: ${error.message}`);
    }
  };

  // Call fetchMerchantDisplayInfo when Merchant state is updated
  useEffect(() => {
    if (Merchant) {
      console.log("� Merchant ID available, fetching display info:", Merchant);
      fetchMerchantDisplayInfo(Merchant);
    }
  }, [Merchant]);

  // Trigger voice verification popup after successful scan
  useEffect(() => {
    if (currentPhase === "awaiting-voice-verification") {
      console.log("⏳ Awaiting voice verification - encrypted data NOT exposed yet");
      // Stop camera completely to free up audio resources for voice recording
      stopCameraForVoice();
      // Voice verification popup is already shown in back scan success handler
      // Data is secured on server and not accessible to Android until verification completes
    }
    
    if (currentPhase === "results" && finalOcrResults) {
      console.log("✅ Voice verification completed AND results phase - data now accessible to Android");
      // Restart camera if it was stopped for voice recording
      if (isCameraPaused) {
        restartCameraAfterVoice();
      }
    }
  }, [currentPhase, finalOcrResults]);

  // Initialize window.scanStatus for Android polling
  useEffect(() => {
    // Set initial incomplete status
    window.scanStatus = {
      complete_scan: false,
      status: "idle",
      message: "Scan not started"
    };

    // Expose polling function for Android
    window.getScanStatus = async () => {
      if (!sessionId) {
        return {
          complete_scan: false,
          status: "no_session"
        };
      }

      try {
        const response = await fetch(
          `/securityscan/api/secure-results?sessionId=${sessionId}`
        );
        const data = await response.json();
        
        // Update window.scanStatus with server response
        window.scanStatus = {
          complete_scan: data.complete_scan || false,
          status: data.status,
          encrypted_data: data.encrypted_data || null,
          ...data
        };
        
        return window.scanStatus;
      } catch (error) {
        return {
          complete_scan: false,
          status: "error",
          error: error.message
        };
      }
    };

    return () => {
      delete window.getScanStatus;
      delete window.scanStatus;
    };
  }, [sessionId]);

  // Handles camera permission errors and provides user feedback
  const handleCameraPermissionError = (errorType) => {
    console.log('📹 Camera permission error:', errorType);
    setCameraInitialized(false);
    
    switch (errorType) {
      case 'PERMISSION_DENIED':
        setCameraPermissionStatus('denied');
        setCameraError('Camera permission denied. Please enable camera access and try again.');
        setShowPermissionAlert(true);
        break;
      case 'NO_CAMERA':
        setCameraError('No camera device found. Please ensure your device has a camera.');
        setShowPermissionAlert(true);
        break;
      case 'CAMERA_IN_USE':
        setCameraError('Camera is currently in use by another application. Please close other camera apps and try again.');
        setShowPermissionAlert(true);
        break;
      case 'GENERIC_ERROR':
      default:
        setCameraError('Unable to access camera. Please check permissions and try again.');
        setShowPermissionAlert(true);
        break;
    }
  };

  //  REQUEST CAMERA PERMISSIONS
  // Attempts to request camera permissions again
  const handleRequestCameraPermission = async () => {
    console.log('🔄 Requesting camera permissions...');
    setShowPermissionAlert(false);
    setCameraError('');
    
    try {
      await requestCameraPermissions(videoRef, handleCameraPermissionError);
      setCameraInitialized(true);
      setCameraPermissionStatus('granted');
      console.log('✅ Camera permissions granted and camera initialized');
    } catch (error) {
      console.error('❌ Camera permission request failed:', error);
      // Error handling is done in handleCameraPermissionError
    }
  };


  const checkCameraStatus = async () => {
  if (!cameraInitialized) return;
  
  const isWorking = isCameraWorking(videoRef);
  if (!isWorking) {
    console.log('📹 Camera stopped working, likely permission revoked');
    setCameraInitialized(false);
    setCameraPermissionStatus('prompt');
    setShowPermissionAlert(true);
    setCameraError('Camera access lost. This may happen when "Only This Time" permission expires. Please grant camera access again.');
    return;
  }

  // Additional WebView permission test
  try {
    const testStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240 }
    });
    testStream.getTracks().forEach(track => track.stop());
  } catch (testError) {
    if (testError.name === 'NotAllowedError') {
      console.log('📹 Permission test failed - permission expired');
      setCameraInitialized(false);
      setCameraPermissionStatus('denied');
      setShowPermissionAlert(true);
      setCameraError('Camera permission expired. Please grant camera access again.');
    }
  }
};

  // Zoom control functions
  const applyZoom = async (zoomLevel = 1.5) => {
    try {
      // 📱 Skip zoom on iOS to avoid lens switching and zoom artifacts
      if (isIOSDeviceDetected) {
        console.log('📱 iOS device - skipping zoom to avoid lens switching');
        return false;
      }

      const stream = videoRef.current?.srcObject;
      if (stream) {
        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities();
        
        if (capabilities.zoom) {
          const settings = track.getSettings();
          const maxZoom = capabilities.zoom.max;
          const minZoom = capabilities.zoom.min;
          const targetZoom = Math.min(zoomLevel, maxZoom);
          
          await track.applyConstraints({
            advanced: [{ zoom: targetZoom }]
          });
          console.log(`🔍 Zoom applied: ${targetZoom}x`);
          return true;
        } else {
          console.log("⚠️ Zoom not supported on this device");
          return false;
        }
      }
    } catch (error) {
      console.error("❌ Error applying zoom:", error);
      return false;
    }
  };

  const resetZoom = async () => {
    try {
      // 📱 Skip zoom reset on iOS
      if (isIOSDeviceDetected) {
        console.log('📱 iOS device - skipping zoom reset');
        return false;
      }

      const stream = videoRef.current?.srcObject;
      if (stream) {
        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities();
        
        if (capabilities.zoom) {
          await track.applyConstraints({
            advanced: [{ zoom: capabilities.zoom.min || 1 }]
          });
          console.log("🔍 Zoom reset to normal");
        }
      }
    } catch (error) {
      console.error("❌ Error resetting zoom:", error);
    }
  };

  // Stop camera completely to free up resources for voice recording
  const stopCameraForVoice = () => {
    try {
      const stream = videoRef.current?.srcObject;
      if (stream) {
        // Stop all tracks completely (not just disable)
        stream.getTracks().forEach(track => {
          track.stop();
          console.log("⏹️ Camera track stopped for voice:", track.label);
        });
        // Clear the video source
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
        setIsCameraPaused(true);
        console.log("⏹️ Camera fully stopped for voice recording");
      }
    } catch (error) {
      console.error("❌ Error stopping camera:", error);
    }
  };

  // Restart camera after voice recording
  const restartCameraAfterVoice = async () => {
    try {
      console.log("🔄 Restarting camera after voice recording...");
      
      // Reinitialize camera
      await initializeCamera(videoRef, handleCameraPermissionError);
      setIsCameraPaused(false);
      console.log("✅ Camera restarted successfully after voice recording");
    } catch (error) {
      console.error("❌ Error restarting camera:", error);
      setCameraError('Failed to restart camera. Please refresh the page.');
      setShowPermissionAlert(true);
    }
  };

  // Flashlight control functions
  const enableFlashlight = async () => {
    try {
      // 📱 Skip flashlight on iOS to avoid torch lens selection and zoom issues
      if (isIOSDeviceDetected) {
        console.log('📱 iOS device - skipping flashlight to avoid lens switching');
        return false;
      }

      const stream = videoRef.current?.srcObject;
      if (stream) {
        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities();
        
        if (capabilities.torch) {
          await track.applyConstraints({
            advanced: [{ torch: true }]
          });
          setFlashlightEnabled(true);
          console.log("🔦 Flashlight enabled");
          
          // Apply zoom when flashlight is enabled
          await applyZoom(2);
          
          return true;
        } else {
          console.log("⚠️ Flashlight not supported on this device");
          return false;
        }
      }
    } catch (error) {
      console.error("❌ Error enabling flashlight:", error);
      return false;
    }
  };

  const disableFlashlight = async () => {
    try {
      // 📱 Skip flashlight disable on iOS
      if (isIOSDeviceDetected) {
        console.log('📱 iOS device - skipping flashlight disable');
        return false;
      }

      const stream = videoRef.current?.srcObject;
      if (stream) {
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        
        // Only disable if flashlight is currently enabled
        if (settings.torch === true) {
          await track.applyConstraints({
            advanced: [{ torch: false }]
          });
          setFlashlightEnabled(false);
          console.log("🔦 Flashlight disabled");
        } else {
          console.log("🔦 Flashlight already disabled, skipping");
        }
        
        // Reset zoom when flashlight is disabled
        await resetZoom();
      }
    } catch (error) {
      console.error("❌ Error disabling flashlight:", error);
      // Try to reset zoom even if flashlight disable failed
      try {
        await resetZoom();
      } catch (zoomError) {
        console.error("❌ Error resetting zoom:", zoomError);
      }
    }
  };

  // Helper function to handle detection failures with attempt tracking
  const handleDetectionFailure = (message, operation) => {
    console.log(`🚨 Detection failure - Operation: ${operation}, Session ID: ${sessionId}, Current Attempt: ${attemptCount + 1}`);
    clearDetectionTimeout();
    stopRequestedRef.current = true;

    // 🔦 Disable flashlight on failure
    disableFlashlight();

    // Clear all intervals
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    setDetectionActive(false);
    setIsProcessing(false);
    setCountdown(0);

    const newAttemptCount = attemptCount + 1;
    setAttemptCount(newAttemptCount);
    setCurrentOperation(operation);

    if (newAttemptCount >= MAX_ATTEMPTS) {
      setMaxAttemptsReached(true);
      setErrorMessage(
        "Maximum attempts reached. Please contact support for assistance."
      );
      setCurrentPhase("max-attempts-reached");
      
      // Report failure to the API when max attempts reached
      const merchantId = authData?.merchantId || window.__WEBVIEW_AUTH__?.merchantId;
      if (sessionId && merchantId) {
        // Format reason with "MAX RETRY REACHED" prefix
        const failureReason = message 
          ? `MAX RETRY REACHED: ${message}` 
          : "MAX RETRY REACHED: Failed after 5 attempts";
        
        reportFailure(
          "", // scan_id (optional - empty since we don't have it)
          sessionId,
          failureReason,
          operation || "unknown",
          merchantId
        ).catch(error => {
          console.error("Failed to send failure report:", error);
        });
      } else {
        console.warn("Cannot send failure report: missing sessionId or merchantId");
      }
    } else {
      setErrorMessage(
        `${message} (Attempt ${newAttemptCount}/${MAX_ATTEMPTS})`
      );
      setCurrentPhase("error");
    }
  };

  // Wrapper function to handle captured image and show success message
  const handleCapturedImage = (imageDataUrl) => {
    setCapturedImage(imageDataUrl);
    setShowCaptureSuccessMessage(true);
    // Auto-hide message after 3 seconds
    setTimeout(() => {
      setShowCaptureSuccessMessage(false);
    }, 3000);
  };

  // Custom hook for detection logic - NOW WITH handleDetectionFailure parameter
  const {
    captureAndSendFramesFront,
    captureAndSendFrames,
    captureIntervalRef,
  } = useDetection(
    videoRef,
    canvasRef,
    sessionId,
    setSessionId,
    setIsProcessing,
    setCurrentPhase,
    setErrorMessage,
    setFrontScanState,
    stopRequestedRef,
    handleDetectionFailure, // ADD THIS PARAMETER
    disableFlashlight, // Pass flashlight control function
    handleCapturedImage // Pass callback to receive captured image immediately
  );

  // Check for authentication data on component mount
  useEffect(() => {
    const checkAuthData = async () => {
      console.log("🔍 Checking for authentication data...");

      const urlParams = new URLSearchParams(window.location.search);
      const sessionId = urlParams.get("session");
      const merchantId = urlParams.get("merchant_id");
      const authToken = urlParams.get("auth_token");
      const source = urlParams.get("source");
      const demo = urlParams.get("demo");

      // Set merchant ID immediately when found in URL params
      if (merchantId) {
        console.log("🏪 Setting merchant ID from URL:", merchantId);
        setMerchant(merchantId);
      }

      // Method 1: Session-based auth (most secure)
      if (sessionId) {
        console.log("🔐 Found session ID, retrieving auth data securely...");
        try {
          const response = await fetch(
            `/securityscan/api/webview-entry?session=${sessionId}`
          );
          if (response.ok) {
            const sessionData = await response.json();
            console.log("✅ Session auth data retrieved:", {
              merchantId: sessionData.merchantId,
              authTokenLength: sessionData.authToken.length,
              authTokenPreview: sessionData.authToken.substring(0, 20) + "...",
              phoneNumber: sessionData.phoneNumber || "Not provided",
            });

            // Store phone number in localStorage if available
            if (sessionData.phoneNumber) {
              localStorage.setItem("phoneNumber", sessionData.phoneNumber);
              console.log("📱 Phone number stored in localStorage:", sessionData.phoneNumber);
            }

            const authObj = {
              merchantId: sessionData.merchantId,
              authToken: sessionData.authToken,
              timestamp: Date.now(),
              source: "secure_session",
            };

            setAuthData(authObj);
            window.__WEBVIEW_AUTH__ = authObj;
            setAuthLoading(false);

            // Set merchant from session data if not already set from URL
            if (sessionData.merchantId) {
              console.log(
                "🏪 Setting merchant ID from session:",
                sessionData.merchantId
              );
              setMerchant(sessionData.merchantId);
            }

            // Clean URL (remove session ID)
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
            return;
          } else {
            console.error("❌ Session retrieval failed:", response.status);
          }
        } catch (error) {
          console.error("❌ Session fetch error:", error);
        }
      }

      // Method 2: URL parameters (fallback, less secure)
      if (merchantId && authToken && authToken.length > 10) {
        console.log("✅ Auth data found from URL params");
        console.log("🔑 Credentials valid:", {
          merchantId,
          authTokenLength: authToken.length,
          authTokenPreview: authToken.substring(0, 20) + "...",
          source,
        });

        const authObj = {
          merchantId,
          authToken,
          timestamp: Date.now(),
          source: source || "url_params",
        };

        setAuthData(authObj);
        window.__WEBVIEW_AUTH__ = authObj;
        setAuthLoading(false);

        // Clean URL for security (remove tokens from address bar)
        if (!demo) {
          const cleanUrl = window.location.pathname;
          window.history.replaceState({}, document.title, cleanUrl);
        }
        return;
      }

      // Method 3: Demo mode (development only)
      if (process.env.NODE_ENV === "development" || demo === "true") {
        console.log("🧪 Using development/demo auth data");
        const demoMerchantId = "276581V33945Y270";
        const demoAuthObj = {
          merchantId: demoMerchantId,
          authToken: "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vNTIuNTUuMjQ5Ljk6ODAwMS9hcGkvbWVyY2hhbnRzY2FuL2dlbmVyYXRlVG9rZW4iLCJpYXQiOjE3Njc4NTk2NDEsImV4cCI6MTc2Nzg2MzI0MSwibmJmIjoxNzY3ODU5NjQxLCJqdGkiOiJuZEhDeDdTd01wdmZKcUNMIiwic3ViIjoiMjc2NTgxVjMzOTQ1WTI3MCIsInBydiI6IjIzYmQ1Yzg5NDlmNjAwYWRiMzllNzAxYzQwMDg3MmRiN2E1OTc2ZjciLCJzY2FuX2lkIjoiZWJhNDIzNjUiLCJtZXJjaGFudF9pZCI6IjI3NjU4MVYzMzk0NVkyNzAiLCJlbmNyeXB0aW9uX2tleSI6IkVhWGFmWGMzVHR5bjBqbmoiLCJmZWF0dXJlcyI6bnVsbH0.WMViEZKhUkvnyySa4SKeWM6kg8Edx5XAJ9Y3Dc7fdPM",
          
          timestamp: Date.now(),
          source: "development_demo",
        };

        setAuthData(demoAuthObj);
        window.__WEBVIEW_AUTH__ = demoAuthObj;
        setAuthLoading(false);

        // Set demo merchant ID if not already set from URL
        if (!merchantId) {
          console.log("🏪 Setting demo merchant ID:", demoMerchantId);
          setMerchant(demoMerchantId);
        }

        return;
      } // No auth data found
      console.error("❌ No authentication data found");
      console.error("Available URL params:", Array.from(urlParams.entries()));
      setAuthError("No authentication data received from Android app");
      setAuthLoading(false);
    };

    checkAuthData();
  }, []);

  // Helper function to clear detection timeout
  const clearDetectionTimeout = () => {
    if (detectionTimeoutRef.current) {
      clearTimeout(detectionTimeoutRef.current);
      detectionTimeoutRef.current = null;
    }
  };

  // Helper function to handle detection timeout
  const startDetectionTimeout = (operation) => {
    if (detectionTimeoutRef.current) {
      clearTimeout(detectionTimeoutRef.current);
    }

    detectionTimeoutRef.current = setTimeout(() => {
      if (!stopRequestedRef.current && (detectionActive || isProcessing)) {
        handleDetectionFailure(
          `${operation} detection timeout. No detection occurred within 40 seconds.`,
          operation
        );
      }
    }, DETECTION_TIMEOUT);
  };

  // Initialize camera after auth is ready
  useEffect(() => {
    if (authData && !authLoading) {
      console.log('📹 Initializing camera with permission handling...');
      
      const initCamera = async () => {
        try {
          // Detect if iOS device and store in state
          const iosDevice = isIOSDevice();
          setIsIOSDeviceDetected(iosDevice);
          console.log(`📱 Device type - iOS: ${iosDevice}`);

          // Check permission status first
          const permissionStatus = await checkCameraPermissions();
          setCameraPermissionStatus(permissionStatus);
          
          if (permissionStatus === 'denied') {
            console.log('📹 Camera permission denied');
            handleCameraPermissionError('PERMISSION_DENIED');
            return;
          }

          // FOR WEBVIEW: Force permission test even if status seems OK
    if (permissionStatus === 'unknown' || permissionStatus === 'granted') {
      try {
        const testStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 }
        });
        testStream.getTracks().forEach(track => track.stop());
        console.log('✅ WebView permission test passed');
      } catch (testError) {
        if (testError.name === 'NotAllowedError') {
          handleCameraPermissionError('PERMISSION_DENIED');
          return;
        }
      }
    }
          // Try to initialize camera with iOS flag
          await initializeCamera(videoRef, handleCameraPermissionError, 'back', iosDevice);
          setCameraInitialized(true);
          setCameraPermissionStatus('granted');
          console.log("✅ Camera initialized successfully");
          
          // Start periodic camera status checking (every 30 seconds)
          const checkInterval = setInterval(checkCameraStatus, 30000);
          
          return () => {
            clearInterval(checkInterval);
          };
          
        } catch (error) {
          console.error("❌ Camera initialization failed:", error);
          setCameraInitialized(false);
          
          // Don't show generic error message, let handleCameraPermissionError handle it
          if (error.message !== 'PERMISSION_DENIED' && 
              error.message !== 'NO_CAMERA' && 
              error.message !== 'CAMERA_IN_USE') {
            setErrorMessage("Camera access failed. Please check permissions and try again.");
          }
        }
      };

      initCamera();
    }

    return () => {
      cleanupCamera(videoRef);
      clearDetectionTimeout();
      setCameraInitialized(false);

      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
      }

      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [authData, authLoading]);




  // Show loading state while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br text-black from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold mb-2">
            Please wait while card scan security begins...
          </h3>
          <p className="text-gray-600 text-sm">
            Loading authentication data from Android app
          </p>
        </div>
      </div>
    );
  }

  // Show error if no authentication data
  if (authError || !authData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full text-center">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-red-600 text-2xl">⚠️</span>
          </div>
          <h3 className="text-lg font-semibold text-red-600 mb-2">
            Authentication Required
          </h3>
          <p className="text-gray-600 text-sm mb-4">
            This page requires authentication data from the Android app.
          </p>

          {/* Development links */}
          {process.env.NODE_ENV === "development" && (
            <div className="bg-gray-50 p-3 rounded mb-4 text-left">
              <p className="text-xs font-semibold mb-2">Development Testing:</p>
              <div className="space-y-1">
                <a
                  href="?demo=true"
                  className="block text-blue-600 text-xs hover:underline"
                >
                  🧪 Use Demo Mode
                </a>
                <a
                  href="?merchant_id=MERCHANT_12345&auth_token=test_jwt_token_1234567890123456"
                  className="block text-blue-600 text-xs hover:underline"
                >
                  🔧 Test with URL Parameters
                </a>
              </div>
            </div>
          )}

          <button
            onClick={() => window.location.reload()}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Stop function to halt all active processes
  const stopDetection = () => {
    console.log("🛑 Stopping detection...");
    stopRequestedRef.current = true;
    clearDetectionTimeout();

    // Clear all intervals
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    // Reset states immediately
    setDetectionActive(false);
    setIsProcessing(false);
    setCountdown(0);
    setCapturedImage(null); // Clear captured image
    setShowCaptureSuccessMessage(false); // Clear success message
    
    // Hide prompt text when stopping
    setShowPromptText(false);

    // Return to appropriate phase based on current state
    if (currentPhase === "front-countdown" || currentPhase === "front") {
      setCurrentPhase("idle");
      setFrontScanState({
        framesBuffered: 0,
        chipDetected: false,
        bankLogoDetected: false,
        physicalCardDetected: false,
        canProceedToBack: false,
        motionProgress: null,
        showMotionPrompt: false,
        hideMotionPrompt: false,
        motionPromptTimestamp: null,
      });
    } else if (currentPhase === "back-countdown" || currentPhase === "back") {
      setCurrentPhase("ready-for-back");
    } else {
      setCurrentPhase("idle");
    }
  };

  // Countdown function
  const startCountdown = (onComplete) => {
    setCountdown(3);
    stopRequestedRef.current = false;

    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          if (!stopRequestedRef.current) {
            onComplete();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Start card scanning directly with front side detection
  const startCardScanning = async () => {
    console.log("🚀 startCardScanning called, maxAttemptsReached:", maxAttemptsReached, "detectionActive:", detectionActive);
    if (maxAttemptsReached || detectionActive) return;

    // 📹 CHECK CAMERA STATUS BEFORE SCANNING
    if (!cameraInitialized || !isCameraWorking(videoRef)) {
      console.log('📹 Camera not ready, requesting permissions...');
      setCameraError('Camera access is required to start scanning. Please enable camera permissions.');
      setShowPermissionAlert(true);
      return;
    }

    // Initialize session ONLY if not already set
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      currentSessionId = `session_${Date.now()}`;
      setSessionId(currentSessionId);
      console.log('🆔 Created new session ID:', currentSessionId);
    } else {
      console.log('🆔 Using existing session ID:', currentSessionId);
    }

    // Reset states and start front side detection
    setErrorMessage("");
    // Only reset attempt count if this is a truly new session (not a retry)
    if (!sessionId) {
      setAttemptCount(0);
      console.log('🆔 New session - resetting attempt count');
    } else {
      console.log('🆔 Existing session - maintaining attempt count:', attemptCount);
    }
    setCurrentOperation("");
    
    setFrontScanState({
      framesBuffered: 0,
      chipDetected: false,
      bankLogoDetected: false,
      physicalCardDetected: false,
      canProceedToBack: false,
      motionProgress: null,
      showMotionPrompt: false,
      hideMotionPrompt: false,
      motionPromptTimestamp: null,
    });

    // Show prompt text for front side positioning
    setPromptText("Position your card's front side in the camera square frame for security scan");
    setShowPromptText(true);

    // Go directly to front side detection
    setCurrentPhase("front-countdown");

    startCountdown(async () => {
      if (stopRequestedRef.current) return;

      // DON'T set phase to 'front' yet - wait for frames to be captured first
      // setCurrentPhase("front"); // MOVED INSIDE CALLBACK
      
      // Hide prompt text when detection starts
      setShowPromptText(false);
      setDetectionActive(true);
      stopRequestedRef.current = false;

      // Start detection timeout
      startDetectionTimeout("Front side");

      try {
        const apiResponse = await captureAndSendFramesFront(
          "front", 
          currentSessionId, 
          enableFlashlight,
          () => {
            // This callback is called AFTER Frame #2 is captured and displayed
            // Now it's safe to change phase without hiding the video
            console.log("🔄 Setting phase to 'front' after frames captured");
            setCurrentPhase("front");
          }
        );
        
        // Store captured image for display
        if (apiResponse?.capturedImage) {
          setCapturedImage(apiResponse.capturedImage);
        }

        if (!stopRequestedRef.current) {
          clearDetectionTimeout();
          setDetectionActive(false);
          // Don't reset attempt count here - only reset on complete success (both front and back)
          setCurrentOperation("");
          setCurrentPhase("ready-for-back");
        }
      } catch (error) {
        console.error("Front side detection failed:", error);
        setDetectionActive(false);
        if (!stopRequestedRef.current) {
          // Check for fake card detection error
          if (error.message && error.message.includes('Unacceptable Card Detection')) {
            console.log("🚫 Fake card detected on front side - stopping scan");
            setErrorMessage('Sorry, we do not accept screen detection cards - make sure you physically have the bank card for security scanning.');
            setCurrentPhase('fake-card-error');
            setFakeCardDetectedPhase('front');
            return;
          }
          
          handleDetectionFailure(
            `Front side detection failed: ${error.message}`,
            "front"
          );
        }
      }
    });
  };

  const startFrontSideDetection = async () => {
    console.log("🚀 startFrontSideDetection called, maxAttemptsReached:", maxAttemptsReached, "detectionActive:", detectionActive);
    if (maxAttemptsReached || detectionActive) return;

    // 📹 CHECK CAMERA STATUS BEFORE SCANNING
    if (!cameraInitialized || !isCameraWorking(videoRef)) {
      console.log('📹 Camera not ready for front scanning, requesting permissions...');
      setCameraError('Camera access is required to scan the front side. Please enable camera permissions.');
      setShowPermissionAlert(true);
      return;
    }

    // Ensure we have a session ID
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      currentSessionId = `session_${Date.now()}`;
      setSessionId(currentSessionId);
      console.log('🆔 Created new session ID for front scan:', currentSessionId);
    } else {
      console.log('🆔 Using existing session ID for front scan:', currentSessionId);
    }

    setFrontScanState({
      framesBuffered: 0,
      chipDetected: false,
      bankLogoDetected: false,
      physicalCardDetected: false,
      canProceedToBack: false,
      motionProgress: null,
      showMotionPrompt: false,
      hideMotionPrompt: false,
      motionPromptTimestamp: null,
    });

    // Show prompt text for front side positioning
    setPromptText("Position your card's front side in the camera square frame showing the chip and bank logo clearly");
    setShowPromptText(true);

    setCurrentPhase("front-countdown");
    setErrorMessage("");

    startCountdown(async () => {
      if (stopRequestedRef.current) return;

      // DON'T set phase to 'front' yet - wait for frames to be captured first
      // setCurrentPhase("front"); // MOVED INSIDE CALLBACK
      
      // Hide prompt text when detection starts
      setShowPromptText(false);
      setDetectionActive(true);
      stopRequestedRef.current = false;

      // Start detection timeout
      startDetectionTimeout("Front side");

      try {
        const apiResponse = await captureAndSendFramesFront(
          "front", 
          currentSessionId, 
          enableFlashlight,
          () => {
            // This callback is called AFTER Frame #2 is captured and displayed
            // Now it's safe to change phase without hiding the video
            console.log("🔄 Setting phase to 'front' after frames captured (startFrontSideDetection)");
            setCurrentPhase("front");
          }
        );
        
        // Store captured image for display
        if (apiResponse?.capturedImage) {
          setCapturedImage(apiResponse.capturedImage);
        }

        if (!stopRequestedRef.current) {
          clearDetectionTimeout();
          setDetectionActive(false);
          // Don't reset attempt count here - only reset on complete success (both front and back)
          setCurrentOperation("");
          setCurrentPhase("ready-for-back");
        }
      } catch (error) {
        console.error("Front side detection failed:", error);
        setDetectionActive(false);
        if (!stopRequestedRef.current) {
          // Check for fake card detection error
          if (error.message && error.message.includes('Unacceptable Card Detection')) {
            console.log("🚫 Fake card detected on front side - stopping scan");
            setErrorMessage('Sorry, we do not accept screen detection cards - make sure you physically have the bank card for security scanning.');
            setCurrentPhase('fake-card-error');
            setFakeCardDetectedPhase('front');
            return;
          }
          
          handleDetectionFailure(
            `Front side detection failed: ${error.message}`,
            "front"
          );
        }
      }
    });
  };

  const startBackSideDetection = async () => {
    if (maxAttemptsReached) return;

    // 📹 CHECK CAMERA STATUS BEFORE SCANNING
    if (!cameraInitialized || !isCameraWorking(videoRef)) {
      console.log('📹 Camera not ready for back scanning, requesting permissions...');
      setCameraError('Camera access is required to scan the back side. Please enable camera permissions.');
      setShowPermissionAlert(true);
      return;
    }

    // Ensure we have the same session ID from front scan
    if (!sessionId) {
      console.error('❌ No session ID available for back scan! This should not happen.');
      setErrorMessage('Session error occurred. Please restart the scanning process.');
      setCurrentPhase('error');
      return;
    }
    console.log('🆔 Using session ID for back scan:', sessionId);

    // 🔄 Clear the front side captured image so user sees live video during flashlight phase
    setCapturedImage(null);
    setShowCaptureSuccessMessage(false); // Clear success message

    // Show prompt text for back side positioning
    setPromptText("Position your card's back side in the camera square frame for security scan");
    setShowPromptText(true);

    setCurrentPhase("back-countdown");
    setErrorMessage("");

    // Reset back success flag at start of back detection
    backSuccessReceivedRef.current = false;

    startCountdown(async () => {
      if (stopRequestedRef.current) return;

      setCurrentPhase("back");
      
      // Hide prompt text when detection starts
      setShowPromptText(false);
      setDetectionActive(true);
      stopRequestedRef.current = false;

      startDetectionTimeout("Back side");

      try {
        const finalResult = await captureAndSendFrames("back", sessionId, enableFlashlight);
        
        // 🛡️ CRITICAL: If success was already received, ignore this result completely
        if (backSuccessReceivedRef.current) {
          console.log("🛡️ Back success already received, ignoring subsequent result:", finalResult?.status);
          return;
        }
        
        // Store captured image for display
        if (finalResult?.capturedImage) {
          setCapturedImage(finalResult.capturedImage);
        }

        if (!stopRequestedRef.current) {
          clearDetectionTimeout();
          setDetectionActive(false);

          console.log("🔍 Checking final result:", finalResult);

          // 🎯 PRIORITY FIX: Match the hook's success logic - status "success" OR "already_completed" is sufficient
          if (finalResult?.status === "success" || finalResult?.status === "already_completed") {
            // 🛡️ CRITICAL: Mark success received IMMEDIATELY to prevent any subsequent processing
            backSuccessReceivedRef.current = true;
            stopRequestedRef.current = true; // Also stop any further detection
            
            console.log(
              "✅ SUCCESS/ALREADY_COMPLETED STATUS received - securing data on server"
            );
            console.log(`Status: ${finalResult.status}, Score: ${finalResult.score}`);
            
            // 🔦 Disable flashlight on success
            await disableFlashlight();
            
            // 🔒 CRITICAL: Store encrypted data on SERVER (not in React state)
            try {
              const response = await fetch('/securityscan/api/secure-results', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sessionId: sessionId,
                  scanData: finalResult,
                  merchantId: authData?.merchantId
                })
              });

              const data = await response.json();

              if (data.success) {
                console.log(`🔒 Encrypted data stored securely: ${data.resultId}`);
                console.log(`   └─ Status: ${data.status}`);
                console.log(`   └─ Android access: BLOCKED until voice verification`);
                
                // Store ONLY the result ID (not the actual encrypted data)
                setSecureResultId(data.resultId);
                
                // Set window status for Android (incomplete until voice verification)
                window.scanStatus = {
                  complete_scan: false, // ❌ Android will NOT process
                  status: "pending_voice_verification",
                  message: "Awaiting voice verification"
                };
                
                console.log("🚫 Android sees: complete_scan = false");
                
                setCurrentPhase("back-complete");
                setAttemptCount(0);
                setCurrentOperation("");
                
                // ⚠️ DO NOT set finalOcrResults here - data stays on server
                // ⚠️ DO NOT expose encrypted_data to window object
                
                // Check voice registration status before showing verification
                setTimeout(async () => {
                  await checkVoiceRegistrationStatus();
                  setCurrentPhase("awaiting-voice-verification");
                  setShowVoiceVerification(true);
                }, 100);
              } else {
                throw new Error(data.error || 'Failed to store scan results');
              }
            } catch (error) {
              console.error("❌ Failed to secure scan results:", error);
              setErrorMessage("Failed to process scan results. Please try again.");
              setCurrentPhase("error");
            }
          } else {
            // 🛡️ Double check - if success was already received, don't process failure
            if (backSuccessReceivedRef.current) {
              console.log("🛡️ Back success already received, ignoring failure path");
              return;
            }
            console.log(
              "⚠️ Scan result didn't meet success criteria"
            );
            handleDetectionFailure("Back scan incomplete or failed.", "back");
          }
        }
      } catch (error) {
        // 🛡️ CRITICAL: If success was already received, ignore any errors
        if (backSuccessReceivedRef.current) {
          console.log("🛡️ Back success already received, ignoring error:", error.message);
          return;
        }
        
        console.error("Back side detection failed:", error);
        setDetectionActive(false);
        if (!stopRequestedRef.current) {
          // Check for fake card detection error
          if (error.message && error.message.includes('Unacceptable Card Detection')) {
            console.log("🚫 Unacceptable card detected on back side - stopping scan");
            setErrorMessage('Sorry, we do not accept screen detection cards - make sure you physically have the bank card for security scanning.');
            setCurrentPhase('fake-card-error');
            setFakeCardDetectedPhase('back');
            return;
          }
          
          // For validation failures, handleDetectionFailure is already called in UseDetection
          // but we still need to handle other types of errors
          if (error.message === "Back validation failed") {
            console.log("🔍 Validation failure error caught - handleDetectionFailure already called with attempt counting");
            // handleDetectionFailure was already called in UseDetection hook, so just return
            return;
          }
          
          // Handle other types of detection failures
          handleDetectionFailure(
            `Back side detection failed: ${error.message}`,
            "back"
          );
        }
      }
    });
  };

  const resetApplication = () => {
    stopRequestedRef.current = true;
    backSuccessReceivedRef.current = false; // Reset back success flag
    clearDetectionTimeout();

    setCurrentPhase("idle");
    setDetectionActive(false);
    setFinalOcrResults(null);
    setIsProcessing(false);
    setCountdown(0);
    setErrorMessage("");
    setSessionId("");
    setCapturedImage(null); // Clear captured image
    setShowCaptureSuccessMessage(false); // Clear success message
    
    // Reset prompt text state
    setShowPromptText(false);
    setPromptText("");

    // Reset attempt tracking completely - this is for "Start New Session"
    setAttemptCount(0);
    setMaxAttemptsReached(false);
    setCurrentOperation("");

    setFrontScanState({
      framesBuffered: 0,
      chipDetected: false,
      bankLogoDetected: false,
      physicalCardDetected: false,
      canProceedToBack: false,
      motionProgress: null,
      showMotionPrompt: false,
      hideMotionPrompt: false,
      motionPromptTimestamp: null,
    });
    capturedFrames.current = [];

    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }

    stopRequestedRef.current = false;
  };

  // New function specifically for "Try Again" - keeps attempt count and session ID
  const handleTryAgain = () => {
    console.log("🔄 handleTryAgain called - stopping all detection processes");
    console.log("🆔 Maintaining session ID:", sessionId, "for attempt tracking");
    
    // CRITICAL: Stop all detection immediately
    stopRequestedRef.current = true;
    backSuccessReceivedRef.current = false; // Reset back success flag
    clearDetectionTimeout();

    // Clean up intervals FIRST
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    // Reset all states immediately
    setDetectionActive(false);
    setIsProcessing(false);
    setCountdown(0);
    setErrorMessage("");
    setCapturedImage(null); // Clear captured image
    setShowCaptureSuccessMessage(false); // Clear success message
    
    // Reset prompt text state
    setShowPromptText(false);
    setPromptText("");

    // For back side validation failures, keep session ID and return to idle to restart from front
    if (currentOperation === "back") {
      console.log("🔄 Back side validation failed - keeping session ID for attempt tracking");
      // DO NOT reset session ID - keep it for proper attempt tracking
      
      // Use setTimeout to ensure all async processes have stopped
      setTimeout(() => {
        setCurrentPhase("idle");
        stopRequestedRef.current = false; // Reset after transition
      }, 100);
      
      setFrontScanState({
        framesBuffered: 0,
        chipDetected: false,
        bankLogoDetected: false,
        physicalCardDetected: false,
        canProceedToBack: false,
        motionProgress: null,
        showMotionPrompt: false,
        hideMotionPrompt: false,
        motionPromptTimestamp: null,
      });
    } else if (currentOperation === "front") {
      console.log("🔄 Front side validation failed - keeping session ID for attempt tracking");
      // DO NOT reset session ID - keep it for proper attempt tracking
      
      setTimeout(() => {
        setCurrentPhase("idle");
        stopRequestedRef.current = false; // Reset after transition
      }, 100);
      
      setFrontScanState({
        framesBuffered: 0,
        chipDetected: false,
        bankLogoDetected: false,
        physicalCardDetected: false,
        canProceedToBack: false,
        motionProgress: null,
        showMotionPrompt: false,
        hideMotionPrompt: false,
        motionPromptTimestamp: null,
      });
    } else {
      // Default fallback - keep session ID for attempt tracking
      console.log("🔄 Default fallback - keeping session ID for attempt tracking");
      // DO NOT reset session ID - keep it for proper attempt tracking
      
      setTimeout(() => {
        setCurrentPhase("idle");
        stopRequestedRef.current = false; // Reset after transition
      }, 100);
    }
  };

  const handleStartOver = () => {
    stopRequestedRef.current = true;
    clearDetectionTimeout();
    setCurrentPhase("idle");
    setErrorMessage("");
    // Reset attempt tracking when starting over
    setAttemptCount(0);
    setMaxAttemptsReached(false);
    setCurrentOperation("");
    stopRequestedRef.current = false;
  };

  // Check if user has already registered their voice
  const checkVoiceRegistrationStatus = async () => {
    const userId = authData?.phoneNumber;
    
    if (!userId) {
      console.warn("⚠️ No phone number found, defaulting to registration mode");
      setVoiceVerificationMode("register");
      return;
    }

    try {
      console.log(`🔍 Checking voice registration status for user: ${userId}`);
      
      const response = await fetch(
        `https://admin.cardnest.io/api/voice/register/${userId}`
      );
      
      if (response.ok) {
        const data = await response.json();
        console.log("✅ Voice registration status:", data);
        
        // If status is true, user is already registered → use verify mode
        // If status is false, user needs to register → use register mode
        if (data.status === true) {
          console.log("✅ User already registered - switching to VERIFY mode");
          setVoiceVerificationMode("verify");
        } else {
          console.log("📝 User not registered - switching to REGISTER mode");
          setVoiceVerificationMode("register");
        }
      } else {
        console.warn("⚠️ Could not check registration status, defaulting to registration mode");
        setVoiceVerificationMode("register");
      }
    } catch (error) {
      console.error("❌ Error checking voice registration status:", error);
      // Default to registration mode on error
      setVoiceVerificationMode("register");
    }
  };

  const handleVoiceVerificationSuccess = async (result) => {
    console.log("✅ Voice verification completed successfully:", result);
    
    if (!secureResultId) {
      console.error("❌ No secure result ID found");
      setErrorMessage("Verification succeeded but scan reference was lost.");
      return;
    }

    try {
      // Step 1: Mark result as voice-verified on server
      const verifyResponse = await fetch('/securityscan/api/secure-results', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resultId: secureResultId,
          verificationId: result.verification_id || result.id || `voice_${Date.now()}`
        })
      });

      const verifyData = await verifyResponse.json();

      if (!verifyData.success) {
        throw new Error(verifyData.error || 'Failed to verify result');
      }

      console.log("✅ Server confirmed voice verification");

      // Step 2: Retrieve verified data from server
      const dataResponse = await fetch(
        `/securityscan/api/secure-results?resultId=${secureResultId}`
      );
      
      const finalData = await dataResponse.json();

      if (finalData.success && finalData.status === "verified") {
        console.log("🔓 Encrypted data released after voice verification");
        
        // NOW expose to React state
        setFinalOcrResults(finalData);
        setCurrentPhase("results");

        // 🔓 CRITICAL: NOW set complete_scan = true for Android
        window.scanStatus = {
          complete_scan: true, // ✅ Android can NOW process
          encrypted_data: finalData.encrypted_data,
          status: "verified",
          voice_verified: true,
          verification_id: result.verification_id || result.id,
          // Include all scan data fields for Android
          ...finalData
        };

        console.log("✅ Android can now access: window.scanStatus");
        console.log("   └─ complete_scan: true");
        console.log("   └─ encrypted_data: [PRESENT]");
        console.log("   └─ voice_verified: true");

        // Cleanup
        setSecureResultId(null);
        setShowVoiceVerification(false);
        
      } else if (finalData.status === "pending_voice_verification") {
        throw new Error("Verification not recorded on server");
      } else {
        throw new Error(finalData.error || 'Failed to retrieve scan data');
      }
      
    } catch (error) {
      console.error("❌ Error after voice verification:", error);
      setErrorMessage(`Verification failed: ${error.message}`);
      setCurrentPhase("error");
    }
  };

  const handleVoiceVerificationClose = async () => {
    console.log("⚠️ Voice verification popup closed without completion");
    
    // Restart camera if it was stopped
    if (isCameraPaused) {
      await restartCameraAfterVoice();
    }
    
    if (secureResultId) {
      console.log(`🗑️ Discarding unverified result: ${secureResultId}`);
      
      // Delete from server
      fetch(`/securityscan/api/secure-results?resultId=${secureResultId}`, {
        method: 'DELETE'
      }).catch(err => console.error("Failed to delete result:", err));
      
      setSecureResultId(null);
    }
    
    // Reset Android status
    window.scanStatus = {
      complete_scan: false,
      status: "cancelled",
      message: "Voice verification cancelled"
    };
    
    setShowVoiceVerification(false);
    setErrorMessage("Voice verification cancelled. Please scan your card again.");
    setCurrentPhase("idle");
  };

  const handleFakeCardRetry = () => {
    console.log("🔄 Fake card retry - Restarting from phase:", fakeCardDetectedPhase);
    
    // Increment attempt count
    const newAttemptCount = attemptCount + 1;
    setAttemptCount(newAttemptCount);
    console.log(`🔢 Fake card retry attempt count: ${newAttemptCount}/${MAX_ATTEMPTS}`);
    
    // Check if max attempts reached
    if (newAttemptCount >= MAX_ATTEMPTS) {
      setMaxAttemptsReached(true);
      setErrorMessage("Maximum attempts reached. Please contact support for assistance.");
      setCurrentPhase("max-attempts-reached");
      setFakeCardDetectedPhase(null);
      return;
    }
    
    // Clear error state
    setErrorMessage("");
    stopRequestedRef.current = false;
    
    // Restart from the appropriate phase
    if (fakeCardDetectedPhase === 'front') {
      console.log("🔄 Restarting from front side scan");
      setCurrentPhase("idle");
      setFakeCardDetectedPhase(null);
      // Don't reset session - use same session for tracking
    } else if (fakeCardDetectedPhase === 'back') {
      console.log("🔄 Restarting from back side scan");
      setCurrentPhase("ready-for-back");
      setFakeCardDetectedPhase(null);
      // Keep the same session since front was successful
    } else {
      // Fallback to idle
      setCurrentPhase("idle");
      setFakeCardDetectedPhase(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-700 to-black p-4 sm:p-4">
      <div className="container mx-auto max-w-4xl">
        {/* Debug info (only shows in development) */}
        <div className="flex items-center justify-center bg-white p-2 sm:p-4 rounded-md mb-4 sm:mb-8 shadow">
          {merchantLogo && (
            <img
              width={50}
              height={50}
              src={merchantLogo}
              alt="Merchant Logo"
              className=" h-15 w-15 object-contain mr-3"
            />
          )}
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900">
            {merchantName || "Card Security Scan"}

          </h1>
        </div>

        {/* Camera Permission Alert Dialog */}
        {showPermissionAlert && (
          <div className="fixed inset-0 bg-black/80 bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full">
              <div className="text-center">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-red-600 text-3xl">📹</span>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Camera Access Required
                </h3>
                <p className="text-gray-600 text-sm mb-6">
                  {cameraError || "Camera permission is required to scan your card. Please enable camera access to continue."}
                </p>
                
                {cameraPermissionStatus === 'denied' && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                    <p className="text-yellow-800 text-xs">
<strong>Note:</strong> If you selected &quot;Only This Time&quot; previously, you&apos;ll need to grant permission again.
                    </p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <button
                    onClick={handleRequestCameraPermission}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                  >
                    Enable Camera Access
                  </button>
                  <button
                    onClick={() => setShowPermissionAlert(false)}
                    className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-6 py-3 rounded-lg font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                
            <div className="mt-4 text-xs text-gray-500">
  {`For best experience, select "Allow" when prompted for camera permission`}
</div>

              </div>
            </div>
          </div>
        )}

        <CameraView
          videoRef={videoRef}
          canvasRef={canvasRef}
          currentPhase={currentPhase}
          countdown={countdown}
          detectionActive={detectionActive}
          frontScanState={frontScanState}
          isProcessing={isProcessing}
          showPromptText={showPromptText}
          promptText={promptText}
          capturedImage={capturedImage}
          showCaptureSuccessMessage={showCaptureSuccessMessage}
        />

        <ControlPanel
          currentPhase={currentPhase}
          onStartValidation={startCardScanning}
          onStartFrontScan={startFrontSideDetection}
          onStartBackScan={startBackSideDetection}
          onStop={stopDetection}
          onReset={resetApplication}
          onTryAgain={handleTryAgain}
          onStartOver={handleStartOver}
          onFakeCardRetry={handleFakeCardRetry}
          fakeCardDetectedPhase={fakeCardDetectedPhase}
          frontScanState={frontScanState}
          countdown={countdown}
          errorMessage={errorMessage}
          finalOcrResults={finalOcrResults}
          detectionActive={detectionActive}
          isProcessing={isProcessing}
          attemptCount={attemptCount}
          maxAttempts={MAX_ATTEMPTS}
          maxAttemptsReached={maxAttemptsReached}
          showCaptureSuccessMessage={showCaptureSuccessMessage}
        />

        <StatusInformation
          currentPhase={currentPhase}
          sessionId={sessionId}
          frontScanState={frontScanState}
          detectionActive={detectionActive}
        />

        {/* Voice Verification Popup */}
        <VoiceVerification
          isOpen={showVoiceVerification}
          onClose={handleVoiceVerificationClose}
          phoneNumber={localStorage.getItem("phoneNumber")}
          merchantId={authData?.merchantId}
          onSuccess={handleVoiceVerificationSuccess}
          mode={voiceVerificationMode}
        />

        <footer className="text-center text-sm text-gray-400 mt-8">
          © {new Date().getFullYear()} CardNest LLC. All rights reserved.
        </footer>
      </div>
    </div>
  );
};

export default CardDetectionApp;
