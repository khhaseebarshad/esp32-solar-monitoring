// ==========================================
// 1. Firebase Initialization & Credentials
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAfUaWBWw3N86p2hdDmseFlur95_EpHQqw",
  authDomain: "solar-system-using-esp-32.firebaseapp.com",
  databaseURL: "https://solar-system-using-esp-32-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "solar-system-using-esp-32",
  storageBucket: "solar-system-using-esp-32.appspot.com"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// DOM Element references for status bar
const connectionDot = document.querySelector("#connection-status .status-dot");
const connectionText = document.querySelector("#connection-status .status-text");
const syncIcon = document.querySelector("#sync-status i");
const syncText = document.querySelector("#sync-status .sync-text");

// ==========================================
// 2. Global State Variables for Analytics
// ==========================================
let totalEnergyWh = parseFloat(localStorage.getItem("totalSolarWh")) || 0.0;
let lastUpdateTime = Date.now();
const UTILITY_RATE_PER_KWH = 40.0; // Rs. per kWh unit

let currentVoltageVal = 0.0;
let currentLdrVal = 0;
let currentWeatherCode = 0; // WMO Weather Code from Open-Meteo
let batterySoC = parseFloat(localStorage.getItem("virtualBatterySoC")) || 75.0; // Simulated battery state
let currentSolarPower = 0.0; // Cached solar power for calculations
let lastBatteryUpdateTime = Date.now(); // Separate timer for battery SoC

let liveChart = null;

// ==========================================
// 3. Anonymous Authentication Integration
// ==========================================
firebase.auth().signInAnonymously()
  .then(() => {
    console.log("Logged in to Firebase anonymously.");
    initChart(); // Initialize Chart.js
    setupRealtimeListeners();
    fetchOutsideWeather(); // Fetch outside weather on load
    setInterval(fetchOutsideWeather, 600000); // Refresh every 10 mins
    updateBatterySimulation(); // Initial battery calculation
  })
  .catch((error) => {
    console.error("Firebase Anonymous Auth failed:", error);
    connectionText.textContent = "Auth Error!";
    connectionDot.className = "status-dot offline";
  });

// ==========================================
// 4. Database Connection Monitor (.info/connected)
// ==========================================
database.ref(".info/connected").on("value", (snap) => {
  if (snap.val() === true) {
    connectionDot.className = "status-dot online";
    connectionText.textContent = "Connected to Firebase";
    syncIcon.classList.remove("active");
    syncText.textContent = "Live Synced";
  } else {
    connectionDot.className = "status-dot offline";
    connectionText.textContent = "Offline / Connecting...";
    syncIcon.classList.add("active");
    syncText.textContent = "Syncing...";
  }
});

// ==========================================
// 5. Chart.js Initialization
// ==========================================
function initChart() {
  const ctx = document.getElementById('liveTrendChart').getContext('2d');
  
  // Custom theme variables matching style.css
  liveChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [], // Time slots will be pushed here
      datasets: [
        {
          label: 'Power (W)',
          borderColor: '#22d3ee', // Cyan
          backgroundColor: 'rgba(34, 211, 238, 0.08)',
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: '#22d3ee',
          data: [],
          yAxisID: 'y-power',
          tension: 0.35,
          fill: true
        },
        {
          label: 'Voltage (V)',
          borderColor: '#f97316', // Orange
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 2,
          pointBackgroundColor: '#f97316',
          data: [],
          yAxisID: 'y-voltage',
          tension: 0.35
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.04)'
          },
          ticks: {
            color: '#94a3b8',
            font: { family: 'Outfit', size: 10 }
          }
        },
        'y-power': {
          type: 'linear',
          position: 'left',
          title: {
            display: true,
            text: 'Power (Watts)',
            color: '#22d3ee',
            font: { family: 'Outfit', weight: 'bold' }
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.04)'
          },
          ticks: {
            color: '#22d3ee',
            font: { family: 'Outfit' }
          },
          min: 0
        },
        'y-voltage': {
          type: 'linear',
          position: 'right',
          title: {
            display: true,
            text: 'Voltage (Volts)',
            color: '#f97316',
            font: { family: 'Outfit', weight: 'bold' }
          },
          grid: {
            drawOnChartArea: false // Avoid duplicate grid lines overlaying
          },
          ticks: {
            color: '#f97316',
            font: { family: 'Outfit' }
          },
          min: 0,
          max: 25
        }
      },
      plugins: {
        legend: {
          labels: {
            color: '#f1f5f9',
            font: { family: 'Outfit', size: 12 }
          }
        }
      }
    }
  });
}

