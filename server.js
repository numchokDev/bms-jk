const express = require('express');
const http = require('http');
const path = require('path');
const { PORT } = require('./src/config');
const { state } = require('./src/state');
const { SerialPortLib, initSerialConnection, autoDiscoverBmsPort } = require('./src/services/serialService');
const { setupWebSocket, broadcast } = require('./src/controllers/wsController');
const { startSimulation } = require('./src/models/simulation');
const apiRouter = require('./src/controllers/apiController');
const loggingRouter = require('./src/controllers/loggingController');

const app = express();
const server = http.createServer(app);

// Parse JSON request bodies (needed for PUT /api/config)
app.use(express.json());

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Connect REST API
app.use('/api', apiRouter);
app.use('/api/logs', loggingRouter);

// Set up WebSocket
setupWebSocket(server);

// Start simulated ticks generator in background
startSimulation(broadcast);

// Start HTTP & WebSocket Server
server.listen(PORT, async () => {
  console.log(`==================================================`);
  console.log(`JK BMS Dashboard Server listening on port ${PORT}`);
  console.log(`Open your browser at: http://localhost:${PORT}`);
  console.log(`==================================================`);

  // เรียกใช้ Auto-Discovery เพื่อค้นหาและเปิดใช้งานพอร์ต COM ของ JK BMS จริงโดยอัตโนมัติ
  await autoDiscoverBmsPort();
});
