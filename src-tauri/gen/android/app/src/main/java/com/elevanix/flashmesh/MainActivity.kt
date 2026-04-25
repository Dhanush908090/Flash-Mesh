package com.elevanix.flashmesh

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.util.Log
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import android.webkit.MimeTypeMap
import android.widget.Toast

class MainActivity : TauriActivity() {

  companion object {
    private const val TAG = "FlashMesh"
    private const val REQ_STORAGE = 1001
    // Permissions needed on Android 6–10 (API 23–29)
    private val LEGACY_STORAGE_PERMS = arrayOf(
      Manifest.permission.READ_EXTERNAL_STORAGE,
      Manifest.permission.WRITE_EXTERNAL_STORAGE
    )
  }

  // Launcher for Android 11+ "All Files Access" settings screen
  private val manageStorageLauncher = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult()
  ) {
    // User returned from system settings — emit a JS event so the frontend re-checks
    notifyPermissionChanged()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Removed requestStoragePermissions() from here to prevent the popup from
    // being instantly dismissed by the system before the UI is ready.
  }

  @android.annotation.SuppressLint("SetJavaScriptEnabled")
  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(object {
      @android.webkit.JavascriptInterface
      fun triggerPrompt() {
        runOnUiThread { requestStoragePermissions() }
      }
      
      @android.webkit.JavascriptInterface
      fun openFile(path: String) {
        runOnUiThread {
          try {
            val file = java.io.File(path)
            if (!file.exists()) {
               Toast.makeText(this@MainActivity, "File does not exist: $path", Toast.LENGTH_LONG).show()
               return@runOnUiThread
            }
            
            val uri = FileProvider.getUriForFile(
              this@MainActivity,
              "${packageName}.fileprovider",
              file
            )
            
            val extension = MimeTypeMap.getFileExtensionFromUrl(Uri.fromFile(file).toString())
            val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension?.lowercase()) ?: "application/octet-stream"
            
            val intent = Intent(Intent.ACTION_VIEW).apply {
              setDataAndType(uri, mimeType)
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
              addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
          } catch (e: Exception) {
            Log.e(TAG, "Failed to open file: $path", e)
            Toast.makeText(this@MainActivity, "Failed to open file: ${e.message}", Toast.LENGTH_LONG).show()
          }
        }
      }
    }, "AndroidPermissionBridge")
    Log.d(TAG, "Injected AndroidPermissionBridge into WebView")
  }

  override fun onResume() {
    super.onResume()
    // Re-notify the webview whenever the app comes back to foreground
    notifyPermissionChanged()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public entry point — called from Rust via the permission command as well
  // ──────────────────────────────────────────────────────────────────────────
  fun requestStoragePermissions() {
    when {
      // ── Android 11+ (API 30+) ─────────────────────────────────────────────
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> {
        if (!Environment.isExternalStorageManager()) {
          Log.d(TAG, "Android 11+: requesting MANAGE_EXTERNAL_STORAGE")
          launchManageStorageIntent()
        } else {
          Log.d(TAG, "Android 11+: MANAGE_EXTERNAL_STORAGE already granted")
          notifyPermissionChanged()
        }
      }

      // ── Android 6–10 (API 23–29) ──────────────────────────────────────────
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.M -> {
        val missing = LEGACY_STORAGE_PERMS.filter {
          ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
          Log.d(TAG, "Android 6-10: requesting runtime storage permissions")
          ActivityCompat.requestPermissions(this, missing.toTypedArray(), REQ_STORAGE)
        } else {
          Log.d(TAG, "Android 6-10: storage permissions already granted")
          // Android 10 namespace bug: permission granted but mount namespace not updated
          if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q && !java.io.File("/storage/emulated/0").canRead()) {
              Log.d(TAG, "Android 10 namespace bug detected. Restarting app.")
              restartApp()
              return
          }
          notifyPermissionChanged()
        }
      }

      // ── Android < 6 (API < 23) ────────────────────────────────────────────
      else -> {
        // Permissions are install-time granted — nothing to request
        Log.d(TAG, "Android <6: permissions auto-granted")
        notifyPermissionChanged()
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Result callback for runtime permission dialog (Android 6–10)
  // ──────────────────────────────────────────────────────────────────────────
  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == REQ_STORAGE) {
      val granted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
      Log.d(TAG, "Runtime permission result: granted=$granted")
      
      if (granted && Build.VERSION.SDK_INT == Build.VERSION_CODES.Q && !java.io.File("/storage/emulated/0").canRead()) {
          Log.d(TAG, "Android 10 namespace bug detected after grant. Restarting app.")
          restartApp()
          return
      }
      
      notifyPermissionChanged()
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private fun restartApp() {
    val intent = packageManager.getLaunchIntentForPackage(packageName)
    intent?.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    startActivity(intent)
    Runtime.getRuntime().exit(0)
  }

  private fun launchManageStorageIntent() {
    try {
      val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
        data = Uri.parse("package:$packageName")
      }
      manageStorageLauncher.launch(intent)
    } catch (e: Exception) {
      Log.w(TAG, "Specific manage-storage intent failed, using general fallback", e)
      val fallback = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
      manageStorageLauncher.launch(fallback)
    }
  }

  /** 
   * Fires a custom JS event in the WebView so the frontend can re-run 
   * check_android_permission and update the UI without needing a restart.
   */
  private fun notifyPermissionChanged() {
    try {
      // Evaluate JS in the Tauri WebView to dispatch a storage-permission-changed event
      val js = "window.dispatchEvent(new CustomEvent('flashmesh:permission-changed'))"
      runOnUiThread {
        // Access the webview via the Tauri-generated activity base class
        this.window.decorView.rootView.findViewWithTag<android.webkit.WebView>("webview")
          ?.evaluateJavascript(js, null)
          ?: Log.w(TAG, "WebView not found for JS injection — permission event not dispatched")
      }
    } catch (e: Exception) {
      Log.w(TAG, "Could not dispatch permission event to WebView", e)
    }
  }
}