// ==========================================
// 6. Real-time Telemetry Data Listeners
// ==========================================
function setupRealtimeListeners() {
  
  // A. Monitor Solar Data node
  database.ref("/Solar").on("value", (snapshot) => {
    const data = snapshot.val();
    console.log("[DEBUG] Solar Data snapshot:", data);
    if (!data) return;

    triggerSyncAnimation();

    // 1. Solar Voltage Update (Scale: 0V - 25V)
    if (data.Voltage !== undefined) {
      currentVoltageVal = parseFloat(data.Voltage);
      document.getElementById("val-voltage").textContent = currentVoltageVal.toFixed(1);
      
      const vPercent = Math.min((currentVoltageVal / 25.0) * 100, 100);
      document.getElementById("pb-voltage").style.width = `${vPercent}%`;
      document.getElementById("percent-voltage").textContent = `${Math.round(vPercent)}%`;
    }

    // 2. Solar Current Update (Scale: 0A - 5A)
    if (data.Current !== undefined) {
      const current = parseFloat(data.Current);
      document.getElementById("val-current").textContent = current.toFixed(2);
      
      const iPercent = Math.min((current / 5.0) * 100, 100);
      document.getElementById("pb-current").style.width = `${iPercent}%`;
      document.getElementById("percent-current").textContent = `${Math.round(iPercent)}%`;
    }

    // 3. Solar Power & Energy Accumulator (Wh & Money Savings)
    if (data.Power !== undefined) {
      const power = parseFloat(data.Power);
      currentSolarPower = power; // Save globally
      document.getElementById("val-power").textContent = power.toFixed(2);
      
      // Calculate elapsed hours since last database packet read
      const now = Date.now();
      const elapsedHours = (now - lastUpdateTime) / 3600000.0;
      lastUpdateTime = now;

      // Accumulate energy generated in Watt-hours
      if (power > 0.02) {
        totalEnergyWh += (power * elapsedHours);
        localStorage.setItem("totalSolarWh", totalEnergyWh);
      }

      // Display Wh (or kWh if energy exceeds 1000Wh)
      const energyDisplay = document.getElementById("val-energy");
      const energyUnit = energyDisplay.nextElementSibling;
      if (totalEnergyWh < 1000) {
        energyDisplay.textContent = totalEnergyWh.toFixed(3);
        energyUnit.textContent = "Wh";
      } else {
        energyDisplay.textContent = (totalEnergyWh / 1000.0).toFixed(4);
        energyUnit.textContent = "kWh";
      }

      // Calculate and display Money Saved (Energy in kWh * Rate per Unit)
      const totalKwh = totalEnergyWh / 1000.0;
      const costSavings = totalKwh * UTILITY_RATE_PER_KWH;
      document.getElementById("val-savings").textContent = costSavings.toFixed(2);

      // Calculate and display CO2 avoided (0.85 kg per kWh)
      const co2Avoided = totalKwh * 0.85;
      const co2Display = document.getElementById("val-co2");
      if (co2Display) co2Display.textContent = co2Avoided.toFixed(3);

      // Calculate and display Trees Equivalent (1 tree absorbs ~22kg/year)
      const treesEquivalent = co2Avoided / 22.0;
      const treesDisplay = document.getElementById("val-trees");
      if (treesDisplay) treesDisplay.textContent = treesEquivalent.toFixed(4);

      // Run Virtual Storage Battery SoC Simulation
      updateBatterySimulation();

      // Control flow bubble animation based on power output
      const chargingLine = document.getElementById("charging-line");
      if (power > 0.05) {
        chargingLine.style.opacity = "1";
        const speed = Math.max(0.5, 3.0 - (power / 5.0)); // Larger power = faster flow
        const bubbles = chargingLine.querySelectorAll(".bubble");
        bubbles.forEach(b => b.style.animationDuration = `${speed}s`);
      } else {
        chargingLine.style.opacity = "0.1";
      }

      // 4. Update Live Trend Chart
      if (liveChart && data.Voltage !== undefined) {
        const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        // Cap visual records to 15 entries on screen
        if (liveChart.data.labels.length >= 15) {
          liveChart.data.labels.shift();
          liveChart.data.datasets[0].data.shift(); // Remove oldest Power
          liveChart.data.datasets[1].data.shift(); // Remove oldest Voltage
        }
        
        liveChart.data.labels.push(timeLabel);
        liveChart.data.datasets[0].data.push(power);
        liveChart.data.datasets[1].data.push(currentVoltageVal);
        liveChart.update();
      }
    }

    // Run Diagnostics
    runDiagnostics();
    updateSolarAdvisor(); // Update load advisor on telemetry changes
  });

  // B. Monitor Environmental Data node
  database.ref("/Environment").on("value", (snapshot) => {
    const data = snapshot.val();
    console.log("[DEBUG] Environment Data snapshot:", data);
    if (!data) return;

    triggerSyncAnimation();

    // 1. Temperature (DHT11) & Thermal Loss Calculation
    if (data.Temperature !== undefined) {
      const temp = parseFloat(data.Temperature);
      document.getElementById("val-temp").textContent = temp.toFixed(1);
      
      const tPercent = Math.min(Math.max((temp / 60.0) * 100, 0), 100);
      document.getElementById("fill-temp").style.height = `${tPercent}%`;
      
      const descEl = document.getElementById("desc-temp");
      if (temp < 18) {
        descEl.textContent = "Cold Environment";
        descEl.style.color = "#60a5fa";
      } else if (temp <= 30) {
        descEl.textContent = "Normal Temperature";
        descEl.style.color = "#10b981";
      } else {
        descEl.textContent = "High Heat Warning";
        descEl.style.color = "#ef4444";
      }

      // Calculate Solar PV Thermal Efficiency Loss (0.4% per °C above 25°C)
      const thermalLoss = Math.max((temp - 25.0) * 0.4, 0.0);
      const lossValEl = document.getElementById("val-thermal-loss");
      if (lossValEl) lossValEl.textContent = thermalLoss.toFixed(1);

      const pbThermal = document.getElementById("pb-thermal");
      if (pbThermal) {
        // Scale visually 0% - 15% range for progress bar width
        const lossPercent = Math.min((thermalLoss / 15.0) * 100, 100);
        pbThermal.style.width = `${lossPercent}%`;
      }

      const descThermal = document.getElementById("desc-thermal");
      const thermalIcon = document.getElementById("thermal-icon");
      if (descThermal) {
        if (temp <= 25.0) {
          descThermal.textContent = "Optimal panel temp. 0% heat loss.";
          descThermal.style.color = "#10b981";
          if (thermalIcon) thermalIcon.style.animation = "none";
        } else if (temp <= 35.0) {
          descThermal.textContent = `Mild loss. Panel temp is ${temp.toFixed(1)}°C.`;
          descThermal.style.color = "#f97316";
          if (thermalIcon) thermalIcon.style.animation = "glow-pulse 2s infinite alternate";
        } else {
          descThermal.textContent = "High heat! Panel efficiency reduced.";
          descThermal.style.color = "#ef4444";
          if (thermalIcon) thermalIcon.style.animation = "glow-pulse 0.8s infinite alternate";
        }
      }
    }

    // 2. Humidity (DHT11)
    if (data.Humidity !== undefined) {
      const hum = parseInt(data.Humidity);
      document.getElementById("val-hum").textContent = hum;
      document.getElementById("circle-val-hum").textContent = `${hum}%`;
      
      const circle = document.getElementById("circle-hum");
      const circumference = 213.6;
      const offset = circumference - (hum / 100.0) * circumference;
      circle.style.strokeDashoffset = offset;
    }

    // 3. LDR Ambient Light (Scale: 0 - 4095 on ESP32 ADC)
    if (data.LDR !== undefined) {
      currentLdrVal = parseInt(data.LDR);
      document.getElementById("val-ldr").textContent = currentLdrVal;
      
      const ldrPercent = Math.min((currentLdrVal / 4095.0) * 100, 100);
      document.getElementById("level-ldr").style.width = `${ldrPercent}%`;
      document.getElementById("percent-ldr").textContent = `${Math.round(ldrPercent)}%`;

      // Set Sunlight Descriptor
      const ldrDesc = document.getElementById("desc-ldr");
      const sunIcon = document.getElementById("ldr-sun-icon");
      
      if (currentLdrVal < 400) {
        ldrDesc.textContent = "Night / Dark";
        ldrDesc.style.color = "#64748b";
        sunIcon.style.animation = "none";
      } else if (currentLdrVal < 1500) {
        ldrDesc.textContent = "Cloudy / Indoor";
        ldrDesc.style.color = "#3b82f6";
        sunIcon.style.animation = "glow-pulse 3s infinite alternate";
      } else if (currentLdrVal < 2800) {
        ldrDesc.textContent = "Daylight / Overcast";
        ldrDesc.style.color = "#f97316";
        sunIcon.style.animation = "glow-pulse 1.5s infinite alternate";
      } else {
        ldrDesc.textContent = "Direct Sunny Day";
        ldrDesc.style.color = "#eab308";
        sunIcon.style.animation = "glow-pulse 0.8s infinite alternate";
      }
    }

  });

  // C. Monitor Smart Appliance Switch control node
  database.ref("/Control/Relay").on("value", (snapshot) => {
    const isChecked = snapshot.val() === true;
    const toggleBtn = document.getElementById("btn-toggle-relay");
    const statusText = document.getElementById("appliance-status");
    const bulbIcon = document.getElementById("appliance-bulb-icon");

    if (toggleBtn) toggleBtn.checked = isChecked;
    if (statusText && bulbIcon) {
      if (isChecked) {
        statusText.textContent = "Appliance: ON";
        statusText.classList.add("active");
        bulbIcon.classList.add("active");
      } else {
        statusText.textContent = "Appliance: OFF";
        statusText.classList.remove("active");
        bulbIcon.classList.remove("active");
      }
    }
    // Update battery simulation immediately on switch state change
    updateBatterySimulation();
  });

  // Handle user interaction with the toggle switch
  const toggleBtn = document.getElementById("btn-toggle-relay");
  if (toggleBtn) {
    toggleBtn.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      database.ref("/Control/Relay").set(isChecked)
        .then(() => {
          console.log("[Firebase] Appliance Relay state set to:", isChecked);
        })
        .catch((err) => {
          console.error("[Firebase] Appliance Relay toggle write failed:", err);
        });
    });
  }
}

