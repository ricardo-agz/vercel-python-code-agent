from flask import Flask, jsonify, request

app = Flask(__name__)

@app.get('/health')
def health():
    return jsonify({ 'status': 'ok', 'service': 'flask' })

@app.get('/ping')
def ping():
    return jsonify({ 'message': 'pong' })

_todos = []

@app.get('/todos')
def list_todos():
    return jsonify({ 'todos': _todos })

@app.post('/todos')
def create_todo():
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({ 'error': 'title is required' }), 400
    todo = { 'id': str(len(_todos)+1), 'title': title }
    _todos.append(todo)
    return jsonify({ 'todo': todo }), 201

@app.delete('/todos/<id>')
def delete_todo(id):
    idx = next((i for i, t in enumerate(_todos) if t['id'] == id), -1)
    if idx == -1:
        return jsonify({ 'error': 'not found' }), 404
    deleted = _todos.pop(idx)
    return jsonify({ 'deleted': deleted })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)


