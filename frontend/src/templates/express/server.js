const express = require('express');
const morgan = require('morgan');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'express', time: new Date().toISOString() });
});

app.get('/ping', (_req, res) => {
  res.json({ message: 'pong' });
});

// Simple in-memory todos
const todos = [];

app.get('/todos', (_req, res) => {
  res.json({ todos });
});

app.post('/todos', (req, res) => {
  const title = (req.body && req.body.title) || '';
  if (!title) return res.status(400).json({ error: 'title is required' });
  const todo = { id: String(Date.now()), title };
  todos.push(todo);
  res.status(201).json({ todo });
});

app.delete('/todos/:id', (req, res) => {
  const id = req.params.id;
  const idx = todos.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const [deleted] = todos.splice(idx, 1);
  res.json({ deleted });
});

app.listen(port, () => {
  console.log(`Express API listening on http://localhost:${port}`);
});


