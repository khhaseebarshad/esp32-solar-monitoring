/**
 * ESP32 Solar Energy Monitoring System with Firebase & OLED Integration
 * 
 * Target Board: ESP32 Dev Module
 * Author: Antigravity AI Pair Programmer
 * Date: June 2026
 * 
 * Hardware Pin Mapping:
 * - DHT11 Sensor            -> GPIO 27
 * - Voltage Sensor Module   -> GPIO 34 (ADC1_CH6)
 * - ACS712 Current Sensor   -> GPIO 35 (ADC1_CH7)
 * - LDR Sensor              -> GPIO 32 (ADC1_CH4)
 * - OLED Display SDA        -> GPIO 21
 * - OLED Display SCL        -> GPIO 22
 */

#include <WiFi.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>

// Firebase Client Libraries
#include <Firebase_ESP_Client.h>

// Firebase Helper Libraries (Mandatory for Token and RTDB helpers)
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// ==========================================
// 1. Wi-Fi and Firebase Configuration
// ==========================================
#define WIFI_SSID "Muhammad Haseeb's Iphone"
#define WIFI_PASSWORD "haseeb7860"

#define API_KEY "AIzaSyAfUaWBWw3N86p2hdDmseFlur95_EpHQqw"
#define DATABASE_URL "https://solar-system-using-esp-32-default-rtdb.asia-southeast1.firebasedatabase.app/"

// ==========================================
// 2. Hardware / Sensor Parameters
// ==========================================
// OLED Display Config
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1 // Reset pin # (or -1 if sharing Arduino reset pin)
#define OLED_I2C_ADDR 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// DHT11 Config
#define DHTPIN 27
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

// Analog Pins
#define VOLTAGE_PIN 34
#define CURRENT_PIN 35
#define LDR_PIN 32

// ESP32 ADC & Sensor Calibration Parameters
const float ADC_REF_VOLTAGE = 3.3;       // ESP32 ADC Reference Voltage (normally 3.3V)
const float ADC_RESOLUTION = 4095.0;    // 12-bit ADC (0 - 4095)

// Ratio parameters for voltage divider protection.
// (Adjust EXTERNAL_DIVIDER_RATIO to 1.0 if not using safety resistors at ESP32 inputs)
const float VOLTAGE_DIVIDER_RATIO = 5.0; // Voltage sensor built-in step-down (5:1)
const float EXTERNAL_DIVIDER_RATIO = 1.5; // Scale multiplier (compensates for 10k/20k voltage divider on ADC pin)

// ACS712-05B Parameters
const float ACS_SENSITIVITY = 0.185;     // 185 mV/A (0.185 V/A) for ACS712 5A Model
const float ACS_ZERO_OFFSET_VOLTS = 2.5; // Offset at 0 Amps (Vcc/2, where Vcc = 5V)

// ==========================================
// 3. Global Variables and Timer Intervals
// ==========================================
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

bool signupOK = false;
unsigned long lastFirebaseUploadTime = 0;
const unsigned long FIREBASE_UPLOAD_INTERVAL = 2000; // 2 seconds

// Non-blocking timer for reading sensors and updating the display
unsigned long lastLocalUpdateTime = 0;
const unsigned long LOCAL_UPDATE_INTERVAL = 1000;   // 1 second

// Volatile variable states for display and upload
float solarVoltage = 0.0;
float current = 0.0;
float power = 0.0;
float temp = 0.0;
float hum = 0.0;
int ldrValue = 0;
bool dhtValid = false;

// ==========================================
// 4. Setup Routine
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(10);
  Serial.println("\n--- ESP32 Solar Monitoring System Starting ---");

  // Initialize I2C with specified OLED SDA and SCL pins
  Wire.begin(21, 22);

  // Initialize OLED Display
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) {
    Serial.println(F("[ERROR] SSD1306 OLED initialization failed. System halted."));
    while (true); // Lock here if OLED is missing
  }

  // Draw Initial Welcome Screen
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 10);
  display.println(F("Solar System Monitor"));
  display.println(F("Initializing..."));
  display.setCursor(0, 40);
  display.print(F("WiFi: Connecting"));
  display.display();

  // Initialize DHT Sensor
  dht.begin();

  // Connect to Wi-Fi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi Connected successfully.");
    Serial.print("Local IP: ");
    Serial.println(WiFi.localIP());

    display.clearDisplay();
    display.setCursor(0, 10);
    display.println(F("WiFi Connected!"));
    display.print(F("IP: "));
    display.println(WiFi.localIP());
    display.display();
    delay(1000);
  } else {
    Serial.println("[WARNING] Wi-Fi Connection failed. Will retry in loop.");
  }

  // Configure Firebase Config
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;

  // Enable Auto-Reconnect features
  Firebase.reconnectWiFi(true);
  fbdo.setResponseSize(4096);

  // Attempt Anonymous SignUp to Firebase
  Serial.println("[Firebase] Attempting Anonymous Sign-Up...");
  if (Firebase.signUp(&config, &auth, "", "")) {
    Serial.println("[Firebase] Anonymous Sign-Up Successful.");
    signupOK = true;
  } else {
    Serial.printf("[Firebase] SignUp Error: %s\n", config.signer.signupError.message.c_str());
  }

  // Start Firebase Client Session
  Firebase.begin(&config, &auth);

  display.clearDisplay();
  display.setCursor(0, 20);
  display.println(F("Firebase Setup Done"));
  display.display();
  delay(1000);
}

