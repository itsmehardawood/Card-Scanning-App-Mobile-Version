import React from 'react';
import DetectionResults from './DetectionResults';
import FinalResponse from './FinalResponse';
import { Check } from 'lucide-react';

const ControlPanel = ({
  currentPhase,
  onStartValidation,
  onStartFrontScan,
  onStartBackScan,
  onStop,
  onReset,
  onTryAgain,
  onStartOver,
  onFakeCardRetry,
  fakeCardDetectedPhase,
  frontScanState,
  countdown,
  errorMessage,
  finalOcrResults,
  detectionActive,
  isProcessing,
  attemptCount,
  maxAttempts,
  maxAttemptsReached,
  showCaptureSuccessMessage
}) => {
  const isActive = detectionActive || isProcessing || countdown > 0;
  const isLastAttempt = attemptCount === maxAttempts - 1;

  // Show final encrypted response (from file 1)
  if (currentPhase === 'final_response' && finalOcrResults?.encrypted_card_data) {
    return <FinalResponse finalResponse={finalOcrResults} onReset={onReset} />;
  }

  // Show regular results
  if (currentPhase === 'results' && finalOcrResults?.final_ocr) {
    return <DetectionResults finalOcrResults={finalOcrResults} onReset={onReset} />;
  }

  // Show results if detection is complete (fallback from file 2)
  if (currentPhase === 'results') {
    return (
      <DetectionResults 
        finalOcrResults={finalOcrResults} 
        onReset={onReset} 
      />
    );
  }

  // Capture success message - show when frame is captured successfully
  // if (showCaptureSuccessMessage) {
  //   return (
  //     <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
  //       <div className="text-center">
  //         <div className="mb-4">
  //           {/* Processing Animation */}
  //           <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-3">
  //             <div className="flex space-x-1">
  //               <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>
  //               <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
  //               <div className="w-2 h-2 bg-blue-600 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></div>
  //             </div>
  //           </div>
            
  //           <h3 className="text-lg sm:text-xl font-semibold text-blue-600 mb-2">Processing Security Scan...</h3>
  //           <p className="text-gray-700 mb-3">
  //             Please wait while we perform an intelligence security scan on your card.
  //           </p>
            
  //           {/* Progress indicator */}
  //           <div className="mt-4">
  //             <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
  //               <div className="flex items-center justify-center space-x-2">
  //                 <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
  //                 <span className="text-sm text-blue-700 font-medium">Scanning in progress...</span>
  //               </div>
  //             </div>
  //           </div>
  //         </div>
  //       </div>
  //     </div>
  //   );
  // }

  // Fake card detected - show retry option without counting as failed attempt
  if (currentPhase === 'fake-card-error') {
    return (
      <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
        <div className="text-center">
          <div className="mb-4">
            <h3 className="text-lg sm:text-xl font-semibold text-red-600 mb-2">Unacceptable Card Detection</h3>
            <p className="text-red-700 mb-3">{errorMessage || 'Please use an original physical card.'}</p>
            
           
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={onFakeCardRetry}
              className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Try Again
            </button>
            {/* <button
              onClick={onStartOver}
              className="bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              Start Over
            </button> */}
          </div>
        </div>
      </div>
    );
  }

  // Error state with attempt tracking (enhanced from both files)
  if (currentPhase === 'error' ) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
        <div className="text-center">
          <div className="mb-4">
            <h3 className="text-lg sm:text-xl font-semibold text-red-600 mb-2">Security Scan Detection Failed</h3>
            <p className="text-red-700 mb-3">{errorMessage || 'Please ensure the card is in a clear view.'}</p>
            
            {!maxAttemptsReached && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
                <p className="text-orange-600 text-sm">
                  Attempt {attemptCount} of {maxAttempts}
                </p>
                <div className="text-sm text-red-600 mt-1">
                  You have {maxAttempts - attemptCount} attempt{maxAttempts - attemptCount !== 1 ? 's' : ''} remaining.
                </div>
              </div>
            )}
          </div>

           <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {!maxAttemptsReached && (
              <button
                onClick={onTryAgain}
                className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
              >
                Try Again
              </button>
            )}
          </div>
          
          {/* Show alternative payment methods when only one attempt left */}
        
        </div>
      </div>
    );
  }

  // Max attempts reached (enhanced from both files)
  if (currentPhase === 'max-attempts-reached') {
    return (
      <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
        <div className="text-center">
          <h3 className="text-lg sm:text-xl font-semibold text-red-600 mb-3">Oops! Currently, you have reached the maximum number of times you can scan.</h3>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-700 font-bold">Contact customer support for assistance or Retry the scanning process</p>
          </div>
        </div>
      </div>
    );
  }

  // Main control panel with enhanced phase handling
  return (
    <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
      <div className="text-center space-y-4">
        
        {/* Phase: idle - Start Card Scanning (Direct to Front) */}
        {currentPhase === 'idle' && (
          <div>
            <button
              onClick={onStartValidation}
              disabled={isActive || maxAttemptsReached}
              className="bg-red-600 hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-6 sm:px-8 py-3 sm:py-4 rounded-lg font-medium text-base sm:text-lg transition-colors"
            >
              {isActive ? 'Processing...' : 'Start Card Scanning'}
            </button>

            {/* Show alternative payment methods when only one attempt left */}
            {isLastAttempt && (
                 <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
  <p className="text-sm text-blue-800 mb-4 font-medium">
    Alternative Payment Options:
  </p>
  <div className="flex flex-wrap justify-center items-center gap-4">
    {/* Google Pay */}
    <div className="flex items-center bg-white rounded-xl p-3 px-4 shadow-md border hover:shadow-lg transition">
      <svg width="36" height="20" viewBox="0 0 48 20" fill="none" className="shrink-0">
        <path d="M19.7 10c0-2.8-2.2-5-5-5s-5 2.2-5 5 2.2 5 5 5 5-2.2 5-5zm-7.5 0c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5-1.1 2.5-2.5 2.5-2.5-1.1-2.5-2.5z" fill="#4285F4"/>
        <path d="M27.2 7.5h-4.8V5h4.8c1.4 0 2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5z" fill="#34A853"/>
        <path d="M27.2 12.5h-4.8V10h4.8c1.4 0 2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5z" fill="#FBBC04"/>
        <path d="M22.4 15h4.8c1.4 0 2.5-1.1 2.5-2.5v-5c0-1.4-1.1-2.5-2.5-2.5h-4.8v10z" fill="#EA4335"/>
      </svg>
      <span className="ml-3 text-base font-semibold text-gray-800">Google Pay</span>
    </div>

    {/* Apple Pay */}
    <div className="flex items-center bg-white rounded-xl p-3 px-4 shadow-md border hover:shadow-lg transition">
      <svg width="36" height="20" viewBox="0 0 48 20" fill="none" className="shrink-0">
        <path d="M11.5 1c-1.1 0-2.1.4-2.8 1.1-.7.7-1.1 1.7-1.1 2.8 0 .2 0 .4.1.6 1.2-.1 2.4-.6 3.2-1.4.8-.8 1.2-1.9 1.2-3-.4-.1-.4-.1-.6-.1zm1.3 3.2c-1.7 0-3.1.9-3.9.9s-2.2-.9-3.7-.9c-1.9 0-3.6 1.1-4.6 2.8-1.9 3.4-.5 8.4 1.4 11.2.9 1.4 2 2.9 3.4 2.9s1.9-.9 3.5-.9 2.1.9 3.5.9 2.4-1.4 3.3-2.8c1.1-1.6 1.5-3.2 1.5-3.3 0-.1-2.9-1.1-2.9-4.4 0-2.8 2.3-4.1 2.4-4.2-1.3-1.9-3.3-2.1-4-2.2z" fill="#000"/>
      </svg>
      <span className="ml-3 text-base font-semibold text-gray-800">Apple Pay</span>
    </div>
  </div>
</div>  
            )}
          </div>
        )}

        {/* Phase: front-countdown or front */}
        {(currentPhase === 'front-countdown' || currentPhase === 'front') && (
          <div>
            <h3 className="text-lg sm:text-xl font-semibold text-blue-600 mb-4">
              Scanning Front Side
            </h3>
            {currentPhase === 'front-countdown' && countdown > 0 && (
              <p className="text-gray-600 mb-4 text-sm sm:text-base">
                Scanning starts in {countdown} seconds...
              </p>
            )}
           
            <button
              onClick={onStop}
              className="bg-red-600 hover:bg-red-700 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-medium transition-colors text-sm sm:text-base"
            >
              Stop Scanning
            </button>

            {currentPhase === 'front' && (
              <div className="bg-blue-50 border mt-2 text-blue-700 border-blue-200 rounded-lg p-4 mb-4">
                Scanning and Processing card frames..
              </div>
            )}
          </div>
        )}

        {/* Phase: ready-for-back */}
        {currentPhase === 'ready-for-back' && (
          <div>

              <button
              onClick={onStartBackScan}
              disabled={isActive || maxAttemptsReached}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-lg font-medium text-base sm:text-lg transition-colors"
            >
              {isActive ? 'Scanning Back...' : 'Scan Back Side'}
            </button>


            {/* Big Success Message for Front Side */}
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-4 border-green-400 rounded-xl p-6  mt-5 mb-6 shadow-lg">
              <div className="flex items-center justify-center mb-3">
                <div className="bg-green-500 rounded-full p-3 mr-3">
                <Check className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-xl sm:text-xl font-bold text-green-700">
                  FRONT SIDE SCAN SUCCESSFUL!
                </h3>
              </div>
              <p className="text-lg text-green-600 font-semibold">
                Your cards front side has been successfully scanned and processed
              </p>
            </div>
            
          
            
      
          </div>
        )}

        {/* Phase: back-complete */}
        {currentPhase === 'back-complete' && (
          <div>
            {/* Big Success Message for Back Side */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-4 border-green-400 rounded-xl p-3 mb-6 shadow-lg">
         
              
              {/* Complete Success Animation */}
              <div className="bg-gradient-to-r from-green-50 to-emerald-50  rounded-lg p-4">
                <div className="flex items-center justify-center">
                  <div className="bg-green-500 rounded-full p-2 mr-3 animate-pulse">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                  <h4 className="text-xl font-bold text-green-700">
                    COMPLETE CARD SCAN SUCCESSFUL!
                  </h4>
                </div>
                <p className="text-center text-green-600 font-medium mt-2">
                  Both sides scanned successfully. Processing results...
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Phase: back-countdown or back */}
        {(currentPhase === 'back-countdown' || currentPhase === 'back') && (
          <div>
            <h3 className="text-lg sm:text-xl font-semibold text-blue-600 mb-4">
              Scanning Back Side
            </h3>
            {currentPhase === 'back-countdown' && countdown > 0 && (
              <p className="text-gray-600 mb-4 text-sm sm:text-base">
                Scanning starts in {countdown} seconds...
              </p>
            )}
     
            <button
              onClick={onStop}
              className="bg-red-600 hover:bg-red-700 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-medium transition-colors text-sm sm:text-base"
            >
              Stop Scanning
            </button>

            {currentPhase === 'back' && (
              <div className="bg-blue-50 border text-blue-700 mt-2 border-blue-200 rounded-lg p-4 mb-4">
                Scanning and Processing card frames..
              </div>
            )}
          </div>
        )}

        {/* Attempt Counter */}
        {attemptCount > 0 && !maxAttemptsReached && (
          <div className="mt-4">
            <p className="text-sm text-orange-600">
              Attempts: {attemptCount}/{maxAttempts}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ControlPanel;