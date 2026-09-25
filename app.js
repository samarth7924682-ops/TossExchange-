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

// 👇 OFFLINE PERSISTENCE — baar-baar same data padhne se bachata hai (local cache use karta hai)
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code === 'failed-precondition') {
        console.log('Persistence failed: multiple tabs open at once, sirf ek tab me hi persistence chalta hai.');
    } else if (err.code === 'unimplemented') {
        console.log('Persistence failed: is browser me offline support nahi hai.');
    } else {
        console.log('Persistence error:', err);
    }
});

// Global constants
window.db = db; 

// 🔍 TEMPORARY DEBUG TRACKER — sirf reads pakadne ke liye, baad me hata denge
(function() {
    try {
        const QueryProto = Object.getPrototypeOf(db.collection('_debug_probe_'));
        const origGet = QueryProto.get;
        const origOnSnapshot = QueryProto.onSnapshot;

        QueryProto.get = function(...args) {
            const line = new Error().stack.split('\n')[2] || '(unknown)';
            console.log('📖 GET —', line.trim());
            return origGet.apply(this, args);
        };
        QueryProto.onSnapshot = function(...args) {
            const line = new Error().stack.split('\n')[2] || '(unknown)';
            console.log('👂 LISTEN ATTACHED —', line.trim());
            return origOnSnapshot.apply(this, args);
        };
    } catch(e) { console.log('Debug tracker failed:', e); }
})();

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

// 4. TELEGRAM NOTIFICATION — SIRF DEPOSIT / WITHDRAWAL
// Persistent queue: jab tak message Telegram par chala nahi jata, background me baar-baar
// bhejta rahega. Page band/reload ho jaye tab bhi queue localStorage me bachi rehti hai aur
// agli baar koi bhi page khulte hi wahin se dobara bhejna shuru ho jata hai.
const TG_QUEUE_KEY = 'telegramQueue_v1';
const TG_TAB_ID = Math.random().toString(36).slice(2);
window._tgWaiters = window._tgWaiters || {};

function tgReadQueue() {
    try { return JSON.parse(localStorage.getItem(TG_QUEUE_KEY) || '[]'); } catch (e) { return []; }
}
function tgWriteQueue(q) {
    try { localStorage.setItem(TG_QUEUE_KEY, JSON.stringify(q)); } catch (e) {}
}
function tgUpdate(id, patch) {
    tgWriteQueue(tgReadQueue().map(e => e.id === id ? Object.assign({}, e, patch) : e));
}
function tgFinish(id, ok) {
    tgWriteQueue(tgReadQueue().filter(e => e.id !== id));
    const w = window._tgWaiters[id];
    if (w) { delete window._tgWaiters[id]; w(ok); }
}

// Ek attempt: 'sent' (chali gayi) | 'drop' (kabhi nahi jayegi, config galat) | 'retry' (dobara koshish)
async function tgTrySend(entry) {
    try {
        // Admin ka bot token/chatId ek baar padho, phir memory se — retry par dobara Firebase read nahi hoga
        window._tgAdminCache = window._tgAdminCache || {};
        let data = window._tgAdminCache[entry.subAdminId];
        if (!data) {
            const adminDoc = await db.collection("admins").doc(entry.subAdminId).get();
            if (!adminDoc.exists) return 'drop';
            data = adminDoc.data();
            window._tgAdminCache[entry.subAdminId] = data;
        }
        const botToken = data.botToken;
        const chatId = data.chatId;
        if (!botToken || !chatId) {
            console.log("Telegram details missing for SubAdmin");
            return 'drop';
        }

        const text = entry.plain
            ? `🔔 New Transaction Request!\n\n👤 User: ${entry.userName}\n📌 Type: ${entry.type}\n💰 Amount: ₹${entry.amount}\n\n👉 Check your panel to process.`
            : `🔔 *New Transaction Request!*\n\n` +
              `👤 *User:* ${entry.userName}\n` +
              `📌 *Type:* ${entry.type}\n` +
              `💰 *Amount:* ₹${entry.amount}\n\n` +
              `👉 Check your panel to process.`;

        const payload = { chat_id: chatId, text: text };
        if (!entry.plain) payload.parse_mode = "Markdown";

        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) return 'sent';

        console.warn(`Telegram send failed: HTTP ${response.status}`);
        // Username me _ * jaise characters se Markdown fail ho sakta hai -> plain text me dobara bhejo
        if (response.status === 400 && !entry.plain) { tgUpdate(entry.id, { plain: true }); return 'retry'; }
        if ([400, 401, 403, 404].includes(response.status)) return 'drop'; // token/chat galat — retry se fayda nahi
        return 'retry'; // 429, 5xx etc — dobara try
    } catch (e) {
        console.warn("Telegram fetch error:", e);
        return 'retry'; // net/network issue — dobara try
    }
}