// ==========================================
// 5. Main Execution Loop
// ==========================================
void loop() {
  unsigned long currentMillis = millis();

  // Task A: Read Sensors and Update local variables (every 1 second)
  if (currentMillis - lastLocalUpdateTime >= LOCAL_UPDATE_INTERVAL || lastLocalUpdateTime == 0) {
    lastLocalUpdateTime = currentMillis;

    // 1. Read LDR Sensor (Light intensity)
    ldrValue = analogRead(LDR_PIN);

    // 2. Read Voltage Sensor (with ESP32 calibration and Divider Multipliers)
    int voltageRaw = analogRead(VOLTAGE_PIN);
    float vSensorOut = (voltageRaw / ADC_RESOLUTION) * ADC_REF_VOLTAGE;
    // Scale back up to actual Solar Panel voltage
    solarVoltage = vSensorOut * VOLTAGE_DIVIDER_RATIO * EXTERNAL_DIVIDER_RATIO;
    if (solarVoltage < 0.15) {
      solarVoltage = 0.0; // Clamp noise at near-zero
    }

    // 3. Read Current Sensor ACS712
    int currentRaw = analogRead(CURRENT_PIN);
    float currentAdcVolts = (currentRaw / ADC_RESOLUTION) * ADC_REF_VOLTAGE;
    // Recover original output voltage of the ACS712 (pre-protection divider)
    float acsActualOutVolts = currentAdcVolts * EXTERNAL_DIVIDER_RATIO;
    // Compute current: I = (V_out - Offset) / Sensitivity
    current = (acsActualOutVolts - ACS_ZERO_OFFSET_VOLTS) / ACS_SENSITIVITY;
    
    // Clamp current noise around zero
    if (current > -0.08 && current < 0.08) {
      current = 0.0;
    }
    // Prevent negative current readings in general use solar direction
    if (current < 0.0) {
      current = 0.0;
    }

    // 4. Calculate Power (P = V * I)
    power = solarVoltage * current;

    // 5. Read DHT11 Temperature & Humidity
    temp = dht.readTemperature();
    hum = dht.readHumidity();

    // Verify DHT11 reads
    if (isnan(temp) || isnan(hum)) {
      Serial.println("[WARNING] DHT11 Read Failed! Sensor unplugged or data pin floating.");
      dhtValid = false;
    } else {
      dhtValid = true;
    }

    // 6. Update OLED Display
    updateOLED();
  }

  // Task B: Upload to Firebase Realtime Database (every 2 seconds, non-blocking)
  if (currentMillis - lastFirebaseUploadTime >= FIREBASE_UPLOAD_INTERVAL) {
    lastFirebaseUploadTime = currentMillis;

    // Output logs to Serial Monitor
    printLocalDataToSerial();

    // Check Firebase and WiFi connection status
    if (WiFi.status() == WL_CONNECTED && Firebase.ready() && signupOK) {
      uploadToFirebase();
    } else {
      Serial.println("[Firebase] Offline. Upload skipped. (WiFi or Firebase client reconnecting...)");
    }
  }
}

// ==========================================
// 6. Helper Functions
// ==========================================

/**
 * Updates the SSD1306 128x64 OLED Display layout
 */
