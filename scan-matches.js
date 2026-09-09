// ==========================================================
// scan-matches.js
// Playcode se match-schedule aur winners uthाके Firestore
// "matches" collection ko update karta hai.
// Keys kahin bhi seedha nahi likhi — sab GitHub Secrets se
// environment variables ke through aati hain.
// ==========================================================

require("dotenv").config();
const admin = require("firebase-admin");
const puppeteer = require("puppeteer");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ---------------- SETUP ----------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

const PLAYCODE_USERNAME = process.env.PLAYCODE_USERNAME;
const PLAYCODE_PASSWORD = process.env.PLAYCODE_PASSWORD;
const PLAYCODE_BASE = "https://playcod.in";

// Kitni der tak result-abandoned maanna hai — agar lock-time se itne
// ghante baad bhi Playcode par result na mile, VOID kar denge.
const ABANDONED_HOURS = 8;

// ==========================================================
// 1. HELPER — time ko aage nearest 30-min tak round karna
// ==========================================================
function roundUpToHalfHour(dateObj) {
  const d = new Date(dateObj.getTime());
  const minutes = d.getMinutes();
  if (minutes === 0 || minutes === 30) {
    d.setSeconds(0, 0);
    return d;
  }
  if (minutes < 30) {
    d.setMinutes(30, 0, 0);
  } else {
    d.setHours(d.getHours() + 1);
    d.setMinutes(0, 0, 0);
  }
  return d;
}

// IST date+time string ("09 Sep 2026", "06:10 AM") ko JS Date me badalna
function parsePlaycodeDateTime(dateStr, timeStr) {
  // dateStr jaisa "09 Sep 2026", timeStr jaisa "06:10 AM"
  const combined = `${dateStr} ${timeStr} GMT+0530`;
  const d = new Date(combined);
  if (isNaN(d.getTime())) return null;
  return d;
}

// ==========================================================
// 2. PUPPETEER — Playcode par login karna
// ==========================================================
async function loginToPlaycode(page) {
  console.log("Login ho raha hai...");
  await page.goto(`${PLAYCODE_BASE}/login`, { waitUntil: "networkidle2", timeout: 60000 });

  await page.waitForSelector('input', { timeout: 20000 });

  // Phone/ID field aur password field dhoondna
  const allInputs = await page.$$("input");
  let phoneInput = null, passInput = null;
  for (const inp of allInputs) {
    const type = await page.evaluate(el => el.type, inp);
    if (type === "password") passInput = inp;
    else if (!phoneInput && (type === "tel" || type === "text" || type === "number")) phoneInput = inp;
  }

  if (!phoneInput || !passInput) {
    throw new Error("Login form ke input fields nahi mile — Playcode ka page structure badal gaya lagta hai.");
  }

  await phoneInput.click({ clickCount: 3 });
  await phoneInput.type(PLAYCODE_USERNAME, { delay: 60 });
  await passInput.click({ clickCount: 3 });
  await passInput.type(PLAYCODE_PASSWORD, { delay: 60 });

  // Submit button dhoondna (LOGIN / PLEASE WAIT jaisa likha hua button)
  const buttons = await page.$$("button");
  let loginBtn = null;
  for (const b of buttons) {
    const txt = (await page.evaluate(el => el.innerText, b)).toUpperCase();
    if (txt.includes("LOGIN") || txt.includes("WAIT") || txt.includes("SIGN IN")) { loginBtn = b; break; }
  }
  if (!loginBtn) throw new Error("Login submit button nahi mila.");

  await Promise.all([
    loginBtn.click(),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
  ]);

  await new Promise(r => setTimeout(r, 2500));
  await closeAnyPopup(page);
  console.log("Login complete.");
}

// Login ya home page par kabhi koi info/promo popup aa jaaye to use band karna
async function closeAnyPopup(page) {
  try {
    const closeCandidates = await page.$$("button, [role='button'], span, div");
    for (const el of closeCandidates) {
      const txt = await page.evaluate(node => node.innerText || "", el);
      if (txt.trim() === "✕" || txt.trim() === "×" || txt.trim() === "X" || txt.trim().toLowerCase() === "close") {
        await el.click().catch(() => {});
        await new Promise(r => setTimeout(r, 800));
        break;
      }
    }
  } catch (e) { /* popup na ho to bhi koi issue nahi */ }
}

