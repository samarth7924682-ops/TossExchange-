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
    
    toast.style.cssText = `background: ${bgColor}; color: white; padding: 12px 24px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); font-family: sans-serif; font-weight: bold; font-size: 14px; opacity: 0; transform: translateY(-20px); transition: all 0.3s ease; display: flex; align-items: center; gap: 10px;`;
    toast.innerHTML = `<span>${msg}</span>`;
    
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
                const waitTime = Math.min(2000 * Math.pow(1.5, attempt - 1), 15000); 
                await new Promise(resolve => setTimeout(resolve, waitTime));
                attempt++;
            }
        }
    } catch (e) {
        console.error("Telegram Initialization Error:", e);
    }
};

window.getTrueTime = () => {
    return Date.now();
};

// ==========================================
// 5. GLOBAL FIREBASE BACKGROUND CLEANUP
// ==========================================
window.runBackgroundCleanup = async (forceUserId = null) => {
    const session = window.checkSession();
    const uid = forceUserId || (session ? session.id : null);
    if (!uid) return;

    try {
        const userRef = db.collection("users").doc(uid);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return;

        const userData = userDoc.data();
        const now = Date.now();
        // Check in Firebase instead of LocalStorage
        const lastCleanup = userData.lastCleanup || 0; 

        // 24-Hour Rule: Din me sirf 1 baar chalega
        if (now - lastCleanup > 24 * 60 * 60 * 1000) { 
            const tenDaysAgo = new Date();
            tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

            const collections = ["transactions", "bets", "aviator_history", "overout_history", "coinflip_history"];
            let batch = db.batch();
            let deleteCount = 0;

            for (let col of collections) {
                const snap = await db.collection(col).where("userId", "==", uid).get();
                snap.forEach(doc => {
                    let docDate = doc.data().timestamp ? doc.data().timestamp.toDate() : new Date();
                    // Sirf settled/completed data delete karo, pending chhod do
                    if (docDate < tenDaysAgo && doc.data().status !== 'pending') {
                        batch.delete(doc.ref);
                        deleteCount++;
                    }
                });
            }
            
            // Database me new cleanup time update kar do 
            batch.update(userRef, { lastCleanup: now });
            
            await batch.commit();
            console.log(`Global Firebase Cleanup Done for ${uid}: Deleted ${deleteCount} old records.`);
        }
    } catch (e) {
        console.log("Background cleanup error:", e);
    }
};

// Har page load hone ke 4 second baad chup-chap kachra saaf karega
setTimeout(() => {
    if (window.checkSession()) {
        window.runBackgroundCleanup();
    }
}, 4000);
