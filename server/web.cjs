const express = require('express');
const path = require('path');

const app = express();

// Servir estáticos desde la raíz del proyecto
app.use(express.static(path.join(__dirname, '..')));

// Ruta por defecto al index
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const port = process.env.PORT || 5800;
app.listen(port, () => {
  console.log(`Web server escuchando en http://127.0.0.1:${port}/`);
});