// Page ko neeche scroll karte rehna jab tak naya content aana band na ho
// (lazy-loaded matches ke liye)
async function scrollToLoadAll(page, maxScrolls = 40) {
  let prevHeight = 0;
  for (let i = 0; i < maxScrolls; i++) {
    const height = await page.evaluate(() => document.body.scrollHeight);
    if (height === prevHeight) break;
    prevHeight = height;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 1200));
  }
}

// ==========================================================
// 3. SCHEDULE (All Tosses) FETCH KARNA
// ==========================================================
async function fetchScheduleText(page) {
  await page.goto(PLAYCODE_BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await closeAnyPopup(page);

  // "All Toss(es)" button dhoondh kar click karna
  const clickables = await page.$$("button, a, div, span");
  let clicked = false;
  for (const el of clickables) {
    const txt = await page.evaluate(node => node.innerText || "", el);
    if (txt.trim().toLowerCase().includes("all toss")) {
      await el.click().catch(() => {});
      clicked = true;
      break;
    }
  }
  if (!clicked) console.log("Warning: 'All Toss' button nahi mila, jo bhi page pe hai wahi padhenge.");

  await new Promise(r => setTimeout(r, 2000));
  await scrollToLoadAll(page);

  const text = await page.evaluate(() => document.body.innerText);
  return text;
}

// Gemini se schedule wala text structure karwana
async function extractScheduleWithGemini(rawText) {
  const prompt = `
Neeche ek cricket betting website ke page ka visible text hai jisme upcoming matches ki list hai.
Har match ke saath do team ke naam, "Date:" aur "Time:" likha hota hai.

Sirf ek JSON array wapas do, koi aur text/explanation ya markdown backticks NAHI.
Har match:
{ "teamA": "...", "teamB": "...", "date": "DD Mon YYYY jaisa mila text bilkul waisa", "time": "HH:MM AM/PM jaisa mila text bilkul waisa" }

Agar koi match adhoora/duplicate lage to usse chhod do.

TEXT:
${rawText.slice(0, 30000)}
`;
  const result = await model.generateContent(prompt);
  let text = result.response.text().trim().replace(/```json/g, "").replace(/```/g, "").trim();
  try { return JSON.parse(text); } catch (e) {
    console.log("Gemini schedule parse error. Raw:", text.slice(0, 500));
    return [];
  }
}

// ==========================================================
// 4. RECENT WINNERS FETCH KARNA (pagination click karke)
// ==========================================================
async function fetchWinnersText(page, maxPages = 10) {
  await page.goto(`${PLAYCODE_BASE}/recent-winners`, { waitUntil: "networkidle2", timeout: 60000 });
  await closeAnyPopup(page);
  await new Promise(r => setTimeout(r, 1500));

  let combinedText = "";

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const pageText = await page.evaluate(() => document.body.innerText);
    combinedText += "\n" + pageText;

    // Agla page-number button dhoondh kar click karna (pageNum + 1)
    const nextPageNum = pageNum + 1;
    const clickables = await page.$$("button, a, div, span");
    let found = false;
    for (const el of clickables) {
      const txt = (await page.evaluate(node => node.innerText || "", el)).trim();
      if (txt === String(nextPageNum)) {
        await el.click().catch(() => {});
        found = true;
        break;
      }
    }
    if (!found) break; // aur pages nahi hain
    await new Promise(r => setTimeout(r, 1800));
  }

  return combinedText;
}

async function extractWinnersWithGemini(rawText) {
  const prompt = `
Neeche ek cricket betting website ke "Recent Winners" page ka visible text hai (kai pages ka data combine kiya hua hai).
Har match ke saath do team names hain, unmein se ek ke "Winner" likha hota hai, aur "Date:" "Time:" bhi hote hain.

Sirf ek JSON array wapas do, koi aur text NAHI, koi markdown backticks NAHI.
{ "teamA": "...", "teamB": "...", "winner": "jo team jeeti uska poora naam", "date": "jaisa mila waisa", "time": "jaisa mila waisa" }

TEXT:
${rawText.slice(0, 60000)}
`;
  const result = await model.generateContent(prompt);
  let text = result.response.text().trim().replace(/```json/g, "").replace(/```/g, "").trim();
  try { return JSON.parse(text); } catch (e) {
    console.log("Gemini winners parse error. Raw:", text.slice(0, 500));
    return [];
  }
}