// ==========================================
// 7. Software-Defined Anomaly & Dust Diagnostics
// ==========================================
function runDiagnostics() {
  const effBox = document.getElementById("efficiency-box");
  const effDot = document.getElementById("eff-dot");
  const effStatus = document.getElementById("eff-status");
  const effDesc = document.getElementById("eff-desc");

  if (currentLdrVal === undefined || currentVoltageVal === undefined) return;

  // Anomaly Rules
  if (currentLdrVal >= 2500) { // Sunlight is very bright
    if (currentVoltageVal < 4.0) { // Panel voltage should be high, but is extremely low
      effBox.style.borderLeftColor = "var(--color-red)";
      effDot.style.backgroundColor = "var(--color-red)";
      effDot.style.boxShadow = "0 0 10px var(--color-red)";
      effStatus.textContent = "Dust or Shading Alert!";
      effStatus.style.color = "var(--color-red)";
      effDesc.textContent = "High sunlight detected, but panel output is nearly zero. Possible heavy dust blockage or shadowing.";
    } else if (currentVoltageVal < 10.0) { // Suboptimal reading
      effBox.style.borderLeftColor = "var(--color-orange)";
      effDot.style.backgroundColor = "var(--color-orange)";
      effDot.style.boxShadow = "0 0 10px var(--color-orange)";
      effStatus.textContent = "Suboptimal Efficiency Detected";
      effStatus.style.color = "var(--color-orange)";
      effDesc.textContent = "Sunlight is strong but voltage is moderate. Possible dust layer or partial tree shadows. Cleaning recommended.";
    } else { // Optimal
      effBox.style.borderLeftColor = "var(--color-green)";
      effDot.style.backgroundColor = "var(--color-green)";
      effDot.style.boxShadow = "0 0 10px var(--color-green)";
      effStatus.textContent = "Peak Optimal Performance";
      effStatus.style.color = "var(--color-green)";
      effDesc.textContent = "Panel conversion rate is clean and optimal. Sunshine matches peak energy production.";
    }
  } else if (currentLdrVal < 400) { // Night mode
    effBox.style.borderLeftColor = "var(--text-dark)";
    effDot.style.backgroundColor = "var(--text-dark)";
    effDot.style.boxShadow = "0 0 5px var(--text-dark)";
    effStatus.textContent = "Night Standby Mode";
    effStatus.style.color = "var(--text-secondary)";
    effDesc.textContent = "No sunlight detected. Solar system is on standby waiting for sunrise.";
  } else { // Diffuse/Cloudy daylight
    effBox.style.borderLeftColor = "var(--color-blue)";
    effDot.style.backgroundColor = "var(--color-blue)";
    effDot.style.boxShadow = "0 0 10px var(--color-blue)";
    effStatus.textContent = "Normal Diffuse Light";
    effStatus.style.color = "var(--color-blue)";
    effDesc.textContent = "Moderate ambient daylight. System is performing within normal limits for cloudy weather.";
  }
}

