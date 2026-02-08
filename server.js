// server.js
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4173;

const ROOT = path.join(__dirname, "production");

app.use(
    express.static(ROOT, {
        extensions: ["html"],
    })
);

app.get("/404", (req, res) => {
    res.status(404).sendFile(path.join(ROOT, "404.html"));
});

app.use((req, res) => {
    res.status(404).sendFile(path.join(ROOT, "404.html"));
});

app.listen(PORT, () => {
    console.log(`Aerocism server running at http://localhost:${PORT}`);
});
