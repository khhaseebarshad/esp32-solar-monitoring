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

let liveChart = null;

// ==========================================
// 3. Anonymous Authentication Integration
// ==========================================
firebase.auth().signInAnonymously()
  .then(() => {
    console.log("Logged in to Firebase anonymously.");
    initChart(); // Initialize Chart.js
    setupRealtimeListeners();
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
  });

  // B. Monitor Environmental Data node
  database.ref("/Environment").on("value", (snapshot) => {
    const data = snapshot.val();
    console.log("[DEBUG] Environment Data snapshot:", data);
    if (!data) return;

    triggerSyncAnimation();

    // 1. Temperature (DHT11)
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

    // Run Diagnostics
    runDiagnostics();
  });
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
