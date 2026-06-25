# Setup and Upload Instructions - ESP32 Solar Monitoring System

This guide walks you through setting up your Arduino IDE 2.x, installing the required libraries, configuring Firebase, uploading the code, and troubleshooting common errors.

---

## 1. Required Libraries

You must install the following libraries before compiling the code. In Arduino IDE 2.x, open the **Library Manager** (icon of books on the left sidebar, or shortcut `Ctrl + Shift + I` / `Cmd + Shift + I`) and search for:

1. **Firebase ESP Client** (by *Mobizt*)
   * Used to handle connection, authentication, and communication with the Firebase Realtime Database.
2. **Adafruit SSD1306** (by *Adafruit*)
   * Driver library for the SSD1306 OLED display.
3. **Adafruit GFX Library** (by *Adafruit*)
   * Core graphics library for drawing shapes, text, etc., on the OLED.
4. **Adafruit BusIO** (by *Adafruit*)
   * **Mandatory Dependency:** Contains `Adafruit_I2CDevice.h` which is required by `Adafruit_GFX`.
5. **DHT sensor library** (by *Adafruit*)
   * Used to read temperature and humidity from the DHT11 sensor.
   * *Note:* When installing this, Arduino IDE may ask to install **Adafruit Unified Sensor**. Select **Install All** to install it as well.

---

## 2. Arduino IDE Board Configuration

If you have not yet set up ESP32 support in your Arduino IDE:

1. Go to **File** -> **Preferences**.
2. In the **Additional boards manager URLs** field, paste the following URL:
   ```text
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Click **OK**.
4. Open the **Boards Manager** (`Ctrl + Shift + B` / `Cmd + Shift + B`), search for `esp32` (by *Espressif Systems*), and click **Install** (use version 2.x or 3.x).
5. Select your board and port:
   * Go to **Tools** -> **Board** -> **esp32** -> **ESP32 Dev Module**.
   * Go to **Tools** -> **Port** and select the COM/Serial port matching your connected ESP32.

---

## 3. Firebase Console Configuration

For the anonymous authentication and real-time database to work, you must configure the Firebase project as follows:

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Select your project: `solar-system-using-esp-32`.
3. **Enable Anonymous Sign-In:**
   * Go to **Authentication** (left sidebar) -> **Sign-in method** tab.
   * Click **Add new provider** (or edit existing) and select **Anonymous**.
   * Toggle the switch to **Enable** and click **Save**.
4. **Configure Database Security Rules:**
   * Go to **Realtime Database** (left sidebar) -> **Rules** tab.
   * To allow the ESP32 to read and write without restricting to registered email users, set the rules to:
     ```json
     {
       "rules": {
         ".read": "auth != null",
         ".write": "auth != null"
       }
     }
     ```
     *(Since the ESP32 logs in anonymously, `auth != null` is satisfied, keeping the database secure from unauthenticated internet traffic while granting access to your ESP32).*
   * Click **Publish**.

---

## 4. How to Compile and Upload

1. Open the [esp32_solar_monitoring.ino](file:///c:/Users/muham/OneDrive/Desktop/Antigravity/esp32_solar_monitoring/esp32_solar_monitoring.ino) sketch in Arduino IDE 2.x.
2. In the code, verify/update the following configuration macros:
   * `WIFI_SSID` and `WIFI_PASSWORD`
   * `API_KEY`
   * `DATABASE_URL`
3. Click the **Verify** (checkmark) button to compile the code and ensure there are no compilation errors.
4. Click the **Upload** (right arrow) button to upload the code to your ESP32.
   * *Troubleshooting Tip:* If the console displays `Connecting.......____.....`, press and hold the **BOOT** (or **BOOT/IO0**) button on your ESP32 Dev Module until the upload progress starts.

---

## 5. Testing and Debugging

1. Once the upload finishes, open the **Serial Monitor** (`Ctrl + Shift + M` / `Cmd + Shift + M`).
2. Set the baud rate to **115200**.
3. Press the **EN / RST** button on the ESP32 to restart the system and view the boot logs.

### Expected Serial Log Flow:
```text
Connecting to WiFi.....
WiFi Connected
IP Address: 192.168.1.XX
Firebase SignUp OK
Firebase Ready
====================
Voltage: 12.34
Current: 0.85
Power: 10.49
Temperature: 28.50
Humidity: 65.00
LDR: 1540
[RTDB] Uploading data...
[RTDB] Voltage uploaded successfully
[RTDB] Current uploaded successfully
[RTDB] Power uploaded successfully
[RTDB] Temperature uploaded successfully
[RTDB] Humidity uploaded successfully
[RTDB] LDR uploaded successfully
Firebase Upload Cycle Completed.
====================
```

### Common Error Messages & Solutions:

* **`[RTDB] Upload failed: ...`**
  * **Cause:** The database rules are blocking the upload or the API Key/Database URL is incorrect.
  * **Solution:** Verify `auth != null` rules are published, and confirm your database URL ends with a `/`.
* **`OLED Failed`**
  * **Cause:** ESP32 cannot communicate with the OLED screen via I2C.
  * **Solution:** Check SDA (GPIO 21) and SCL (GPIO 22) connections. Check if your OLED screen has I2C address `0x3C` (default) or `0x3D`.
* **`DHT11 Read Failed`**
  * **Cause:** The DHT11 is not connected or powered correctly.
  * **Solution:** Check VCC, GND, and the data line on GPIO 27. Ensure there is a pull-up resistor if required.
* **`Signup Error: ...`**
  * **Cause:** Anonymous authentication is disabled in Firebase Authentication.
  * **Solution:** Enable Anonymous auth in the Firebase Console. Check if the ESP32 has internet access.

---

## 6. Interactive Smart Switch (IoT Appliance Control)

The ESP32 is configured to listen to the path `/Control/Relay` on Firebase Realtime Database using a real-time data stream listener.

### How it works:
1. When you toggle the switch on the web dashboard (e.g. at `https://dashboard-two-neon-97.vercel.app`), the web client updates the value at `/Control/Relay` to `true` or `false`.
2. The ESP32's background stream callback is immediately triggered.
3. The onboard blue LED on **GPIO 2** (defined as `RELAY_PIN`) is set to `HIGH` (ON) or `LOW` (OFF) instantly.

### Verification Steps:
1. Make sure your ESP32 is powered and connected to the same Firebase Realtime Database.
2. Open the web dashboard.
3. Locate the **Smart Appliance** card.
4. Toggle the switch. You will see the status change from "Appliance: OFF" to "Appliance: ON" and the bulb icon glowing.
5. In the Serial Monitor, you will see output like:
   ```text
   [Firebase Stream] Path: /Control/Relay, Event: / , Type: boolean
   [Firebase Stream] Relay GPIO 2 set to: ON
   ```
6. The onboard blue LED on the ESP32 will turn ON/OFF dynamically.