window.processTelegramQueue = async function() {
    if (window._tgBusy) { window._tgAgain = true; return; }
    window._tgBusy = true;
    try {
        const now = Date.now();
        for (const item of tgReadQueue()) {
            if ((item.nextTry || 0) > now || (item.lock || 0) > now) continue;

            // Dusre tab se duplicate na jaye — pehle claim karo
            tgUpdate(item.id, { lock: now + 30000, owner: TG_TAB_ID });
            const fresh = tgReadQueue().find(e => e.id === item.id);
            if (!fresh || fresh.owner !== TG_TAB_ID) continue;

            const res = await tgTrySend(fresh);
            if (res === 'sent') {
                console.log(`Telegram notification sent (attempts: ${(fresh.attempts || 0) + 1})`);
                tgFinish(item.id, true);
            } else if (res === 'drop') {
                tgFinish(item.id, false);
            } else {
                const n = (fresh.attempts || 0) + 1;
                const wait = Math.min(2000 * Math.pow(1.5, n - 1), 30000);
                tgUpdate(item.id, { attempts: n, lock: 0, nextTry: Date.now() + wait });
            }
        }
    } finally {
        window._tgBusy = false;
        if (window._tgAgain) { window._tgAgain = false; setTimeout(window.processTelegramQueue, 0); }
    }
};

// Sirf deposit/withdrawal ki notification. Promise tab resolve hota hai jab message
// Telegram par chala jaye (true) — agar caller `await` karta hai toh submit tab complete hoga.
window.sendTelegramNotification = (subAdminId, type, userName, amount) => {
    const t = String(type || '').toLowerCase();
    if (!t.includes('deposit') && !t.includes('withdraw')) return Promise.resolve(false);

    const id = 'tg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const q = tgReadQueue();
    q.push({ id: id, subAdminId: subAdminId, type: type, userName: userName, amount: amount, ts: Date.now(), attempts: 0, nextTry: 0, lock: 0 });
    tgWriteQueue(q);

    const p = new Promise(resolve => { window._tgWaiters[id] = resolve; });
    window.processTelegramQueue();
    return p;
};

