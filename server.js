require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { chromium } = require('playwright');
const path = require("path");
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
db.settings({ databaseId: 'sagarattendance' });
console.log("🔥 Firebase DB 'sagarattendance' Connected!");

const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:admin@sagarattendance.com', 
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const app = express();
const PORT = process.env.PORT || 8080; 
const MASTER_USER = process.env.MASTER_USER;
const MASTER_PASS = process.env.MASTER_PASS;

app.use(cors());
app.use(express.json());

app.get('/sw.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'sw.js'), {
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Expires': '0' }
    });
});

app.use(express.static(path.join(__dirname, "templates")));

let browser;
let context;
let pageYest;
let pageToday;
let pageOverall; 
let isProcessing = false;
let isInitializing = false; 
const requestQueue = []; 
const ATTENDANCE_URL = "https://info.aec.edu.in/acet/Academics/StudentAttendance.aspx?scrid=3&showtype=SA";

function getTimestamp() {
    return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit', fractionalSecondDigits: 3 });
}

function toTitleCase(str) {
    if (!str) return "";
    return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

function parseAttendance(htmlStr) {
    if (!htmlStr) return { subjects: {}, totalHeld: 0, totalAtt: 0 };
    const rowRegex = /<tr[^>]*>\s*<td[^>]*>\s*\d+\s*<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>\s*<td[^>]*>\s*(\d+)\s*<\/td>/gi;
    const matches = [...htmlStr.matchAll(rowRegex)];
    
    let data = { subjects: {}, totalHeld: 0, totalAtt: 0 };
    matches.forEach(match => {
        let subject = match[1].replace(/<[^>]*>?/gm, '').trim();
        subject = subject.split('-')[0].trim(); 
        
        let held = parseInt(match[2]) || 0;
        let att = parseInt(match[3]) || 0;
        
        if (held > 0) {
            data.subjects[subject] = { held, att };
            data.totalHeld += held;
            data.totalAtt += att;
        }
    });
    return data;
}

function getOverallPercentage(htmlStr) {
    const parsed = parseAttendance(htmlStr);
    if (parsed.totalHeld === 0) return "0.00";
    return ((parsed.totalAtt / parsed.totalHeld) * 100).toFixed(2);
}

function generatePushMessage(studentName, oldDaily, newDaily, overallPct) {
    if (newDaily.totalHeld >= 7 && oldDaily.totalHeld !== newDaily.totalHeld) {
        return `Hi ${studentName}, you got ${newDaily.totalAtt}/${newDaily.totalHeld} Hours present for Today and your overal percentage is ${overallPct}%`;
    } else if (oldDaily.totalHeld === 0 && Object.keys(newDaily.subjects).length > 1) {
        return `Hi ${studentName}, you got ${newDaily.totalAtt}/${newDaily.totalHeld} Hours present so far Today.`;
    } else {
        let changedSubject = null;
        let diffHeld = 0;
        let diffAtt = 0;

        for (const [subj, stats] of Object.entries(newDaily.subjects)) {
            const oldStats = oldDaily.subjects[subj] || { held: 0, att: 0 };
            if (stats.held !== oldStats.held || stats.att !== oldStats.att) {
                changedSubject = subj;
                diffHeld = stats.held - oldStats.held;
                diffAtt = stats.att - oldStats.att;
                break;
            }
        }

        if (changedSubject) {
            if (diffAtt > 0) {
                const hrText = diffAtt === 1 ? 'Hour' : 'Hours';
                return `Hi ${studentName}, you got ${diffAtt} ${hrText} present for ${changedSubject} Class overall Today`;
            } else {
                let absHours = diffHeld > 0 ? diffHeld : Math.abs(diffAtt);
                const hrText = absHours === 1 ? 'Hour' : 'Hours';
                return `Hi ${studentName}, you got ${absHours} ${hrText} absent for ${changedSubject} Class overall Today`;
            }
        }
    }
    return null;
}

async function initializeSession() {
    if (isInitializing) {
        while (isInitializing) await new Promise(r => setTimeout(r, 500));
        return true;
    }

    isInitializing = true;
    try {
        console.log(`[${getTimestamp()}] 🔄 Initializing 3-Tab Session...`);
        if (browser) await browser.close();

        browser = await chromium.launch({ 
            timeout: 60000,
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] 
        });

        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        
        await context.route('**/*.{png,jpg,jpeg,gif,css,woff,woff2,svg,ico}', route => route.abort());

        pageOverall = await context.newPage();

        console.log(`[${getTimestamp()}] 🔐 Logging in...`);
        await pageOverall.goto("https://info.aec.edu.in/acet/default.aspx", { timeout: 60000, waitUntil: 'domcontentloaded' });
        await pageOverall.waitForSelector("#txtId3", { state: 'visible', timeout: 45000 });

        await pageOverall.evaluate((creds) => {
            var user = document.querySelector("#txtId3");
            user.value = creds.user;
            user.dispatchEvent(new Event('input', { bubbles: true }));
            user.dispatchEvent(new Event('change', { bubbles: true }));
            user.blur();

            var pass = document.querySelector("#txtPwd3");
            pass.value = "";
            var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            nativeInputValueSetter.call(pass, creds.pass);
            
            pass.dispatchEvent(new Event('input', { bubbles: true }));
            pass.dispatchEvent(new Event('keyup', { bubbles: true }));
            pass.dispatchEvent(new Event('change', { bubbles: true }));
            pass.blur();
        }, { user: MASTER_USER, pass: MASTER_PASS });
        
        await Promise.all([
            pageOverall.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => console.log(`[${getTimestamp()}] ⚠️ Navigation wait ignored, proceeding...`)),
            pageOverall.click("#imgBtn3")
        ]);

        console.log(`[${getTimestamp()}] 📂 Cloning Parallel Tabs...`);
        pageYest = await context.newPage();
        pageToday = await context.newPage();

        await Promise.all([
            pageOverall.goto(ATTENDANCE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }),
            pageYest.goto(ATTENDANCE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }),
            pageToday.goto(ATTENDANCE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
        ]);
        
        await Promise.all([
            pageOverall.waitForSelector("#txtRollNo", { state: 'visible', timeout: 45000 }),
            pageYest.waitForSelector("#txtRollNo", { state: 'visible', timeout: 45000 }),
            pageToday.waitForSelector("#txtRollNo", { state: 'visible', timeout: 45000 })
        ]);

        console.log(`[${getTimestamp()}] ✅ 3-Tab Session Ready.`);
        return true;

    } catch (err) {
        console.error(`[${getTimestamp()}] ❌ Init Failed:`, err.message);
        return false;
    } finally {
        isInitializing = false; 
    }
}

