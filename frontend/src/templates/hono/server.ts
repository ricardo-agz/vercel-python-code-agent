import { Hono } from 'hono'

const app = new Hono()

app.get('/health', (c) => c.json({ status: 'ok', service: 'hono' }))
app.get('/ping', (c) => c.json({ message: 'pong' }))

type Todo = { id: string; title: string }
const todos: Todo[] = []

app.get('/todos', (c) => c.json({ todos }))
app.post('/todos', async (c) => {
  const body = await c.req.json<{ title?: string }>().catch(() => ({} as any))
  const title = (body?.title || '').trim()
  if (!title) return c.json({ error: 'title is required' }, 400)
  const todo = { id: String(Date.now()), title }
  todos.push(todo)
  return c.json({ todo }, 201)
})
app.delete('/todos/:id', (c) => {
  const id = c.req.param('id')
  const idx = todos.findIndex(t => t.id === id)
  if (idx === -1) return c.json({ error: 'not found' }, 404)
  const [deleted] = todos.splice(idx, 1)
  return c.json({ deleted })
})

export default app