// Background retry: page khulte hi, har 5 sec, aur net wapas aate hi
setTimeout(() => window.processTelegramQueue(), 2000);
setInterval(() => window.processTelegramQueue(), 5000);
window.addEventListener('online', () => window.processTelegramQueue());

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

    // Har page load par user doc na padhna pade — 6 ghante me sirf ek baar check
    const checkKey = 'lastCleanupCheck_' + uid;
    if (Date.now() - parseInt(localStorage.getItem(checkKey) || '0') < 6 * 60 * 60 * 1000) return;
    localStorage.setItem(checkKey, String(Date.now()));

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
               const snap = await db.collection(col)
                    .where("userId", "==", uid)
                    .where("timestamp", "<=", firebase.firestore.Timestamp.fromDate(tenDaysAgo))
                    .get();
                snap.forEach(doc => {
                    // Sirf settled/completed data delete karo, pending chhod do
                    if (doc.data().status !== 'pending') {
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

// ==========================================
// 6. GLOBAL PENDING COINFLIP BET RECOVERY
// Agar coinflip me bet place karke tab/app band kar diya ho result aane se pehle,
// toh ye check kisi bhi page (history.html sameत) khulte hi turant settle kar dega —
// taaki balance kabhi bhi bina kisi ledger entry ke gayab na rahe.
// ==========================================
const COINFLIP_CYCLE_TIME = 15000;

// Recovery lock — same tab ya dusre tab me ek hi baar settle ho, aur fail hone par retry ho
window._recBusy = window._recBusy || {};
function recoveryStart(key) {
    if (window._recBusy[key]) return null;
    const st = localStorage.getItem(key) || '';
    if (st && st !== 'paid' && st !== 'retry' && !st.startsWith('busy:')) return 'done';
    if (st.startsWith('busy:') && Date.now() - parseInt(st.slice(5)) < 60000) return null;
    window._recBusy[key] = true;
    if (st !== 'paid') localStorage.setItem(key, 'busy:' + Date.now());
    return st;
}
function recoveryEnd(key, state) {
    delete window._recBusy[key];
    localStorage.setItem(key, state);
}

async function coinflipFetchRoundResult(roundId, isDemo) {
    let chaos1 = Math.sin(roundId * 12.9898 + 78.233) * 43758.5453;
    let randVal1 = chaos1 - Math.floor(chaos1);
    let chaos2 = Math.sin(roundId * 93.234 + 12.345) * 55555.5555;
    let randVal2 = chaos2 - Math.floor(chaos2);
    const isRigged = (randVal1 * 100) < 30;

    if (!isRigged || isDemo) {
        return (randVal2 < 0.5) ? 'heads' : 'tails';
    }
    try {
        const doc = await db.collection("round_bets").doc(roundId.toString()).get();
        let headsTotal = doc.exists ? (doc.data().heads || 0) : 0;
        let tailsTotal = doc.exists ? (doc.data().tails || 0) : 0;
        if (headsTotal > tailsTotal) return 'tails';
        if (tailsTotal > headsTotal) return 'heads';
        return (randVal2 < 0.5) ? 'heads' : 'tails';
    } catch (e) {
        return (randVal2 < 0.5) ? 'heads' : 'tails';
    }
}

window.recoverPendingCoinflipBet = async function() {
    const session = window.checkSession();
    if (!session) return;

    const pendingKey = `pendingCoinflipBet_${session.id}`;
    const pendingRaw = localStorage.getItem(pendingKey);
    if (!pendingRaw) return;

    const pending = JSON.parse(pendingRaw);
    const nowRoundId = Math.floor(Date.now() / COINFLIP_CYCLE_TIME);
    if (Date.now() < (pending.roundId + 1) * COINFLIP_CYCLE_TIME + 10000) return; // round live ya abhi khatam — coinflip.html ko 10 sec do

    const settledKey = `settledCoinflipRound_${session.id}_${pending.roundId}`;
    const st = recoveryStart(settledKey);
    if (st === null) return;
    if (st === 'done') { localStorage.removeItem(pendingKey); return; }
    let paid = (st === 'paid');

    try {
        const outcome = await coinflipFetchRoundResult(pending.roundId, session.isDemo);
        const won = pending.side === outcome;
        const winAmount = won ? (pending.amount * 2) : 0;

        if (won && !paid) {
            if (session.isDemo) {
                const freshSession = window.checkSession();
                freshSession.balance = parseFloat(freshSession.balance || 0) + winAmount;
                localStorage.setItem('userSession', JSON.stringify(freshSession));
            } else {
                await db.collection("users").doc(session.id).update({ balance: firebase.firestore.FieldValue.increment(winAmount) });
            }
            paid = true;
            localStorage.setItem(settledKey, 'paid');
        }

        if (!session.isDemo) {
            await db.collection("coinflip_history").add({
                userId: session.id, betAmount: pending.amount, winAmount: winAmount,
                sidePicked: pending.side, outcome: outcome, timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        recoveryEnd(settledKey, 'done');
        localStorage.removeItem(pendingKey);
    } catch (e) {
        console.log("Coinflip recovery error:", e);
        recoveryEnd(settledKey, paid ? 'paid' : 'retry'); // pending rahegi, dobara try hoga
    }
};

// Har 4 second me check karo (page load par bhi turant chalega)
setInterval(() => {
    window.recoverPendingCoinflipBet();
}, 4000);

// ==========================================
// 7. GLOBAL PENDING LOST CHICKEN (EGG) BET RECOVERY
// Coin Flip jaisa hi system — agar chicken game me bet place karke tab/app
// band kar diya ho result aane se pehle, toh koi bhi page (history.html sameत)
// khulte hi turant settle ho jayega.
// ==========================================
const CHICKEN_CYCLE_TIME = 30000;

function chickenGetDeterministicOutcome(roundIdNum) {
    let x = roundIdNum ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = x ^ (x >>> 16);
    return (x & 1) === 0 ? 'LEFT' : 'RIGHT';
}

function chickenGetDeterministicRoll(roundIdNum) {
    let x = roundIdNum ^ 0x2545F491;
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x = x ^ (x >>> 16);
    return Math.abs(x) % 100;
}

function chickenGetRoundDisplayId(roundIdNum) {
    return String((Math.abs(roundIdNum * 2654435761) % 900000) + 100000);
}

async function chickenFetchRoundOutcome(roundIdStr) {
    const roundIdNum = parseInt(roundIdStr);
    let outcome = chickenGetDeterministicOutcome(roundIdNum);
    try {
        const snap = await db.collection("round_bets").doc(roundIdStr).get();
        const data = snap.exists ? snap.data() : {};
        if (data.forcedResult) {
            outcome = data.forcedResult;
        } else if (chickenGetDeterministicRoll(roundIdNum) < 30) {
            let leftLoad = data.LEFT || 0; let rightLoad = data.RIGHT || 0;
            if (leftLoad > rightLoad) outcome = 'RIGHT'; else if (rightLoad > leftLoad) outcome = 'LEFT';
        }
    } catch (e) {}
    return outcome;
}

window.recoverPendingChickenBet = async function() {
    const session = window.checkSession();
    if (!session) return;

    const pendingKey = `pendingBet_${session.id}`;
    const pendingRaw = localStorage.getItem(pendingKey);
    if (!pendingRaw) return;

    const pending = JSON.parse(pendingRaw);
    const nowRoundId = Math.floor(Date.now() / CHICKEN_CYCLE_TIME);
    if (Date.now() < (parseInt(pending.roundId) + 1) * CHICKEN_CYCLE_TIME + 10000) return; // round live ya abhi khatam — game.html ko 10 sec do

    const settledKey = `settledRound_${session.id}_${pending.roundId}`;
    const st = recoveryStart(settledKey);
    if (st === null) return;
    if (st === 'done') { localStorage.removeItem(pendingKey); return; }
    let paid = (st === 'paid');

    try {
        const outcome = await chickenFetchRoundOutcome(pending.roundId);
        const won = pending.side === outcome;
        const winAmt = won ? pending.amount * 1.9 : 0;

        if (won && !paid) {
            if (session.isDemo) {
                const freshSession = window.checkSession();
                freshSession.balance = parseFloat(freshSession.balance || 0) + winAmt;
                localStorage.setItem('userSession', JSON.stringify(freshSession));
            } else {
                await db.collection("users").doc(session.id).update({ balance: firebase.firestore.FieldValue.increment(winAmt) });
            }
            paid = true;
            localStorage.setItem(settledKey, 'paid');
        }

        if (!session.isDemo) {
            await db.collection("chicken_history").add({
                userId: session.id, betAmount: pending.amount, winAmount: winAmt,
                selectedSide: pending.side, timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        }

        // game.html ke "Your Bet History (Last 5)" panel ke liye local record
        const profitStr = won ? `+₹${(pending.amount * 0.9).toFixed(2)}` : `-₹${pending.amount.toFixed(2)}`;
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const histKey = `chicken_history_${session.id}`;
        let hist = JSON.parse(localStorage.getItem(histKey) || '[]');
        hist.unshift({ amount: pending.amount, side: pending.side, result: won ? 'WIN' : 'LOSS', profit: profitStr, time: timeStr, roundDisplayId: chickenGetRoundDisplayId(parseInt(pending.roundId)) });
        hist = hist.slice(0, 5);
        localStorage.setItem(histKey, JSON.stringify(hist));

        recoveryEnd(settledKey, 'done');
        localStorage.removeItem(pendingKey);
    } catch (e) {
        console.log("Chicken recovery error:", e);
        recoveryEnd(settledKey, paid ? 'paid' : 'retry'); // pending rahegi, dobara try hoga
    }
};

setInterval(() => {
    window.recoverPendingChickenBet();
}, 4000);
// ==========================================
// 8. GLOBAL PENDING SIXER (AVIATOR) BET RECOVERY
// Agar sixer me bet lock hone ke baad (TAKEOFF phase) tab/app band ho gaya ho
// result aane se pehle, toh koi bhi page (history.html samet) khulte hi turant
// settle ho jayega. Round crash hote waqt user active nahi tha, isliye cashout
// possible nahi tha — hamesha loss maana jaata hai.
// ==========================================
window.recoverPendingSixerBet = async function() {
    const session = window.checkSession();
    if (!session) return;

    const pendingRaw = localStorage.getItem('pendingSixerBet');
    if (!pendingRaw) return;

    const pending = JSON.parse(pendingRaw);
    if (!pending.timestamp || (Date.now() - pending.timestamp) < 40000) return; // round abhi khatam nahi hua hoga — sixer.html khud handle karega

    const settledKey = `settledSixerBet_${pending.timestamp}`;
    const st = recoveryStart(settledKey);
    if (st === null) return;
    if (st === 'done') { localStorage.removeItem('pendingSixerBet'); return; }

    try {
        if (!session.isDemo) {
            await db.collection("aviator_history").add({
                userId: session.id, betAmount: pending.betAmount, cashoutMult: 0, winAmount: 0,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        recoveryEnd(settledKey, 'done');
        localStorage.removeItem('pendingSixerBet');
    } catch (e) {
        console.log("Sixer recovery error:", e);
        recoveryEnd(settledKey, 'retry'); // pending rahegi, dobara try hoga
    }
};

setInterval(() => {
    window.recoverPendingSixerBet();
}, 4000);

// ==========================================
// 9. GLOBAL PENDING OVER OUT BET RECOVERY
// Over Out me bet start hote hi kat jati hai. Round beech me chhoda (app/tab band)
// toh heartbeat 60 sec se purana ho jata hai -> loss entry history me chhap jati hai.
// ==========================================
window.recoverPendingOveroutBet = async function(force) {
    const session = window.checkSession();
    if (!session || session.isDemo) return;

    const pendingKey = `pendingOveroutBet_${session.id}`;
    const pendingRaw = localStorage.getItem(pendingKey);
    if (!pendingRaw) return;

    const pending = JSON.parse(pendingRaw);
    if (!force && (Date.now() - (pending.beat || pending.ts || 0)) < 60000) return; // round abhi live hai

    const settledKey = `settledOveroutBet_${session.id}_${pending.ts}`;
    const st = recoveryStart(settledKey);
    if (st === null) return;
    if (st === 'done') { localStorage.removeItem(pendingKey); return; }

    try {
        await db.collection("overout_history").add({
            userId: session.id, betAmount: pending.amount, cashoutMult: 0, winAmount: 0,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        recoveryEnd(settledKey, 'done');
        localStorage.removeItem(pendingKey);
    } catch (e) {
        console.log("Over Out recovery error:", e);
        recoveryEnd(settledKey, 'retry');
    }
};

setInterval(() => {
    window.recoverPendingOveroutBet();
}, 4000);