async function scrapePopup(sourcePage) {
    let printPage = null;
    try {
        sourcePage.once('dialog', dialog => dialog.accept().catch(() => {}));
        await sourcePage.waitForSelector('input[value="Print"]', { state: 'visible', timeout: 3000 });

        [printPage] = await Promise.all([
            sourcePage.waitForEvent('popup', { timeout: 3000 }),
            sourcePage.click('input[value="Print"]') 
        ]);

        await printPage.waitForSelector("#divReport", { timeout: 15000 });
        
        await printPage.waitForFunction(() => {
            const el = document.querySelector("#divReport");
            return el && el.innerHTML.trim().length > 10;
        }, { timeout: 5000 }).catch(() => console.log(`[${getTimestamp()}] divReport empty timeout`));

        const html = await printPage.evaluate(() => document.querySelector("#divReport").innerHTML);
        return html;
    } catch (e) {
        return null; 
    } finally {
        if (printPage) await printPage.close();
    }
}

async function processQueue() {
    if (isProcessing || requestQueue.length === 0) return;

    isProcessing = true;
    const { rollNo, resolve, reject } = requestQueue.shift();
    const startTime = Date.now(); 

    try {
        console.log(`\n[${getTimestamp()}] ▶️ Fetching (PARALLEL): ${rollNo}`);

        if (isInitializing) {
            while (isInitializing) await new Promise(r => setTimeout(r, 500));
        }

        if (!pageOverall || pageOverall.isClosed() || !pageYest || pageYest.isClosed() || !pageToday || pageToday.isClosed()) {
            await initializeSession();
        } else {
            try {
                if (pageOverall.url().includes('default.aspx')) {
                    await initializeSession();
                }
            } catch (e) {
                await initializeSession();
            }
        }

        const now = new Date();
        const yest = new Date(now); yest.setDate(yest.getDate() - 1);
        const yestStr = yest.toLocaleDateString('en-GB'); 
        const todayStr = now.toLocaleDateString('en-GB');

        const runTabTask = async (tabObject, taskType, dateStr = null) => {
            await tabObject.waitForSelector("#txtRollNo", { state: 'visible', timeout: 45000 });
            
            await tabObject.evaluate((r) => {
                var el = document.querySelector("#txtRollNo");
                el.value = r;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, rollNo);

            if (taskType === 'overall') {
                await tabObject.click("#radTillNow", { timeout: 10000 });
                await tabObject.click("#btnShow", { timeout: 10000 });
            } else {
                await tabObject.click("#radPeriod", { timeout: 10000 });
                await tabObject.evaluate((d) => {
                    document.querySelector("#txtFromDate").value = d;
                    document.querySelector("#txtToDate").value = d;
                }, dateStr);
                await tabObject.click("#btnShow", { timeout: 10000 });
            }

            try { await tabObject.waitForSelector("#divprocess", { state: 'visible', timeout: 500 }); } catch(e){}
            await tabObject.waitForSelector("#divprocess", { state: 'hidden', timeout: 15000 });
            
            const html = await scrapePopup(tabObject);
            await tabObject.evaluate(() => document.querySelector("#txtRollNo").value = "");
            return html;
        };

        const [yesterdayHtml, dailyHtml, overallHtml] = await Promise.all([
            runTabTask(pageYest, 'yest', yestStr),
            runTabTask(pageToday, 'today', todayStr),
            runTabTask(pageOverall, 'overall')
        ]);

        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[${getTimestamp()}] ✅ Done: ${rollNo} ⏱️ Took ${timeTaken} seconds`);
        
        resolve({ yesterdayHtml, dailyHtml, overallHtml });

    } catch (err) {
        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`[${getTimestamp()}] ❌ Error on ${rollNo} after ${timeTaken}s:`, err.message);
        
        if (!isInitializing) {
            initializeSession().catch(()=>console.log("Background re-init failed")); 
        }
        reject(err);
        
    } finally {
        isProcessing = false;
        processQueue(); 
    }
}

app.get("/status", (req, res) => {
    const isReady = !isInitializing && pageOverall && !pageOverall.isClosed() && !pageOverall.url().includes('default.aspx');
    res.json({ ready: !!isReady });
});

app.get("/ping", async (req, res) => {
    if (isProcessing || isInitializing) return res.send("Busy");
    const activePages = [pageYest, pageToday, pageOverall].filter(page => page !== undefined);
    if (activePages.length < 3 || activePages.some(page => page.isClosed()) || pageOverall.url().includes('default.aspx')) {
        await initializeSession();
    } else {
        try {
            await pageOverall.click("#radTillNow", { timeout: 5000 });
            await pageOverall.click("#btnShow", { timeout: 5000 });
        } catch(e) {}
    }
    res.send("Alive!");
});

app.post("/fetch-attendance", (req, res) => {
    const { rollNo } = req.body;
    new Promise((resolve, reject) => {
        requestQueue.push({ rollNo, resolve, reject });
        processQueue();
    }).then(d => res.json(d)).catch(e => res.status(500).json({error: "Fail"}));
});

app.get('/api/vapidPublicKey', (req, res) => {
    res.send(process.env.VAPID_PUBLIC_KEY);
});

app.post('/api/subscribe', async (req, res) => {
    const { subscription, rollNo, name, notificationsEnabled } = req.body;
    try {
        const payload = { rollNo, notificationsEnabled, lastUpdated: admin.firestore.FieldValue.serverTimestamp() };
        if (subscription !== undefined) payload.subscription = subscription;
        if (name !== undefined) payload.name = name;

        if (subscription !== undefined && notificationsEnabled === true) {
            const duplicatePushes = await db.collection('users').where('subscription.endpoint', '==', subscription.endpoint).get();
            duplicatePushes.forEach(async (doc) => {
                if (doc.id !== rollNo) {
                    await db.collection('users').doc(doc.id).update({ notificationsEnabled: false });
                    console.log(`[${getTimestamp()}] 🧹 Removed phone's old cross-talk subscription from ${doc.id}`);
                }
            });
        }

        await db.collection('users').doc(rollNo).set(payload, { merge: true });
        console.log(`[${getTimestamp()}] 🔔 Database Updated: ${rollNo} (Notifications: ${notificationsEnabled})`);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Database Error:", error);
        res.status(500).json({ error: "Failed to save." });
    }
});



