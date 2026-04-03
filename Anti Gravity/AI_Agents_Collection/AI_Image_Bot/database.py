from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, timezone
import os

DATABASE_URL = "sqlite:///./dashboard.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class LogEntry(Base):
    __tablename__ = "logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    level = Column(String(50), default="INFO")       # INFO, ERROR, WARNING
    source = Column(String(100), default="SYSTEM")     # BOT, AI, SYSTEM, FASTAPI
    message = Column(Text, nullable=False)
    user_id = Column(String(100), nullable=True)     # Telegram user ID
    image_url_input = Column(Text, nullable=True)
    image_url_output = Column(Text, nullable=True)
    error_details = Column(Text, nullable=True)
    processing_time_sec = Column(Integer, nullable=True)

def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def log_event(level: str, source: str, message: str, user_id: str = None, 
              image_input: str = None, image_output: str = None, 
              error: str = None, duration: int = None):
    db = SessionLocal()
    try:
        entry = LogEntry(
            level=level,
            source=source,
            message=message,
            user_id=str(user_id) if user_id else None,
            image_url_input=image_input,
            image_url_output=image_output,
            error_details=error,
            processing_time_sec=duration
        )
        db.add(entry)
        db.commit()
    except Exception as e:
        print(f"Failed to log to database: {e}")
    finally:
        db.close()
