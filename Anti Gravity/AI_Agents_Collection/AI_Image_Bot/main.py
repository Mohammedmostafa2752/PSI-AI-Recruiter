import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Depends, BackgroundTasks
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from database import init_db, get_db, LogEntry
from bot import setup_bot

# Directory for templates and static files
os.makedirs("templates", exist_ok=True)
os.makedirs("static", exist_ok=True)

# Initialize FastAPI App
app = FastAPI(title="AI Image Enhancer Dashboard")

# Setup Templates
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

bot_application = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    
    global bot_application
    bot_application = setup_bot()
    
    if bot_application:
        print("Starting Telegram Bot Polling...")
        await bot_application.initialize()
        await bot_application.start()
        # Run polling in the background without blocking FastAPI
        asyncio.create_task(bot_application.updater.start_polling())
    else:
        print("No Bot Token provided. Telegram Bot is NOT running.")
        
    yield
    
    # Shutdown
    if bot_application:
        print("Stopping Telegram Bot...")
        await bot_application.updater.stop()
        await bot_application.stop()
        await bot_application.shutdown()

app.router.lifespan_context = lifespan


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, db: Session = Depends(get_db)):
    """Render the dashboard UI."""
    # Get last 50 logs
    logs = db.query(LogEntry).order_by(LogEntry.timestamp.desc()).limit(50).all()
    
    # Quick metrics calculation
    total_requests = db.query(LogEntry).filter(LogEntry.source == "BOT", LogEntry.level == "INFO", LogEntry.message.like("%Received photo%")).count()
    total_errors = db.query(LogEntry).filter(LogEntry.level == "ERROR").count()
    successful_ai = db.query(LogEntry).filter(LogEntry.source == "AI", LogEntry.level == "INFO", LogEntry.message.like("%enhanced successfully%")).count()
    
    return templates.TemplateResponse("index.html", {
        "request": request,
        "logs": logs,
        "total_requests": total_requests,
        "total_errors": total_errors,
        "successful_ai": successful_ai
    })

@app.get("/api/logs")
async def get_logs_api(db: Session = Depends(get_db), limit: int = 50):
    """API endpoint for fetching logs asynchronously if needed by frontend."""
    logs = db.query(LogEntry).order_by(LogEntry.timestamp.desc()).limit(limit).all()
    return logs

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