// Helper to trigger a brief glowing rotation on the Sync logo
function triggerSyncAnimation() {
  syncIcon.classList.add("active");
  setTimeout(() => {
    if (connectionDot.classList.contains("online")) {
      syncIcon.classList.remove("active");
    }
  }, 600);
}

// ==========================================
// 8. Outside Local Weather Fetching
// ==========================================
function fetchOutsideWeather() {
  const weatherDesc = document.getElementById("desc-weather");
  if (weatherDesc) weatherDesc.textContent = "Updating weather...";

  // Detect location via free IP-based geolocation
  fetch("https://ipapi.co/json/")
    .then(res => res.json())
    .then(geoData => {
      const lat = geoData.latitude || 31.5204;
      const lon = geoData.longitude || 74.3587;
      const city = geoData.city ? `${geoData.city}, ${geoData.country_code}` : "Lahore, PK";
      getWeatherData(lat, lon, city);
    })
    .catch(err => {
      console.warn("IP Geolocation failed. Falling back to default (Lahore, PK):", err);
      getWeatherData(31.5204, 74.3587, "Lahore, PK");
    });
}

function getWeatherData(lat, lon, cityName) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code`;
  
  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data && data.current) {
        const temp = data.current.temperature_2m;
        const hum = data.current.relative_humidity_2m;
        const code = data.current.weather_code;
        currentWeatherCode = code; // Save weather code globally
        updateSolarAdvisor();      // Update load advisor on weather update
        
        const tempEl = document.getElementById("val-outside-temp");
        const humEl = document.getElementById("val-outside-hum");
        const locEl = document.getElementById("val-outside-location");
        const descEl = document.getElementById("desc-weather");
        const weatherIcon = document.getElementById("weather-icon");

        if (tempEl) tempEl.textContent = temp.toFixed(1);
        if (humEl) humEl.textContent = `${hum}%`;
        if (locEl) locEl.textContent = cityName;
        
        // Map weather code
        const weatherInfo = mapWeatherCode(code);
        if (descEl) descEl.textContent = weatherInfo.text;
        
        if (weatherIcon) {
          weatherIcon.className = `fa-solid ${weatherInfo.icon} icon-weather`;
          weatherIcon.style.animation = weatherInfo.animation;
        }
      }
    })
    .catch(err => {
      console.error("Error fetching weather from Open-Meteo:", err);
      const descEl = document.getElementById("desc-weather");
      if (descEl) descEl.textContent = "Failed to load weather";
    });
}

function mapWeatherCode(code) {
  // WMO Weather Codes (https://open-meteo.com/en/docs)
  if (code === 0) {
    return { text: "Clear Sky", icon: "fa-sun", animation: "glow-pulse 2s infinite alternate" };
  } else if (code >= 1 && code <= 3) {
    return { text: "Partly Cloudy", icon: "fa-cloud-sun", animation: "none" };
  } else if (code === 45 || code === 48) {
    return { text: "Foggy Weather", icon: "fa-smog", animation: "none" };
  } else if (code >= 51 && code <= 55) {
    return { text: "Light Drizzle", icon: "fa-cloud-rain", animation: "none" };
  } else if (code >= 61 && code <= 65) {
    return { text: "Rainy Weather", icon: "fa-cloud-showers-heavy", animation: "none" };
  } else if (code >= 71 && code <= 77) {
    return { text: "Snowy Weather", icon: "fa-snowflake", animation: "none" };
  } else if (code >= 80 && code <= 82) {
    return { text: "Rain Showers", icon: "fa-cloud-sun-rain", animation: "none" };
  } else if (code >= 95 && code <= 99) {
    return { text: "Thunderstorm", icon: "fa-cloud-bolt", animation: "glow-pulse 0.8s infinite alternate" };
  } else {
    return { text: "Cloudy / Overcast", icon: "fa-cloud", animation: "none" };
  }
}

// ==========================================
// 9. Intelligent Solar Load Advisor
// ==========================================
function updateSolarAdvisor() {
  const statusEl = document.getElementById("val-advisor-status");
  const recEl = document.getElementById("desc-advisor-recommendation");
  const iconEl = document.getElementById("advisor-icon");

  if (!statusEl || !recEl) return;

  const powerText = document.getElementById("val-power") ? document.getElementById("val-power").textContent : "0.0";
  const power = parseFloat(powerText) || 0.0;
  const ldr = currentLdrVal;

  // Decide scenario based on weather code and current telemetry
  const isStormyOrRainy = currentWeatherCode >= 51;
  const isCloudyOrFoggy = (currentWeatherCode >= 1 && currentWeatherCode <= 48) || (currentWeatherCode >= 80 && currentWeatherCode <= 82);

  if (isStormyOrRainy) {
    statusEl.textContent = "Grid Recommended";
    statusEl.style.color = "var(--color-red)";
    recEl.textContent = "Rain/storm forecasted. Solar yield restricted. Run high-power loads on grid to protect backup batteries.";
    if (iconEl) {
      iconEl.className = "fa-solid fa-cloud-bolt icon-advisor";
      iconEl.style.animation = "pulse 1.5s infinite alternate";
    }
  } else if (power < 0.25 && ldr < 400) {
    statusEl.textContent = "Standby (Night)";
    statusEl.style.color = "var(--text-dark)";
    recEl.textContent = "Sunset detected. System is in standby mode. Batteries are on normal discharge cycle.";
    if (iconEl) {
      iconEl.className = "fa-solid fa-moon icon-advisor";
      iconEl.style.animation = "none";
    }
  } else if (isCloudyOrFoggy || (power < 1.0 && ldr < 1500)) {
    statusEl.textContent = "Moderate Yield";
    statusEl.style.color = "var(--color-orange)";
    recEl.textContent = "Cloudy skies or moderate sun. Battery charging active. Limit high-wattage appliance runs on solar.";
    if (iconEl) {
      iconEl.className = "fa-solid fa-cloud-sun icon-advisor";
      iconEl.style.animation = "none";
    }
  } else {
    statusEl.textContent = "Optimal Yield";
    statusEl.style.color = "var(--color-green)";
    recEl.textContent = "Peak sunshine & clear skies. Highly optimal conditions! Switch heavy appliances (pumps, AC) to solar.";
    if (iconEl) {
      iconEl.className = "fa-solid fa-brain icon-advisor";
      iconEl.style.animation = "glow-pulse 1.5s infinite alternate";
    }
  }
}

// ==========================================
// 10. Multi-Theme Switching Logic
// ==========================================
const themeSelect = document.getElementById("theme-select");
if (themeSelect) {
  // Load saved theme
  const savedTheme = localStorage.getItem("selectedTheme") || "theme-cyber-dark";
  themeSelect.value = savedTheme;
  document.body.className = savedTheme;

  themeSelect.addEventListener("change", (e) => {
    const selectedTheme = e.target.value;
    document.body.className = selectedTheme;
    localStorage.setItem("selectedTheme", selectedTheme);
  });
}

// ==========================================
// 11. Virtual Storage Battery Simulation
// ==========================================
function updateBatterySimulation() {
  const socValEl = document.getElementById("val-battery-soc");
  const fillEl = document.getElementById("pb-battery-fill");
  const statusEl = document.getElementById("desc-battery-status");
  const wattEl = document.getElementById("val-battery-net-watt");
  const batteryIcon = document.getElementById("battery-charging-icon");

  if (!socValEl || !fillEl) return;

  // Calculate elapsed hours since last battery update
  const now = Date.now();
  const elapsedHours = (now - lastBatteryUpdateTime) / 3600000.0;
  lastBatteryUpdateTime = now;

  // Determine smart appliance state
  const isApplianceOn = document.getElementById("btn-toggle-relay") ? document.getElementById("btn-toggle-relay").checked : false;

  // Appliance consumes virtual 20W, background system consumes 2W standby
  const loadConsumption = isApplianceOn ? 20.0 : 0.0;
  const standbyConsumption = 2.0;
  const netPower = currentSolarPower - loadConsumption - standbyConsumption;

  // Battery capacity: 12V 100Ah = 1200Wh. Update SoC
  const deltaSoC = (netPower * elapsedHours / 1200.0) * 100.0;
  batterySoC = Math.min(Math.max(batterySoC + deltaSoC, 0.0), 100.0);
  
  // Persist State of Charge
  localStorage.setItem("virtualBatterySoC", batterySoC);

  // Update DOM elements
  socValEl.textContent = batterySoC.toFixed(1);
  fillEl.style.height = `${batterySoC}%`;

  if (wattEl) {
    const sign = netPower >= 0 ? "+" : "";
    wattEl.textContent = `${sign}${netPower.toFixed(1)}W`;
  }

  if (statusEl) {
    if (netPower > 0.0) {
      statusEl.textContent = "Charging via Solar";
      statusEl.style.color = "var(--color-green)";
      if (batteryIcon) {
        batteryIcon.className = "fa-solid fa-battery-charging icon-battery charging";
      }
    } else {
      statusEl.textContent = isApplianceOn ? "Discharging (Load Active)" : "Discharging (Standby)";
      statusEl.style.color = isApplianceOn ? "var(--color-orange)" : "var(--text-secondary)";
      if (batteryIcon) {
        if (batterySoC > 80.0) {
          batteryIcon.className = "fa-solid fa-battery-full icon-battery";
        } else if (batterySoC > 50.0) {
          batteryIcon.className = "fa-solid fa-battery-three-quarters icon-battery";
        } else if (batterySoC > 20.0) {
          batteryIcon.className = "fa-solid fa-battery-half icon-battery";
        } else {
          batteryIcon.className = "fa-solid fa-battery-empty icon-battery";
        }
        batteryIcon.style.animation = "none";
      }
    }
  }
}