app.get('/sw.js', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'sw.js')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'manifest.json')));
app.get('/icon.png', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'logo.jpg')));
// --- 🛠️ ADMIN ROUTES ---

// 1. Serve the Admin Panel HTML
app.get('/notifiadmin', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'notifiadmin.html')); 
});

// 2. Fetch Active Users for the Dropdown
app.post('/api/admin/users', async (req, res) => {
    const { secret } = req.body;

    if (secret !== 'SagarAdmin2006^') {
        return res.status(403).json({ error: "Unauthorized. Wrong admin password." });
    }

    try {
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('notificationsEnabled', '==', true).get();
        
        let activeUsers = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            activeUsers.push({ rollNo: data.rollNo, name: data.name || '' });
        });

        res.status(200).json({ success: true, users: activeUsers });
    } catch (error) {
        console.error("Fetch Users Error:", error);
        res.status(500).json({ error: "Failed to fetch active users." });
    }
});

// 3. Broadcast & Direct Message Logic
app.post('/api/admin/broadcast', async (req, res) => {
    const { message, secret, targetRollNo } = req.body;

    if (secret !== 'SagarAdmin2006^') {
        return res.status(403).json({ error: "Unauthorized. Wrong admin password." });
    }

    if (!message) return res.status(400).json({ error: "Message is required." });

    try {
        const usersRef = db.collection('users');
        let snapshot;

        // If specific user selected, get only them. Else, get everyone.
        if (targetRollNo && targetRollNo !== 'ALL') {
            snapshot = await usersRef.where('rollNo', '==', targetRollNo).where('notificationsEnabled', '==', true).get();
        } else {
            snapshot = await usersRef.where('notificationsEnabled', '==', true).get();
        }

        if (snapshot.empty) {
            return res.status(200).json({ success: true, sentCount: 0, msg: "No active users found." });
        }

        let sentCount = 0;
        
        const promises = snapshot.docs.map(async (doc) => {
            const user = doc.data();
            const studentName = toTitleCase(user.name || user.rollNo);
            
            const payload = JSON.stringify({
                title: targetRollNo === 'ALL' ? "Update From Sagar Attendance📢" : "Hey! 💬",
                body: `Hi ${studentName},\n${message}`
            });

            try {
                await webpush.sendNotification(user.subscription, payload);
                sentCount++;
            } catch (pushErr) {
                // If they uninstalled, clean up their DB record
                if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                    await usersRef.doc(user.rollNo).update({ notificationsEnabled: false });
                }
            }
        });

        await Promise.all(promises);
        console.log(`[${getTimestamp()}] 📢 ADMIN: Sent testing message to ${sentCount} users (Target: ${targetRollNo || 'ALL'}).`);
        res.status(200).json({ success: true, sentCount });

    } catch (error) {
        console.error("Broadcast Error:", error);
        res.status(500).json({ error: "Failed to broadcast message." });
    }
});
const cron = require('node-cron');

