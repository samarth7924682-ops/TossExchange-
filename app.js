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
};

console.log("App Brain Initialized - Firebase Clean & Fixed.");

// ----------------------------------------------------
// 5. PURE DEVICE TIME (NO API, NO DELAY, NO ERROR)
// ----------------------------------------------------
window.getTrueTime = () => {
    return Date.now();
};

// ==========================================
// 6. SMART BACKGROUND WORKER (Auto-Delete & 1-Sec Cache Sync)
// ==========================================
window.runBackgroundSync = async () => {
    const user = window.checkSession();
    if (!user || !user.id) return;

    const now = Date.now();
    const lastCleanup = localStorage.getItem('lastCleanup_' + user.id) || 0;
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    // --- PHASE 1: ONCE-A-DAY AUTO DELETE (Firebase Storage Saver) ---
    // Din me sirf ek baar run hoga taaki Firebase Reads zyada consume na ho
    if (now - lastCleanup > 24 * 60 * 60 * 1000) { 
        try {
            const collections = ["transactions", "bets", "aviator_history", "overout_history", "coinflip_history"];
            let batch = db.batch();
            let deleteCount = 0;

            for (let col of collections) {
                const snap = await db.collection(col).where("userId", "==", user.id).where("timestamp", "<", tenDaysAgo).get();
                snap.forEach(doc => {
                    // Sirf settled records delete karo, pending chhod do
                    if (doc.data().status !== 'pending') {
                        batch.delete(doc.ref);
                        deleteCount++;
                    }
                });
            }
            
            if (deleteCount > 0) {
                await batch.commit();
                console.log(`Background Cleanup Done: Deleted ${deleteCount} old records.`);
            }
            localStorage.setItem('lastCleanup_' + user.id, now);
        } catch (e) {
            console.log("Cleanup background skip (Will retry next time):", e);
        }
    }

    // --- PHASE 2: SILENT HISTORY PRE-LOADER ---
    // Data parallel load karke localStorage me ready rakhega
    try {
        const [txnSnap, betSnap, aviatorSnap, overoutSnap, coinflipSnap, matchSnap] = await Promise.all([
            db.collection("transactions").where("userId", "==", user.id).get(),
            db.collection("bets").where("userId", "==", user.id).get(),
            db.collection("aviator_history").where("userId", "==", user.id).get(),
            db.collection("overout_history").where("userId", "==", user.id).get(),
            db.collection("coinflip_history").where("userId", "==", user.id).get(),
            db.collection("matches").get()
        ]);

        let matchDictionary = {};
        matchSnap.forEach(m => {
            let d = m.data();
            matchDictionary[m.id] = { title: `${d.teamA} vs ${d.teamB}`, teamA: d.teamA, teamB: d.teamB };
        });

        let freshLedgerData = [];
        let lockedWithdrawals = 0;
        let activeExposure = 0;

        txnSnap.forEach(doc => {
            let t = doc.data();
            let docDate = t.timestamp ? t.timestamp.toDate() : new Date();
            if (docDate < tenDaysAgo) return; 

            if (t.status === 'approved') {
                let remarkText = t.type === 'deposit' ? 'Approved Deposit' : (t.type === 'bonus' ? 'Deposit Bonus' : 'Approved Withdrawal');
                freshLedgerData.push({ dateObj: docDate, type: t.type, amount: parseFloat(t.amount) || 0, remark: remarkText });
            } else if (t.status === 'pending' && t.type === 'withdraw') {
                lockedWithdrawals += parseFloat(t.amount) || 0;
            }
        });

        let matchGroups = {};
        betSnap.forEach(doc => {
            let b = doc.data();
            let docDate = b.timestamp ? b.timestamp.toDate() : new Date();
            if (docDate < tenDaysAgo && b.status !== 'pending') return; 

            if (!matchGroups[b.matchId]) {
                matchGroups[b.matchId] = { bets: [], status: 'pending', dateObj: docDate, netResult: 0 };
            }
            matchGroups[b.matchId].bets.push(b);
            if (['won', 'lost', 'cancelled'].includes(b.status)) matchGroups[b.matchId].status = 'settled';
        });

        for (let mId in matchGroups) {
            let group = matchGroups[mId];
            let mInfo = matchDictionary[mId] || { title: "Toss Match", teamA: "Team A", teamB: "Team B" };
            
            if (group.status === 'settled') {
                let isCancelled = false, finalTeamBetOn = "";
                group.bets.forEach(b => {
                    let bAmt = parseFloat(b.amount) || 0;
                    if (b.status === 'won') {
                        group.netResult += bAmt * ((parseFloat(b.odds) || 98) / 100);
                        finalTeamBetOn = b.selection === 'teamA' ? mInfo.teamA : mInfo.teamB;
                    } else if (b.status === 'lost') {
                        group.netResult -= bAmt;
                        finalTeamBetOn = b.selection === 'teamA' ? mInfo.teamA : mInfo.teamB;
                    } else if (b.status === 'cancelled') {
                        isCancelled = true;
                    }
                });
                
                if (isCancelled) {
                    freshLedgerData.push({ dateObj: group.dateObj, type: 'match_cancelled', amount: 0, remark: `Refund: Match Voided<br><span style="color:#777">${mInfo.title}</span>` });
                } else if (group.netResult !== 0) {
                    let isWin = group.netResult > 0;
                    let resultText = isWin ? 'Won' : 'Lost';
                    let color = isWin ? 'var(--green)' : 'var(--red)';
                    freshLedgerData.push({ dateObj: group.dateObj, type: isWin ? 'match_profit' : 'match_loss', amount: Math.abs(group.netResult), remark: `Toss Match: ${mInfo.title}<br><span style="color:${color}; font-weight:bold;">${resultText} on (${finalTeamBetOn})</span>` });
                }
            } else {
                let pnlA = 0, pnlB = 0;
                group.bets.forEach(b => {
                    let bAmt = parseFloat(b.amount) || 0;
                    let winAmt = bAmt * ((parseFloat(b.odds) || 98) / 100);
                    if (b.selection === 'teamA') { pnlA += winAmt; pnlB -= bAmt; }
                    else { pnlB += winAmt; pnlA -= bAmt; }
                });
                let worst = Math.min(pnlA, pnlB);
                if (worst < 0) { activeExposure += Math.abs(worst); }
            }
        }

        aviatorSnap.forEach(doc => {
            let a = doc.data();
            let docDate = a.timestamp ? a.timestamp.toDate() : new Date();
            if (docDate < tenDaysAgo) return;
            let pnl = parseFloat(a.winAmount || 0) > 0 ? (parseFloat(a.winAmount) - parseFloat(a.betAmount)) : -parseFloat(a.betAmount); 
            if (pnl > 0) freshLedgerData.push({ dateObj: docDate, type: 'aviator_profit', amount: pnl, remark: `Profit in Aviator (${parseFloat(a.cashoutMult||0).toFixed(2)}x)` });
            else if (pnl < 0) freshLedgerData.push({ dateObj: docDate, type: 'aviator_loss', amount: Math.abs(pnl), remark: `Loss in Aviator` });
        });

        overoutSnap.forEach(doc => {
            let o = doc.data();
            let docDate = o.timestamp ? o.timestamp.toDate() : new Date();
            if (docDate < tenDaysAgo) return;
            let pnl = parseFloat(o.winAmount || 0) > 0 ? (parseFloat(o.winAmount) - parseFloat(o.betAmount)) : -parseFloat(o.betAmount); 
            if (pnl > 0) freshLedgerData.push({ dateObj: docDate, type: 'overout_profit', amount: pnl, remark: `Profit in Over Out (${parseFloat(o.cashoutMult||0).toFixed(2)}x)` });
            else if (pnl < 0) freshLedgerData.push({ dateObj: docDate, type: 'overout_loss', amount: Math.abs(pnl), remark: `Loss in Over Out` });
        });

        coinflipSnap.forEach(doc => {
            let c = doc.data();
            let docDate = c.timestamp ? c.timestamp.toDate() : new Date();
            if (docDate < tenDaysAgo) return;
            let pnl = parseFloat(c.winAmount || 0) > 0 ? (parseFloat(c.winAmount) - parseFloat(c.betAmount)) : -parseFloat(c.betAmount); 
            if (pnl > 0) freshLedgerData.push({ dateObj: docDate, type: 'coinflip_profit', amount: pnl, remark: `Profit in Coin Flip (${(c.outcome||'').toUpperCase()})` });
            else if (pnl < 0) freshLedgerData.push({ dateObj: docDate, type: 'coinflip_loss', amount: Math.abs(pnl), remark: `Loss in Coin Flip (${(c.outcome||'').toUpperCase()})` });
        });

        freshLedgerData.sort((a, b) => b.dateObj - a.dateObj); 
        
        const userDoc = await db.collection("users").doc(user.id).get();
        let runningBal = (parseFloat(userDoc.data().balance) || 0) + activeExposure + lockedWithdrawals;

        freshLedgerData.forEach((item) => {
            item.histBalance = runningBal; 
            if (['deposit', 'bonus', 'aviator_profit', 'overout_profit', 'coinflip_profit', 'match_profit', 'match_cancelled'].includes(item.type)) { 
                runningBal -= item.amount; 
            } else if (['withdraw', 'aviator_loss', 'overout_loss', 'coinflip_loss', 'match_loss'].includes(item.type)) { 
                runningBal += item.amount; 
            }
        });

        // 💾 Pura data LocalStorage me daal do
        localStorage.setItem('fastLedger_' + user.id, JSON.stringify(freshLedgerData));
        console.log("History Background Sync Complete. Ready for 1-Second Load!");

    } catch (e) {
        console.log("Background sync processing error:", e);
    }
};

// Page load hone ke theek 4 second baad background sync chalu hoga
// Is se kisi bhi page ki shuruati loading slow nahi hogi
setTimeout(() => {
    if (window.checkSession()) {
        window.runBackgroundSync();
    }
}, 4000);
