const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(cors({
  origin: "https://23mh1a1202.github.io",
  methods: ["GET", "POST", "OPTIONS"],
}));

app.options("*", cors());
// <--- enable CORS
app.use(express.json());

app.post("/register", async (req, res) => {
  const { username, password } = req.body;


  if (!username || !password) {
    return res.send("❌ Missing credentials. Use ?username=YOURID&password=YOURPASS");
  }

 const browser = await puppeteer.launch({
  headless: true,
  executablePath: puppeteer.executablePath(), // 👈 ensures Puppeteer finds Chrome on Render
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0 Safari/537.36");

  try {
    console.log("🔵 Logging into ECAP...");
    await page.goto("https://info.aec.edu.in/acet/default.aspx", {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    await page.waitForSelector("#txtId2", { visible: true });
    await page.type("#txtId2", username);
    await page.waitForSelector("#txtPwd2", { visible: true });
    await page.type("#txtPwd2", password);
    await page.waitForSelector("#imgBtn2", { visible: true });
    await page.evaluate(() => document.querySelector("#imgBtn2").click());

    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90000 });

    if (page.url().includes("default.aspx")) {
      await browser.close();
      return res.send(`
        <html>
          <head>
            <title>Login Failed</title>
            <style>
              body { font-family: Arial; background: #f8d7da; color: #721c24; padding: 50px; text-align: center; }
              button {
                background: #721c24;
                color: white;
                padding: 12px 20px;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                cursor: pointer;
                margin-top: 20px;
              }
              button:hover {
                background: #5a1218;
              }
            </style>
          </head>
          <body>
            <h2>❌ Incorrect Credentials</h2>
            <p>Please check your roll number or password and try again.</p>
            <button onclick="clearAndGoBack()">⬅️ Back to Login</button>
            <script>
              function clearAndGoBack() {
                localStorage.removeItem("ecap_user");
                localStorage.removeItem("ecap_pass");
                window.location.href = "https://23mh1a1202.github.io/ecap-ui";
              }
            </script>
          </body>
        </html>
      `);
    }

    console.log("✅ Logged in.");

    await page.goto("https://info.aec.edu.in/ACET/Academics/studentacadamicregister.aspx?scrid=2", {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    await page.waitForSelector("#divRegister", { timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 2000));

    const today = new Date().toLocaleDateString("en-GB").slice(0, 5);

    const filteredHTML = await page.evaluate((todayDate) => {
      const div = document.querySelector("#divRegister");
      if (!div) return "<p>❌ divRegister not found</p>";

      const mainTable = div.querySelector("table");
      if (!mainTable) return "<p>❌ Main table not found</p>";

      const rows = mainTable.querySelectorAll("tr");
      let rollRow = "", nameRow = "", headerRow = null, dataRows = [];

      for (let row of rows) {
        const txt = row.innerText || "";
        if (txt.includes("Roll.No")) rollRow = `<tr><td colspan="5" style="text-align:center; font-weight:bold; padding:12px;">${txt}</td></tr>`;
        else if (txt.includes("Student Name")) nameRow = `<tr><td colspan="5" style="text-align:center; font-weight:bold; padding:12px;">${txt}</td></tr>`;
        else if (row.querySelector("td.cellBorder")?.innerText === "Sl.No") headerRow = row;
        else if (row.querySelector("td.cellBorder")) dataRows.push(row);
      }

      if (!headerRow) return "<p>❌ Header row not found</p>";

      const headers = Array.from(headerRow.querySelectorAll("td"));
      const indices = {
        date: headers.findIndex(td => td.innerText.includes(todayDate)),
        sl: 0,
        subject: 1,
        attended: headers.length - 2,
        percent: headers.length - 1
      };

      let totalA = 0, totalH = 0;
      dataRows.forEach(r => {
        const c = r.querySelectorAll("td");
        const match = c[indices.attended]?.innerText?.trim().match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
          totalA += +match[1];
          totalH += +match[2];
        }
      });

      const percent = totalH ? ((totalA / totalH) * 100).toFixed(2) : "N/A";
      const finalSummary = `✅ Overall Attendance: ${percent}%`;

      const t = document.createElement("table");
      t.className = "attendance";
      t.border = "1";

      const head = document.createElement("tr");
      [indices.sl, indices.subject, indices.date, indices.attended, indices.percent].forEach(i => head.appendChild(headers[i].cloneNode(true)));
      t.appendChild(head);

      dataRows.forEach(row => {
        const cells = row.querySelectorAll("td");
        const tr = document.createElement("tr");
        [indices.sl, indices.subject, indices.date, indices.attended, indices.percent].forEach(i => tr.appendChild(cells[i]?.cloneNode(true)));
        t.appendChild(tr);
      });

      const sumRow = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.style.cssText = "text-align:right;font-weight:bold;background:#e8f0fe;padding:14px";
      td.innerText = finalSummary;
      sumRow.appendChild(td);
      t.appendChild(sumRow);

      return `
        <center>
          <table style="width:95%; font-family:Arial; font-size:14px;">
            <tr><td colspan="2">
              <center>
                <table>
                  <tr><td class="reportMainHeading" align="center">ADITYA COLLEGE OF ENGINEERING & TECHNOLOGY</td></tr>
                  <tr><td class="reportHeading1" align="center">Aditya Nagar, ADB Road , Surampalem -533437, E.G.Dt.</td></tr>
                  <tr><td class="reportHeading1" align="center">ACADEMIC REGISTER</td></tr>
                </table>
              </center>
            </td></tr>
            ${rollRow}${nameRow}
          </table><br>${t.outerHTML}
        </center>`;
    }, today);

    res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><title>Register</title><style>
      body{margin:0;font-family:'Segoe UI',sans-serif;background:#f0f2f5;}
      .container{max-width:960px;margin:auto;background:#fff;padding:25px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);}
      h2{text-align:center;color:#007bff;}
      .attendance{width:100%;border-collapse:collapse;margin-top:20px;font-size:14px;table-layout:fixed;word-wrap:break-word;}
      .attendance th,.attendance td{border:1px solid #ccc;padding:14px 10px;text-align:center;}
      .attendance th{background:#007bff;color:#fff;font-weight:bold;}
      .attendance tr:nth-child(even){background:#f9f9f9;}
      @media(max-width:768px){.attendance{font-size:12.5px}.attendance th,.attendance td{padding:10px 6px}}
      @media(max-width:480px){.attendance{font-size:11.5px}.attendance th,.attendance td{padding:8px 4px}.container{padding:15px}}
    </style></head><body><div class="container"><h2>📄 Academic Register (Today)</h2>${filteredHTML}</div></body></html>`);
  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).send("❌ Error: " + err.message);
  } finally {
    try {
      console.log("🔴 Logging out...");
      await page.goto("https://info.aec.edu.in/ACET/StudentMaster.aspx", { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.evaluate(() => {
        const logoutLink = document.getElementById("lnkLogOut");
        if (logoutLink) logoutLink.click();
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log("✅ Logged out successfully.");
    } catch (e) {
      console.warn("⚠️ Logout failed gracefully:", e.message);
    }
    await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