cron.schedule('*/10 10-18 * * 1-6', async () => {
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    if (now.getHours() === 18 && now.getMinutes() > 30) return;

    console.log(`\n[${getTimestamp()}] 🤖 CRON: Waking up to check attendance...`);

    try {
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('notificationsEnabled', '==', true).get();

        if (snapshot.empty) return;

        for (const doc of snapshot.docs) {
            const user = doc.data();
            const rollNo = user.rollNo;
            
            try {
                const response = await fetch(`http://127.0.0.1:8080/fetch-attendance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rollNo: rollNo })
                });
                
                if (!response.ok) continue;
                const data = await response.json();
                
                const studentName = toTitleCase(user.name || rollNo);
                const newDaily = parseAttendance(data.dailyHtml);
                const overallPct = getOverallPercentage(data.overallHtml);
                
                const oldDaily = user.lastDailyData || { subjects: {}, totalHeld: 0, totalAtt: 0 };
                
                const pushBody = generatePushMessage(studentName, oldDaily, newDaily, overallPct);

                if (pushBody !== null) {
                    console.log(`[${getTimestamp()}] 🚨 CRON: Valid Attendance Change for ${rollNo}! Sending Push...`);

                    const payload = JSON.stringify({
                        title: "Attendance Updated! 📊",
                        body: pushBody,
                    });

                    try {
                        await webpush.sendNotification(user.subscription, payload);
                        console.log(`[${getTimestamp()}] 📲 CRON: Push notification delivered to ${rollNo}.`);
                    } catch (pushErr) {
                        if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                            await usersRef.doc(rollNo).update({ notificationsEnabled: false });
                        }
                    }
                }

                await usersRef.doc(rollNo).update({
                    lastDailyData: newDaily, 
                    lastChecked: new Date().toISOString()
                });

            } catch (fetchErr) {
                console.log(`[${getTimestamp()}] CRON skip: ECAP fetch timeout for ${rollNo}`);
            }
        }
    } catch (error) {}
}, { scheduled: true, timezone: "Asia/Kolkata" });

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Server on ${PORT}`);
    await initializeSession();
});