void updateOLED() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  // Row 1: Voltage and Current
  display.setCursor(0, 0);
  display.print(F("V: "));
  display.print(solarVoltage, 1);
  display.print(F(" V"));

  display.setCursor(68, 0);
  display.print(F("I: "));
  display.print(current, 2);
  display.print(F(" A"));

  // Row 2: Power and LDR
  display.setCursor(0, 16);
  display.print(F("P: "));
  display.print(power, 2);
  display.print(F(" W"));

  display.setCursor(68, 16);
  display.print(F("LDR: "));
  display.print(ldrValue);

  // Row 3: Temperature and Humidity
  display.setCursor(0, 32);
  display.print(F("Temp: "));
  if (dhtValid) {
    display.print(temp, 1);
    display.print(F(" C"));
  } else {
    display.print(F("Err"));
  }

  display.setCursor(68, 32);
  display.print(F("Hum: "));
  if (dhtValid) {
    display.print(hum, 0);
    display.print(F(" %"));
  } else {
    display.print(F("Err"));
  }

  // Row 4: Status bar (WiFi and Firebase status indicators)
  display.drawLine(0, 47, 127, 47, SSD1306_WHITE); // Partition line

  display.setCursor(0, 52);
  display.print(F("WiFi: "));
  display.print(WiFi.status() == WL_CONNECTED ? F("OK") : F("DISC"));

  display.setCursor(72, 52);
  display.print(F("FB: "));
  display.print(Firebase.ready() ? F("OK") : F("NC"));

  display.display();
}

/**
 * Prints the currently read sensor values to the Serial Monitor
 */
void printLocalDataToSerial() {
  Serial.println("\n=================================");
  Serial.printf("Solar Voltage: %.2f V\n", solarVoltage);
  Serial.printf("Solar Current: %.2f A\n", current);
  Serial.printf("Solar Power:   %.2f W\n", power);
  if (dhtValid) {
    Serial.printf("Temperature:   %.2f C\n", temp);
    Serial.printf("Humidity:      %.2f %%\n", hum);
  } else {
    Serial.println("Temperature:   DHT Error");
    Serial.println("Humidity:      DHT Error");
  }
  Serial.printf("LDR Value:     %d\n", ldrValue);
  Serial.println("=================================");
}

/**
 * Uploads current data metrics to Firebase Realtime Database
 * Verify status for each entry to display specific success or error messages
 */
void uploadToFirebase() {
  Serial.println("[Firebase] Uploading sensors dataset...");
  bool success = true;

  // 1. Upload Voltage
  if (Firebase.RTDB.setFloat(&fbdo, "/Solar/Voltage", solarVoltage)) {
    Serial.println("[Firebase SUCCESS] Voltage uploaded successfully.");
  } else {
    Serial.printf("[Firebase ERROR] Voltage upload failed: %s\n", fbdo.errorReason().c_str());
    success = false;
  }

  // 2. Upload Current
  if (Firebase.RTDB.setFloat(&fbdo, "/Solar/Current", current)) {
    Serial.println("[Firebase SUCCESS] Current uploaded successfully.");
  } else {
    Serial.printf("[Firebase ERROR] Current upload failed: %s\n", fbdo.errorReason().c_str());
    success = false;
  }

  // 3. Upload Power
  if (Firebase.RTDB.setFloat(&fbdo, "/Solar/Power", power)) {
    Serial.println("[Firebase SUCCESS] Power uploaded successfully.");
  } else {
    Serial.printf("[Firebase ERROR] Power upload failed: %s\n", fbdo.errorReason().c_str());
    success = false;
  }

  // 4. Upload Environment Data (Temperature & Humidity) if valid
  if (dhtValid) {
    if (Firebase.RTDB.setFloat(&fbdo, "/Environment/Temperature", temp)) {
      Serial.println("[Firebase SUCCESS] Temperature uploaded successfully.");
    } else {
      Serial.printf("[Firebase ERROR] Temperature upload failed: %s\n", fbdo.errorReason().c_str());
      success = false;
    }

    if (Firebase.RTDB.setFloat(&fbdo, "/Environment/Humidity", hum)) {
      Serial.println("[Firebase SUCCESS] Humidity uploaded successfully.");
    } else {
      Serial.printf("[Firebase ERROR] Humidity upload failed: %s\n", fbdo.errorReason().c_str());
      success = false;
    }
  } else {
    Serial.println("[Firebase WARNING] Skipping Temp/Hum uploads due to invalid DHT11 sensor readings.");
  }

  // 5. Upload LDR Sensor Value
  if (Firebase.RTDB.setInt(&fbdo, "/Environment/LDR", ldrValue)) {
    Serial.println("[Firebase SUCCESS] LDR Value uploaded successfully.");
  } else {
    Serial.printf("[Firebase ERROR] LDR Value upload failed: %s\n", fbdo.errorReason().c_str());
    success = false;
  }

  if (success) {
    Serial.println("[Firebase] Upload Cycle Complete: All metrics written to RTDB.");
  } else {
    Serial.println("[Firebase] Upload Cycle Completed with one or more errors.");
  }
}
