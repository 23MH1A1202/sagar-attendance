require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { chromium } = require('playwright');
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080; 

const MASTER_USER = process.env.MASTER_USER;
const MASTER_PASS = process.env.MASTER_PASS;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "templates")));

// --- GLOBAL VARIABLES ---
let browser;
let context;
let page; 
let isProcessing = false;
const requestQueue = []; 

// --- 1. SESSION INITIALIZATION ---
async function initializeSession() {
    try {
        console.log("🔄 Initializing Session...");
        if (browser) await browser.close();

        browser = await chromium.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
        });

        context = await browser.newContext();
        
        // 🚀 OPTIMIZATION: Block Images for Speed
        await context.route('**/*.{png,jpg,jpeg,gif,css,woff,woff2,svg,ico}', route => route.abort());

        page = await context.newPage();

        console.log("🔐 Logging in...");
        await page.goto("https://info.aec.edu.in/acet/default.aspx", { timeout: 60000, waitUntil: 'domcontentloaded' });
        
        // ⚡ EXACT MANUAL REPLICATION ⚡
        // We inject the EXACT JavaScript you verified in the console
        await page.evaluate((creds) => {
            // 1. User
            var user = document.querySelector("#txtId3");
            user.value = creds.user;
            user.dispatchEvent(new Event('input', { bubbles: true }));
            user.dispatchEvent(new Event('change', { bubbles: true }));
            user.blur();

            // 2. Password (Native Setter to trigger encryption)
            var pass = document.querySelector("#txtPwd3");
            pass.value = "";
            var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            nativeInputValueSetter.call(pass, creds.pass);
            
            pass.dispatchEvent(new Event('input', { bubbles: true }));
            pass.dispatchEvent(new Event('keyup', { bubbles: true }));
            pass.dispatchEvent(new Event('change', { bubbles: true }));
            pass.blur();

            // 3. Click
            document.querySelector("#imgBtn3").click();
        }, { user: MASTER_USER, pass: MASTER_PASS });

        // Wait for redirect
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

        console.log("📂 Jumping to Attendance...");
        await page.goto("https://info.aec.edu.in/acet/Academics/StudentAttendance.aspx?scrid=3&showtype=SA", { waitUntil: 'domcontentloaded' });
        
        await page.waitForSelector("#txtRollNo", { timeout: 30000 });
        console.log("✅ Session Ready.");
        return true;
    } catch (err) {
        console.error("❌ Init Failed:", err.message);
        return false;
    }
}

// --- 2. POPUP SCRAPER ---
async function scrapePopup() {
    let printPage = null;
    try {
        [printPage] = await Promise.all([
            context.waitForEvent('page'),
            page.evaluate(() => document.querySelector('input[value="Print"]').click())
        ]);

        await printPage.waitForSelector("#divReport");
        const html = await printPage.evaluate(() => document.querySelector("#divReport").innerHTML);
        return html;
    } catch (e) {
        return null;
    } finally {
        if (printPage) await printPage.close();
    }
}

// --- 3. QUEUE PROCESSOR ---
async function processQueue() {
    if (isProcessing || requestQueue.length === 0) return;

    isProcessing = true;
    const { rollNo, resolve, reject } = requestQueue.shift();

    try {
        console.log(`▶️ Fetching: ${rollNo}`);

        if (!page || page.isClosed()) await initializeSession();
        if (await page.$("#txtId3")) await initializeSession();

        // --- STEP 1: Enter Roll No ---
        await page.evaluate((r) => {
            var el = document.querySelector("#txtRollNo");
            el.value = r;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, rollNo);

        // --- STEP 2: Fetch Yesterday ---
        const now = new Date();
        const yest = new Date(now); yest.setDate(yest.getDate() - 1);
        const yestStr = yest.toLocaleDateString('en-GB'); 

        await page.evaluate((date) => {
            document.querySelector("#radPeriod").click();
            document.querySelector("#txtFromDate").value = date;
            document.querySelector("#txtToDate").value = date;
            document.querySelector("#btnShow").click();
        }, yestStr);
        
        // Wait for AJAX (Loader appear -> disappear)
        try { await page.waitForSelector("#divprocess", { state: 'visible', timeout: 500 }); } catch(e){}
        await page.waitForSelector("#divprocess", { state: 'hidden' });
        const yesterdayHtml = await scrapePopup();


        // --- STEP 3: Fetch Today ---
        const todayStr = now.toLocaleDateString('en-GB');
        
        await page.evaluate((date) => {
            document.querySelector("#txtFromDate").value = date;
            document.querySelector("#txtToDate").value = date;
            document.querySelector("#btnShow").click();
        }, todayStr);

        try { await page.waitForSelector("#divprocess", { state: 'visible', timeout: 500 }); } catch(e){}
        await page.waitForSelector("#divprocess", { state: 'hidden' });
        const dailyHtml = await scrapePopup();


        // --- STEP 4: Fetch Overall ---
        await page.evaluate(() => {
            document.querySelector("#radTillNow").click();
            document.querySelector("#btnShow").click();
        });

        try { await page.waitForSelector("#divprocess", { state: 'visible', timeout: 500 }); } catch(e){}
        await page.waitForSelector("#divprocess", { state: 'hidden' });
        const overallHtml = await scrapePopup();

        // Cleanup
        await page.evaluate(() => document.querySelector("#txtRollNo").value = "");

        console.log(`✅ Done: ${rollNo}`);
        resolve({ yesterdayHtml, dailyHtml, overallHtml });

    } catch (err) {
        console.error(`❌ Error on ${rollNo}:`, err.message);
        try { await initializeSession(); } catch(e) {} 
        reject(err);
    } finally {
        isProcessing = false;
        processQueue();
    }
}

// --- 4. SERVER & HEARTBEAT ---
app.post("/fetch-attendance", (req, res) => {
    const { rollNo } = req.body;
    new Promise((resolve, reject) => {
        requestQueue.push({ rollNo, resolve, reject });
        processQueue();
    }).then(d => res.json(d)).catch(e => res.status(500).json({error: "Fail"}));
});

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Server on ${PORT}`);
    await initializeSession();
});

setInterval(async () => {
    if (!isProcessing && page && !page.isClosed()) {
        try {
            await page.reload({ waitUntil: 'domcontentloaded' });
            if (await page.$("#txtId3")) await initializeSession();
            else if (!await page.$("#txtRollNo")) await page.goto("https://info.aec.edu.in/acet/Academics/StudentAttendance.aspx?scrid=3&showtype=SA");
        } catch (e) { await initializeSession(); }
    }
}, 5 * 60 * 1000);