// ==========================================================
// 5. FIRESTORE — SCHEDULE UPSERT
// ==========================================================
function dateKeyFrom(dateObj) {
  return dateObj.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function upsertSchedule(scheduleMatches) {
  for (const m of scheduleMatches) {
    try {
      const rawTime = parsePlaycodeDateTime(m.date, m.time);
      if (!rawTime) { console.log(`Skip (bad date/time): ${m.teamA} vs ${m.teamB}`); continue; }

      const lockTimeMs = rawTime.getTime();               // Playcode ka exact time = lock time
      const tossTimeMs = roundUpToHalfHour(rawTime).getTime(); // Display ke liye round-up
      const matchDateKey = dateKeyFrom(new Date(tossTimeMs));

      const existingSnap = await db.collection("matches")
        .where("teamA", "==", m.teamA)
        .where("teamB", "==", m.teamB)
        .where("matchDateKey", "==", matchDateKey)
        .limit(1)
        .get();

      const data = {
        teamA: m.teamA,
        teamB: m.teamB,
        matchDateKey,
        tossTimeMs,
        lockTimeMs,
        tossTimeStr: new Date(tossTimeMs).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      };

      if (!existingSnap.empty) {
        const doc = existingSnap.docs[0];
        const existing = doc.data();
        if (existing.status === "open") {
          await db.collection("matches").doc(doc.id).update(data);
          console.log(`Updated: ${m.teamA} vs ${m.teamB} — toss ${data.tossTimeStr}`);
        }
      } else {
        data.oddsA = "98"; data.oddsB = "98";
        data.status = "open";
        data.reminderSent = false;
        data.tossTimeAlertSent = false;
        data.timestamp = admin.firestore.FieldValue.serverTimestamp();
        await db.collection("matches").add(data);
        console.log(`Created: ${m.teamA} vs ${m.teamB} — toss ${data.tossTimeStr}`);
      }
    } catch (e) {
      console.log(`Error on schedule ${m.teamA} vs ${m.teamB}:`, e.message);
    }
  }
}

// ==========================================================
// 6. FIRESTORE — WINNERS PROCESS KARNA (settle / void)
// ==========================================================
async function processWinners(winnerMatches) {
  const now = Date.now();

  for (const w of winnerMatches) {
    try {
      const openSnap = await db.collection("matches")
        .where("teamA", "==", w.teamA)
        .where("teamB", "==", w.teamB)
        .where("status", "==", "open")
        .limit(1)
        .get();

      if (openSnap.empty) continue; // ye match hamare paas open nahi hai, skip

      const doc = openSnap.docs[0];
      const matchData = doc.data();

      if (now < matchData.lockTimeMs) {
        console.log(`VOID (result lock-time se pehle aaya): ${w.teamA} vs ${w.teamB}`);
        await voidMatch(doc.id);
      } else {
        console.log(`Settling: ${w.teamA} vs ${w.teamB} — Winner: ${w.winner}`);
        await settleMatch(doc.id, matchData, w.winner);
      }
    } catch (e) {
      console.log(`Error on winner ${w.teamA} vs ${w.teamB}:`, e.message);
    }
  }
}

// Overdue matches jinka result kabhi nahi mila (barish/abandoned) — inhe void karna
async function processAbandoned() {
  const cutoff = Date.now() - ABANDONED_HOURS * 60 * 60 * 1000;
  const overdueSnap = await db.collection("matches")
    .where("status", "==", "open")
    .where("lockTimeMs", "<", cutoff)
    .get();

  for (const doc of overdueSnap.docs) {
    const m = doc.data();
    console.log(`VOID (abandoned/overdue, no result mila): ${m.teamA} vs ${m.teamB}`);
    await voidMatch(doc.id);
  }
}

// ==========================================================
// 7. SETTLE (winner set) LOGIC
// ==========================================================
async function settleMatch(matchDocId, matchData, winnerNameRaw) {
  const winnerName = winnerNameRaw.trim();
  const winnerCode = winnerName.toLowerCase() === matchData.teamA.toLowerCase() ? "teamA" : "teamB";

  const betsSnap = await db.collection("bets").where("matchId", "==", matchDocId).where("status", "==", "pending").get();
  if (betsSnap.empty) {
    await db.collection("matches").doc(matchDocId).update({ status: "closed", winner: winnerName, settledAt: admin.firestore.FieldValue.serverTimestamp() });
    return;
  }

  const batch = db.batch();
  let userBets = {};
  betsSnap.forEach(doc => {
    const b = doc.data();
    if (!userBets[b.userId]) userBets[b.userId] = [];
    userBets[b.userId].push({ id: doc.id, ...b });
  });

  for (const userId in userBets) {
    let payout = 0;
    userBets[userId].forEach(b => { if (b.selection === winnerCode) payout += b.amount * ((parseFloat(b.odds) || 98) / 100); });
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    let newBal = null;
    if (userDoc.exists) {
      const curBal = parseFloat(userDoc.data().balance || 0);
      newBal = curBal + payout;
      if (payout !== 0) batch.update(userRef, { balance: admin.firestore.FieldValue.increment(payout) });
    }
    userBets[userId].forEach(b => {
      const status = b.selection === winnerCode ? "won" : "lost";
      const upd = { status };
      if (newBal !== null) upd.balanceSnapshot = newBal;
      batch.update(db.collection("bets").doc(b.id), upd);
    });
  }

  batch.update(db.collection("matches").doc(matchDocId), { status: "closed", winner: winnerName, settledAt: admin.firestore.FieldValue.serverTimestamp() });
  await batch.commit();
}

// ==========================================================
// 8. VOID LOGIC
// ==========================================================
async function voidMatch(matchDocId) {
  const betsSnap = await db.collection("bets").where("matchId", "==", matchDocId).where("status", "==", "pending").get();
  if (betsSnap.empty) {
    await db.collection("matches").doc(matchDocId).update({ status: "cancelled", settledAt: admin.firestore.FieldValue.serverTimestamp() });
    return;
  }
  const batch = db.batch();
  let userBets = {};
  betsSnap.forEach(doc => {
    const b = doc.data();
    if (!userBets[b.userId]) userBets[b.userId] = { bets: [], pnlA: 0, pnlB: 0 };
    userBets[b.userId].bets.push({ id: doc.id, ...b });
    const winAmt = b.amount * ((parseFloat(b.odds) || 98) / 100);
    if (b.selection === "teamA") { userBets[b.userId].pnlA += winAmt; userBets[b.userId].pnlB -= b.amount; }
    else { userBets[b.userId].pnlB += winAmt; userBets[b.userId].pnlA -= b.amount; }
  });
  for (const userId in userBets) {
    const worstCase = Math.min(userBets[userId].pnlA, userBets[userId].pnlB);
    const lockedExposure = worstCase < 0 ? Math.abs(worstCase) : 0;
    if (lockedExposure > 0) {
      const userRef = db.collection("users").doc(userId);
      const userDoc = await userRef.get();
      if (userDoc.exists) batch.update(userRef, { balance: admin.firestore.FieldValue.increment(lockedExposure) });
    }
    userBets[userId].bets.forEach(b => batch.update(db.collection("bets").doc(b.id), { status: "cancelled" }));
  }
  batch.update(db.collection("matches").doc(matchDocId), { status: "cancelled", settledAt: admin.firestore.FieldValue.serverTimestamp() });
  await batch.commit();
}

// ==========================================================
// MAIN
// ==========================================================
async function main() {
  console.log("=== Scan shuru ===", new Date().toISOString());
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    await page.setViewport({ width: 1280, height: 900 });

    await loginToPlaycode(page);

    console.log("Schedule fetch ho raha hai...");
    const scheduleText = await fetchScheduleText(page);
    const scheduleMatches = await extractScheduleWithGemini(scheduleText);
    console.log(`${scheduleMatches.length} schedule matches mile.`);
    await upsertSchedule(scheduleMatches);

    console.log("Winners fetch ho rahe hain...");
    const winnersText = await fetchWinnersText(page);
    const winnerMatches = await extractWinnersWithGemini(winnersText);
    console.log(`${winnerMatches.length} winners mile.`);
    await processWinners(winnerMatches);

    console.log("Abandoned/overdue matches check ho rahe hain...");
    await processAbandoned();

    console.log("=== Scan complete ===");
  } finally {
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error("FATAL ERROR:", e); process.exit(1); });
  
