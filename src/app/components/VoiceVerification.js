"use client";
import React, { useState, useRef, useEffect } from "react";

const VoiceVerification = ({ 
  isOpen, 
  onClose, 
  phoneNumber, 
  merchantId,
  onSuccess 
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      setError("");
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioBlob(audioBlob);
        setHasRecorded(true);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      
      // Start timer
      timerIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      console.log("🎤 Recording started");
    } catch (err) {
      console.error("❌ Error accessing microphone:", err);
      setError("Unable to access microphone. Please enable microphone permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      
      console.log("🎤 Recording stopped");
    }
  };

  const handleRecordClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
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
      formData.append("file", audioBlob, "voice_recording.webm");

      console.log("📤 Submitting voice registration:", {
        user_id: phoneNumber,
        merchant_id: merchantId,
        file_size: audioBlob.size,
      });

      // Send to API
      const response = await fetch("https://testscan.cardnest.io/voice/register", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        console.log("✅ Voice registration successful:", result);
        
        // Call success callback
        if (onSuccess) {
          onSuccess(result);
        }
        
        // Close popup
        onClose();
      } else {
        const errorText = await response.text();
        console.error("❌ Voice registration failed:", errorText);
        setError("Voice registration failed. Please try again.");
      }
    } catch (err) {
      console.error("❌ Error submitting voice registration:", err);
      setError("Failed to submit voice registration. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    console.log("⏭️ User skipped voice verification");
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
          
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Voice Verification
          </h3>
          <p className="text-gray-600 text-sm">
            For additional security, we need to verify and associate your voice with your account.
          </p>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-blue-900 text-sm font-medium mb-2">
            Please say this phrase 3 times clearly:
          </p>
          <p className="text-blue-700 text-lg font-semibold text-center py-2">
            &ldquo;Today is Monday&rdquo;
          </p>
          <p className="text-blue-600 text-xs mt-2 text-center">
            Click the button below and repeat the phrase 3 times in one recording
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

      

        {/* Record Button */}
        <button
          onClick={handleRecordClick}
          disabled={isSubmitting}
          className={`w-full py-4 rounded-lg font-semibold text-white transition-all mb-3 ${
            isRecording
              ? "bg-red-600 hover:bg-red-700 animate-pulse"
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
              🎤 {hasRecorded ? "Record Again" : "Start Recording"}
            </>
          )}
        </button>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleSkip}
            disabled={isSubmitting}
            className="flex-1 py-3 rounded-lg font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 transition-colors disabled:opacity-50"
          >
            Skip for Now
          </button>
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
