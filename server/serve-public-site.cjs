const express = require('express');
const path = require('node:path');
const app = express();
// Independent static preview: no environment loading, API proxy, authentication or polling.
const directory = path.resolve(__dirname, '../public-site');
app.use(express.static(directory));
app.use((_req,res)=>res.status(404).sendFile(path.join(directory,'404.html')));
app.listen(4175,'127.0.0.1',()=>console.log('Public website preview: http://127.0.0.1:4175'));
