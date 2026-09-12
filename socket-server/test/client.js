const { io } = require('socket.io-client');

const url = process.env.SOCKET_URL || 'http://localhost:3001';
const sessionId = 'standalone-test';
const socket = io(url, { transports: ['websocket'] });

const validCircuit = {
  components: [
    { id: 'led-1', type: 'led', anode: 'D13', cathode: 'GND' },
    { id: 'resistor-1', type: 'resistor', a: 'D13', b: 'led-1-anode' }
  ],
  wires: [
    { from: 'D13', to: 'resistor-1-a' },
    { from: 'resistor-1-b', to: 'led-1-anode' },
    { from: 'led-1-cathode', to: 'GND' }
  ]
};

socket.on('connect', () => {
  console.log(`Connected to ${url}`);
  socket.emit('session:join', { sessionId });
  socket.emit('circuit:update', { sessionId, circuit: validCircuit });
});
socket.on('circuit:result', (result) => console.log('circuit:result', result));
socket.on('simulation:led', (event) => {
  console.log('simulation:led', event);
  socket.disconnect();
});
socket.on('connect_error', (error) => { console.error('Connection failed:', error.message); process.exitCode = 1; });
