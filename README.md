You can now run a Python FastAPI app inside a Vercel sandbox from the sandboxes Python SDK running on FastAPI in Vercel:
https://vercel-python-code-agent-front.vercel.app/


## Running Locally:

### Frontend:
```
cd frontend
pnpm run dev
```

### Backend:

#### Setting environment variables
```
cat .env.template > .env
# Set your env variables
# If you only care about the agent and not remote code execution, only VERCEL_AI_GATEWAY_API_KEY is necessary
```

#### Running the API
```
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```