# Camera Debugging Guide

## Debug API Route

A dedicated API endpoint `/api/debug-camera` has been created to log camera selection and torch operations to the **server terminal** for remote debugging on mobile devices.

## How to Enable Debug Logging

### Method 1: Automatic (Development Mode)
Debug logging is **automatically enabled** in development mode (`npm run dev`).

### Method 2: Manual (Production)
Add this to your browser console or page code:
```javascript
window.ENABLE_CAMERA_DEBUG = true;
```

## What Gets Logged to Server

### 📷 Camera Selection
- All available cameras with labels, deviceId, and facing direction
- Selected camera details
- Torch support information

### 🔦 Torch Operations
- Torch enable/disable attempts
- Success/failure status
- Method used (advanced, basic, verified)
- Error messages if failed

### 📱 Device Information
- Samsung device detection
- WebView detection
- User agent string

## Viewing Debug Logs

### On Your Development Computer
```bash
npm run dev
```
Then check the **terminal/console** where Next.js is running. You'll see:

```
============================================================
📷 CAMERA SELECTION [2024-01-15T10:30:45.123Z]
============================================================
Message: Torch-capable camera found

📷 Camera Details:
  - Label: Camera 0, Facing back
  - Device ID: abc123def456...
  - Facing: back
  - Torch Support: YES ✅
============================================================
```

### On Samsung/Mobile Device

1. **Connect via USB** (Android):
   - Enable USB Debugging on phone
   - Connect to computer
   - Run `npm run dev` on computer
   - Server logs appear in your computer terminal

2. **Deploy to production**:
   - Set `window.ENABLE_CAMERA_DEBUG = true` in browser console
   - Check server logs (Vercel, Heroku, etc.)

## Debug Log Types

| Type | Icon | Description |
|------|------|-------------|
| `camera-selection` | 📷 | Camera was selected |
| `torch-test` | 🔦 | Torch support tested |
| `device-info` | 📱 | Device information logged |
| `success` | ✅ | Operation succeeded |
| `error` | ❌ | Operation failed |
| `warning` | ⚠️ | Warning message |

## Example Server Logs

### Successful Torch on Samsung
```
============================================================
📱 DEVICE INFO [2024-01-15T10:30:45.000Z]
============================================================
Message: Camera scan started

📱 Device Information:
  - Samsung: YES
  - WebView: YES
  - User Agent: Mozilla/5.0 (Linux; Android 13; SM-G991B)...
============================================================

============================================================
📷 CAMERA SELECTION [2024-01-15T10:30:46.000Z]
============================================================
Message: Torch-capable camera found

📷 Camera Details:
  - Label: Camera 0, Facing back
  - Device ID: 1234567890ab...
  - Facing: back
  - Torch Support: YES ✅
============================================================

============================================================
✅ CAMERA SUCCESS [2024-01-15T10:30:47.000Z]
============================================================
Message: Torch enabled successfully

🔦 Torch Operation:
  - Success: YES ✅
  - Method: advanced
  - Reason: N/A
============================================================
```

### Failed Torch (No Support)
```
============================================================
🔦 TORCH TEST [2024-01-15T10:30:45.000Z]
============================================================
Message: Torch not supported

📷 Camera Details:
  - Label: Integrated Camera
  - Device ID: null
  - Facing: unknown
  - Torch Support: NO ❌

🔦 Torch Operation:
  - Success: NO ❌
  - Method: N/A
  - Reason: NOT_SUPPORTED
============================================================
```

## Disable Debug Logging

To disable (reduce server log noise):

```javascript
// In browser console or code
window.ENABLE_CAMERA_DEBUG = false;
```

Or simply set `NODE_ENV=production` which disables it by default.

## Tips for Samsung Debugging

1. **Check server logs** immediately after camera permission is granted
2. **Look for** "Found torch-capable camera" message
3. **If no torch cameras found**, check the "All Cameras" list to see what's available
4. **If torch enable fails**, check which method was attempted and the error message

## API Endpoint Details

**Endpoint**: `POST /api/debug-camera`

**Request Body**:
```json
{
  "type": "camera-selection",
  "message": "Torch-capable camera found",
  "camera": {
    "label": "Camera 0, Facing back",
    "deviceId": "abc123...",
    "facing": "back",
    "hasTorch": true
  },
  "timestamp": 1705315845000
}
```

**Response**:
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:45.000Z"
}
```
