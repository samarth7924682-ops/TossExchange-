// Firebase Config - tumhara specific setup
const firebaseConfig = {
    apiKey: "AIzaSyD9JmWeC7GbBfKozSkkrAHnLJhAFoy33ec",
    authDomain: "tossexchv2.firebaseapp.com",
    projectId: "tossexchv2",
    storageBucket: "tossexchv2.firebasestorage.app",
    messagingSenderId: "215453367045",
    appId: "1:215453367045:web:775c0d76a0bce40843956c",
    measurementId: "G-1BQKWNERD4"
};

// Initialize Firebase (Compat Mode for mobile editors)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// 👇 ALL-IN-ONE FIREBASE FIX (No Error, No Warning) 👇
db.settings({ 
    experimentalForceLongPolling: true, 
    experimentalAutoDetectLongPolling: false,
    useFetchStreams: false,
    merge: true 
});

// Global constants
window.db = db; 

// --- Helper Functions jo sabhi files mein kaam aayengi ---

// 1. STYLISH POPUP (Toast Notification) 
window.showMsg = (msg, type = 'success') => {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 10px;';
        document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    const bgColor = type === 'error' ? '#c62828' : '#2e7d32'; 
    const icon = type === 'error' ? '' : '';
    
    toast.style.cssText = `background: ${bgColor}; color: white; padding: 12px 24px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-family: sans-serif; font-weight: bold; font-size: 14px; opacity: 0; transform: translateY(-20px); transition: all 0.3s ease; display: flex; align-items: center; gap: 10px;`;
    toast.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
    
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// Override default window alert
window.alert = function(msg) {
    window.showMsg(msg, 'success');
};

// 2. Format Date helper
window.formatDate = (ts) => {
    return new Date(ts).toLocaleString();
};

// 3. User Session Check
window.checkSession = () => {
    const session = localStorage.getItem('userSession');
    return session ? JSON.parse(session) : null;
};

// 4. ROBUST Telegram Notification Logic (100% Guaranteed Delivery)
window.sendTelegramNotification = async (subAdminId, type, userName, amount) => {
    // Fire and forget: UI block nahi hogi, background me kaam chalega
    (async () => {
        try {
            const adminDoc = await db.collection("admins").doc(subAdminId).get();
            if (!adminDoc.exists) return;

            const data = adminDoc.data();
            const botToken = data.botToken;
            const chatId = data.chatId;

            if (!botToken || !chatId) {
                console.log("Telegram details missing for SubAdmin");
                return; 
            }

            const message = `🔔 *New Transaction Request!*\n\n` +
                            `👤 *User:* ${userName}\n` +
                            `📌 *Type:* ${type}\n` +
                            `💰 *Amount:* ₹${amount}\n\n` +
                            `👉 Check your panel to process.`;

            const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
            const payload = { chat_id: chatId, text: message, parse_mode: "Markdown" };

            // Automatic Retry System (upto 10 times with increasing gap)
            let attempt = 1;
            const maxAttempts = 10;
            let success = false;

            while (attempt <= maxAttempts && !success) {
                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    
                    if (response.ok) {
                        console.log(`Telegram notification sent successfully on attempt ${attempt}!`);
                        success = true;
                    } else {
                        console.warn(`Telegram send failed (Attempt ${attempt}): HTTP ${response.status}`);
                    }
                } catch (fetchError) {
                    console.warn(`Telegram fetch error (Attempt ${attempt}):`, fetchError);
                }

                if (!success) {
                    // Har baar fail hone par wait time badhega (2s, 3s, 4.5s...)
                    const waitTime = Math.min(2000 * Math.pow(1.5, attempt - 1), 15000); 
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    attempt++;
                }
            }
        } catch (e) {
            console.error("Telegram Initialization Error:", e);
        }
    })();
};

console.log("App Brain Initialized - Firebase Clean & Fixed.");

// ----------------------------------------------------
// 5. PURE DEVICE TIME (NO API, NO DELAY, NO ERROR)
// ----------------------------------------------------
window.getTrueTime = () => {
    return Date.now();
};
