# Android WebView Setup for Voice Recording

## Required Permissions in AndroidManifest.xml

Add these permissions to your `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.INTERNET" />
```

## WebView Configuration in Your Activity/Fragment

Add this configuration to your WebView setup:

```kotlin
// Enable JavaScript
webView.settings.javaScriptEnabled = true

// Enable DOM storage (required for localStorage)
webView.settings.domStorageEnabled = true

// Enable file access
webView.settings.allowFileAccess = true

// Allow content access
webView.settings.allowContentAccess = true

// Enable media playback
webView.settings.mediaPlaybackRequiresUserGesture = false

// Set WebChromeClient to handle permissions
webView.webChromeClient = object : WebChromeClient() {
    
    // Handle microphone permission requests
    override fun onPermissionRequest(request: PermissionRequest) {
        val requestedResources = request.resources
        for (resource in requestedResources) {
            when (resource) {
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
                    // Check if app has microphone permission
                    if (ContextCompat.checkSelfPermission(
                            this@YourActivity,
                            Manifest.permission.RECORD_AUDIO
                        ) == PackageManager.PERMISSION_GRANTED
                    ) {
                        // Grant the permission to WebView
                        request.grant(request.resources)
                    } else {
                        // Request permission from user
                        ActivityCompat.requestPermissions(
                            this@YourActivity,
                            arrayOf(Manifest.permission.RECORD_AUDIO),
                            MICROPHONE_PERMISSION_REQUEST_CODE
                        )
                    }
                }
            }
        }
    }
}

// Set WebViewClient
webView.webViewClient = WebViewClient()
```

## Handle Runtime Permission Request

```kotlin
companion object {
    private const val MICROPHONE_PERMISSION_REQUEST_CODE = 200
}

override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray
) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    
    when (requestCode) {
        MICROPHONE_PERMISSION_REQUEST_CODE -> {
            if (grantResults.isNotEmpty() && 
                grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                // Permission granted, reload the page to retry
                webView.reload()
            } else {
                // Permission denied
                Toast.makeText(
                    this,
                    "Microphone permission is required for voice verification",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }
}
```

## Complete Example

```kotlin
import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.*
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    
    companion object {
        private const val MICROPHONE_PERMISSION_REQUEST_CODE = 200
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        setupWebView()
        
        // Load your app
        webView.loadUrl("https://mobile.cardnest.io/securityscan")
    }

    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            
            // Optional: Enable debugging in Chrome DevTools
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val requestedResources = request.resources
                    for (resource in requestedResources) {
                        if (resource == PermissionRequest.RESOURCE_AUDIO_CAPTURE) {
                            if (ContextCompat.checkSelfPermission(
                                    this@MainActivity,
                                    Manifest.permission.RECORD_AUDIO
                                ) == PackageManager.PERMISSION_GRANTED
                            ) {
                                request.grant(request.resources)
                            } else {
                                ActivityCompat.requestPermissions(
                                    this@MainActivity,
                                    arrayOf(Manifest.permission.RECORD_AUDIO),
                                    MICROPHONE_PERMISSION_REQUEST_CODE
                                )
                            }
                            return@runOnUiThread
                        }
                    }
                }
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                // Log WebView console messages for debugging
                android.util.Log.d(
                    "WebView",
                    "${consoleMessage.message()} -- From line ${consoleMessage.lineNumber()} of ${consoleMessage.sourceId()}"
                )
                return true
            }
        }

        webView.webViewClient = WebViewClient()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        
        when (requestCode) {
            MICROPHONE_PERMISSION_REQUEST_CODE -> {
                if (grantResults.isNotEmpty() && 
                    grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                    webView.reload()
                    Toast.makeText(
                        this,
                        "Microphone permission granted",
                        Toast.LENGTH_SHORT
                    ).show()
                } else {
                    Toast.makeText(
                        this,
                        "Microphone permission is required for voice verification",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
```

## Debugging Tips

1. **Enable WebView Debugging**: Add this in your Application class or Activity:
   ```kotlin
   WebView.setWebContentsDebuggingEnabled(true)
   ```
   Then connect your device and use Chrome DevTools: `chrome://inspect`

2. **Check Logs**: The voice verification component now logs detailed information to `/api/client-log`. Check your server logs to see what's happening.

3. **Test Permissions**: Before loading the WebView, ensure microphone permission is granted:
   ```kotlin
   if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
       != PackageManager.PERMISSION_GRANTED) {
       ActivityCompat.requestPermissions(
           this,
           arrayOf(Manifest.permission.RECORD_AUDIO),
           MICROPHONE_PERMISSION_REQUEST_CODE
       )
   }
   ```

## Common Issues and Solutions

### Issue: "NotAllowedError: Permission denied"
**Solution**: Ensure the WebChromeClient's `onPermissionRequest` is properly handling `RESOURCE_AUDIO_CAPTURE` and granting permissions.

### Issue: "NotFoundError: Requested device not found"
**Solution**: Check that the device has a microphone and it's not being used by another app.

### Issue: Recording works in browser but not in WebView
**Solution**: 
- Verify all permissions are added to AndroidManifest.xml
- Ensure WebChromeClient is set before loading the URL
- Check that `mediaPlaybackRequiresUserGesture` is set to `false`

### Issue: Can't see console.log messages
**Solution**: Implement `onConsoleMessage` in WebChromeClient to forward logs to Android Logcat.
