const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4173;
const ROOT = path.join(__dirname, "production");
const BASE = "/warzone";

app.disable("x-powered-by");
app.use(express.static(ROOT));

function sendPage(res, name, status = 200) {
    return res.status(status).sendFile(path.join(ROOT, "pages", `${name}.html`));
}

app.get(`${BASE}/`, (req, res) => sendPage(res, "index"));
app.get(`${BASE}/about`, (req, res) => sendPage(res, "about"));
app.get(`${BASE}/report`, (req, res) => sendPage(res, "report"));
app.get(`${BASE}/sources`, (req, res) => sendPage(res, "sources"));
app.get(`${BASE}/404`, (req, res) => sendPage(res, "404", 404));
app.use((req, res) => sendPage(res, "404", 404));

app.listen(PORT, () => {
    console.log(`Warzone server running at http://localhost:${PORT}${BASE}/`);
});