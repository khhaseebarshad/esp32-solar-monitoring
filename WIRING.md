# Hardware Wiring Guide - ESP32 Solar Energy Monitoring System

This document outlines the wiring configuration for the ESP32 Solar Energy Monitoring System. 

> [!IMPORTANT]
> **ESP32 Operating Voltage:** The ESP32 microchip operates at **3.3V**. Its GPIO pins are **NOT 5V tolerant**. Exposing GPIO pins to 5V will damage the board. Follow the specific wiring instructions below for 5V sensors (ACS712 and Voltage Sensor) to safely scale down their output voltages.

---

## 1. Pin Mapping Summary

| Device / Sensor | ESP32 GPIO Pin | Sensor Pin Name | Power Requirement | Connection Notes |
| :--- | :--- | :--- | :--- | :--- |
| **SSD1306 OLED** | **GPIO 21 (SDA)**<br>**GPIO 22 (SCL)** | SDA<br>SCL | 3.3V | Connect via I2C interface. |
| **DHT11 Sensor** | **GPIO 27** | OUT / DATA | 3.3V or 5V | Requires a 4.7kΩ - 10kΩ pull-up resistor if using a bare sensor. (Most break-out boards have this built-in). |
| **Voltage Sensor** | **GPIO 34 (ADC1_CH6)** | OUT | Solar Panel / 5V | Analog input. Uses a 5:1 voltage divider. Requires voltage scaling protection. |
| **ACS712 Sensor** | **GPIO 35 (ADC1_CH7)** | OUT | 5V (Mandatory) | Analog input. Measures current. Requires voltage divider protection at output. |
| **LDR Sensor** | **GPIO 32 (ADC1_CH4)** | OUT / Analog | 3.3V | Connected in a voltage divider setup. |

---

## 2. Sensor Connection Details & Safe Voltage Scaling

### A. SSD1306 OLED Display (128x64 I2C)
* **VCC** → ESP32 **3.3V**
* **GND** → ESP32 **GND**
* **SDA** → ESP32 **GPIO 21**
* **SCL** → ESP32 **GPIO 22**

### B. DHT11 Temperature & Humidity Sensor
* **VCC** → ESP32 **3.3V** (or 5V if using a module that supports it)
* **GND** → ESP32 **GND**
* **DATA** → ESP32 **GPIO 27**
  *(Note: If using a raw 4-pin DHT11 instead of a 3-pin module, place a 10kΩ resistor between VCC and DATA).*

### C. Voltage Sensor Module (0-25V)
The standard Voltage Sensor Module consists of a 5:1 voltage divider circuit ($R_1 = 30\text{k}\Omega, R_2 = 7.5\text{k}\Omega$). 
* When measuring a solar panel voltage of $25\text{V}$, the output voltage is $25 \times \frac{7.5}{30 + 7.5} = 5\text{V}$.
* Because the ESP32 can only handle up to $3.3\text{V}$ on its ADC pins, you must limit the input solar voltage or add a secondary voltage divider at the sensor output.

**Safe Connection Steps (using an additional divider):**
1. Connect Solar Panel positive terminal to Voltage Sensor **VCC (+)**.
2. Connect Solar Panel negative terminal to Voltage Sensor **GND (-)**.
3. Connect Voltage Sensor **GND pin (signal side)** to ESP32 **GND**.
4. To step down the sensor's maximum **5V** output to **3.3V**:
   * Connect a **10kΩ resistor** ($R_{s1}$) from the Voltage Sensor **OUT** pin to ESP32 **GPIO 34**.
   * Connect a **20kΩ resistor** ($R_{s2}$) from ESP32 **GPIO 34** to **GND**.
   * *Formula:* $V_{GPIO34} = V_{OUT} \times \frac{20\text{k}\Omega}{10\text{k}\Omega + 20\text{k}\Omega} = V_{OUT} \times 0.666$.

### D. ACS712 Current Sensor (5A Model)
The ACS712 Hall Effect current sensor operates at **5V VCC** for proper internal magnetic field measurement.
* **VCC** → ESP32 **5V (VIN / 5V pin)**
* **GND** → ESP32 **GND**
* **OUT** → ESP32 **GPIO 35** (Protected by a Voltage Divider)

**Output Protection Divider:**
At 0 Amps, the ACS712 outputs exactly half of its supply voltage ($V_{cc} / 2 = 2.5\text{V}$). Under forward current load, the output goes up to 5V. To scale this safely:
1. Connect a **10kΩ resistor** from the ACS712 **OUT** pin to ESP32 **GPIO 35**.
2. Connect a **20kΩ resistor** from ESP32 **GPIO 35** to **GND**.
3. In the Arduino code, we compensate for this scaling factor ($0.666$) when calculating the actual raw current value.

### E. LDR (Light Dependent Resistor) Sensor
Create a voltage divider using the LDR and a fixed $10\text{k}\Omega$ resistor:
1. Connect one pin of the **LDR** to ESP32 **3.3V**.
2. Connect the second pin of the **LDR** to ESP32 **GPIO 32**.
3. Connect a **10kΩ resistor** from ESP32 **GPIO 32** to **GND**.
*When light intensity increases, the LDR's resistance decreases, causing the voltage read on GPIO 32 to rise.*

---

## 3. Physical Wiring Schematic Checklist

```
           +--------------------------------------------+
           |                 ESP32                      |
           |                                            |
           |     3.3V  GND  G21  G22  G27  G32  G34  G35  |
           +------+----+----+----+----+----+----+----+---+
                  |    |    |    |    |    |    |    |
   +--------------+    |    |    |    |    |    |    |
   |   +---------------+    |    |    |    |    |    |
   |   |   +----------------+    |    |    |    |    |
   |   |   |   +-----------------+    |    |    |    |
   |   |   |   |   +------------------+    |    |    |
   |   |   |   |   |   +-------------------+    |    |
   |   |   |   |   |   |   +--------------------+    |
   |   |   |   |   |   |   |   +---------------------+
   |   |   |   |   |   |   |   |
 [ OLED ]  |   |   |   |   |   |
  - VCC    |   |   |   |   |   |
  - GND    |   |   |   |   |   |
  - SDA----+   |   |   |   |   |
  - SCL--------+   |   |   |   |
                   |   |   |   |
 [ DHT11 ]         |   |   |   |
  - VCC------------+   |   |   |
  - GND------------+   |   |   |
  - DATA---------------+   |   |
                           |   |
 [ LDR Divider ]           |   |
  - To 3.3V----------------+   |
  - GPIO 32 Junction-----------+
  - 10k Resistor to GND
                           |
 [ Voltage Sensor Output ] |
  - OUT ----[ 10k Resistor ]---+-- GPIO 34
                               |
                              [20k Resistor to GND]
  - GND -----------------------+-- ESP32 GND
                           |
 [ ACS712 Current Out ]    |
  - OUT ----[ 10k Resistor ]---+-- GPIO 35
                               |
                              [20k Resistor to GND]
  - GND -----------------------+-- ESP32 GND
```
