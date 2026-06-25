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
// 2. Anonymous Authentication Integration
// ==========================================
firebase.auth().signInAnonymously()
  .then(() => {
    console.log("Logged in to Firebase anonymously.");
    setupRealtimeListeners();
  })
  .catch((error) => {
    console.error("Firebase Anonymous Auth failed:", error);
    connectionText.textContent = "Auth Error!";
    connectionDot.className = "status-dot offline";
  });

// ==========================================
// 3. Database Connection Monitor (.info/connected)
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
// 4. Real-time Telemetry Data Listeners
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
      const voltage = parseFloat(data.Voltage);
      document.getElementById("val-voltage").textContent = voltage.toFixed(1);
      
      const vPercent = Math.min((voltage / 25.0) * 100, 100);
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

    // 3. Solar Power Update (P = V * I)
    if (data.Power !== undefined) {
      const power = parseFloat(data.Power);
      document.getElementById("val-power").textContent = power.toFixed(2);
      
      // Control flow animation based on power output
      const chargingLine = document.getElementById("charging-line");
      if (power > 0.05) {
        chargingLine.style.opacity = "1";
        // Dynamically adjust bubble flowing animation speed based on power amount
        const speed = Math.max(0.5, 3.0 - (power / 5.0)); // Larger power = faster bubble speed
        const bubbles = chargingLine.querySelectorAll(".bubble");
        bubbles.forEach(b => b.style.animationDuration = `${speed}s`);
      } else {
        chargingLine.style.opacity = "0.1";
      }
    }
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
      
      // Visual thermometric column fill (0C - 60C range)
      const tPercent = Math.min(Math.max((temp / 60.0) * 100, 0), 100);
      document.getElementById("fill-temp").style.height = `${tPercent}%`;
      
      // Descriptive temperature ranges
      const descEl = document.getElementById("desc-temp");
      if (temp < 18) {
        descEl.textContent = "Cold Environment";
        descEl.style.color = "#60a5fa"; // soft blue
      } else if (temp <= 30) {
        descEl.textContent = "Normal Temperature";
        descEl.style.color = "#10b981"; // soft green
      } else {
        descEl.textContent = "High Heat Warning";
        descEl.style.color = "#ef4444"; // soft red
      }
    }

    // 2. Humidity (DHT11)
    if (data.Humidity !== undefined) {
      const hum = parseInt(data.Humidity);
      document.getElementById("val-hum").textContent = hum;
      document.getElementById("circle-val-hum").textContent = `${hum}%`;
      
      // Circle Path calculations: Circumference = 2 * PI * r = 2 * PI * 34 = 213.6
      const circle = document.getElementById("circle-hum");
      const circumference = 213.6;
      const offset = circumference - (hum / 100.0) * circumference;
      circle.style.strokeDashoffset = offset;
    }

    // 3. LDR Ambient Light (Scale: 0 - 4095 on ESP32 ADC)
    if (data.LDR !== undefined) {
      const ldr = parseInt(data.LDR);
      document.getElementById("val-ldr").textContent = ldr;
      
      // Calculate brightness percentage (higher ADC = brighter sunlight)
      const ldrPercent = Math.min((ldr / 4095.0) * 100, 100);
      document.getElementById("level-ldr").style.width = `${ldrPercent}%`;
      document.getElementById("percent-ldr").textContent = `${Math.round(ldrPercent)}%`;

      // Set Sunlight Descriptor
      const ldrDesc = document.getElementById("desc-ldr");
      const sunIcon = document.getElementById("ldr-sun-icon");
      
      if (ldr < 400) {
        ldrDesc.textContent = "Night / Dark";
        ldrDesc.style.color = "#64748b";
        sunIcon.style.animation = "none";
      } else if (ldr < 1500) {
        ldrDesc.textContent = "Cloudy / Indoor";
        ldrDesc.style.color = "#3b82f6";
        sunIcon.style.animation = "glow-pulse 3s infinite alternate";
      } else if (ldr < 2800) {
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
}

// Helper to trigger a brief glowing rotation on the Sync logo
function triggerSyncAnimation() {
  syncIcon.classList.add("active");
  setTimeout(() => {
    // Only remove spinner if database says it's online
    if (connectionDot.classList.contains("online")) {
      syncIcon.classList.remove("active");
    }
  }, 600);
}
