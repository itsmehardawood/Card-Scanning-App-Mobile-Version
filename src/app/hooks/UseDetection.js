import { useRef } from 'react';
import { captureAndSendFramesFront as frontSideDetection } from './captureFrontSide';
import { captureAndSendFrames as backSideDetection } from './captureBackSide';

// Custom hook for detection logic
// This hook wraps the front and back side detection functions
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
  disableFlashlight, // Add this parameter to control flashlight
  onImageCaptured // Add callback to pass captured image immediately
) => {
  const captureIntervalRef = useRef(null);

  // Wrapper for front side detection
  const captureAndSendFramesFront = async (phase, providedSessionId = null) => {
    return frontSideDetection(
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
      providedSessionId,
      phase
    );
  };

  // Wrapper for back side detection
  const captureAndSendFrames = async (phase, providedSessionId = null) => {
    return backSideDetection(
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
      providedSessionId,
      phase
    );
  };

  return {
    captureAndSendFramesFront,
    captureAndSendFrames,
    captureIntervalRef
  };
};
