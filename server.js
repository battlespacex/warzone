const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 4173;
const ROOT = __dirname;

// Serve everything from the project root
// and automatically try .html when no extension is given
app.use(
    express.static(ROOT, {
        extensions: ["html"],  // so /about -> about.html, /contact -> contact.html
    })
);

// 404 handler (after static)
app.use((req, res) => {
    res.status(404).send("Page not found");
});

app.listen(PORT, () => {
    console.log(`Aerocism server running at http://localhost:${PORT}`);
});
