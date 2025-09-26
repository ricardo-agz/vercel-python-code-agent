# Basic Agent Example

An IDE-based agent that can write and edit code and request the user to execute code.

## Quick Start with Docker

1. Set up environment:
```bash
cp .env.template .env
# Add your OPENAI_API_KEY to .env
```

2. Run everything:
```bash
docker-compose up
```

3. Open:
- UI: http://localhost:5173
- Dashboard: http://localhost:8081

## Manual Setup

### Prerequisites
- Python 3.9+, Node.js 18+, Redis

### Install & Run
```bash
# 1. Set up .env file
cp .env.template .env
# Set your OpenAI and Exa API keys

# 2. Install Python Dependencies
pip install -r requirements.txt
pip install -e .

# 3. Install UI Dependencies
cd ui
npm install

# 4. Start Redis
redis-server

# 5. Run components (separate terminals):
python agent.py    # Agent workers
python server.py   # API server  
cd ui && npm run dev  # UI
```

### URLs
- UI: http://localhost:5173
- Dashboard: http://localhost:8081
