const WebSocket = require('ws');
const { state, getCurrentState } = require('../state');

const wss = new WebSocket.Server({ noServer: true });

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function setupWebSocket(server) {
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
}

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket.');

  // Send current state immediately on connect
  ws.send(JSON.stringify(getCurrentState()));

  ws.on('message', (message) => {
    try {
      const command = JSON.parse(message);
      console.log('Received command:', command);

      // Lazy load serial connection controls to break circular dependency
      const { initSerialConnection, closeSerialConnection } = require('../services/serialService');

      if (command.type === 'TOGGLE_SIMULATION') {
        state.isSimulationMode = command.value;
        if (!state.isSimulationMode) {
          initSerialConnection();
        } else {
          closeSerialConnection();
        }
        broadcast(getCurrentState());
      }
      else if (command.type === 'CHANGE_PORT') {
        state.serialPortPath = command.value;
        if (!state.isSimulationMode) {
          initSerialConnection();
        }
        broadcast(getCurrentState());
      }
      else if (command.type === 'CHANGE_BAUDRATE') {
        state.baudRate = command.value;
        if (!state.isSimulationMode) {
          initSerialConnection();
        }
        broadcast(getCurrentState());
      }
      else if (command.type === 'TRIGGER_SIM_FAULT') {
        const faultName = command.fault;
        if (state.simulatedState && state.simulatedState.protectionStatus.hasOwnProperty(faultName)) {
          state.simulatedState.protectionStatus[faultName] = !state.simulatedState.protectionStatus[faultName];
        }
      }
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected.');
  });
});

module.exports = {
  wss,
  broadcast,
  setupWebSocket
};
