// server.js
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const port = 8080;

app.use(express.static('.'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Mock database
const users = [
  { id: 1, email: 'directora@karpus.local', password: 'password', role: 'directora', name: 'Directora' },
  { id: 2, email: 'maestra@karpus.local', password: 'password', role: 'maestra', name: 'Maestra' },
  { id: 3, email: 'padre@karpus.local', password: 'password', role: 'padre', name: 'Padre/Madre' },
  { id: 4, email: 'asistente@karpus.local', password: 'password', role: 'asistente', name: 'Recepcionista' },
];

// API endpoints
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email.toLowerCase() === String(email).toLowerCase() && u.password === String(password));

  if (user) {
    res.json({ success: true, user: { email: user.email, role: user.role, name: user.name } });
  } else {
    res.json({ success: false, message: 'Invalid credentials' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
