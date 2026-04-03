import os
import logging
import asyncio
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from database import log_event
from ai_service import enhance_image
import time

load_dotenv()
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")

logger = logging.getLogger(__name__)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    log_event("INFO", "BOT", f"User started the bot", user_id=user.id)
    welcome_text = (
        "Hello! I am your AI Product Enhancer Bot. 🎨✨\n\n"
        "Send me a hand-shot photo of your product, and I will enhance its quality, "
        "replace the background with a clean, marketing-ready scene, and prepare it for Meta platforms.\n\n"
        "Go ahead and upload a photo!"
    )
    await update.message.reply_text(welcome_text)

async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    
    # Get the best quality photo (the last one in the array)
    photo = update.message.photo[-1]
    file = await context.bot.get_file(photo.file_id)
    # This gets a telegram URL that is valid for 1 hour
    image_url = file.file_path
    
    log_event(
        level="INFO", 
        source="BOT", 
        message="Received photo for processing", 
        user_id=user.id, 
        image_input=image_url
    )

    processing_msg = await update.message.reply_text("⏳ Processing your product photo... This may take a few moments.")
    
    start_time = time.time()
    try:
        log_event("INFO", "AI", "Starting AI enhancement process", user_id=user.id)
        
        # Call the AI service
        enhanced_image_url = await enhance_image(image_url)
        
        duration = int(time.time() - start_time)
        
        log_event(
            level="INFO", 
            source="AI", 
            message="Image enhanced successfully", 
            user_id=user.id, 
            image_input=image_url, 
            image_output=enhanced_image_url,
            duration=duration
        )
        
        await context.bot.send_photo(
            chat_id=update.message.chat_id,
            photo=enhanced_image_url,
            caption="✨ Here is your enhanced professional marketing image!"
        )
        await processing_msg.delete()
        
    except Exception as e:
        error_msg = str(e)
        duration = int(time.time() - start_time)
        
        log_event(
            level="ERROR", 
            source="SYSTEM", 
            message="Error processing image", 
            user_id=user.id, 
            image_input=image_url,
            error=error_msg,
            duration=duration
        )
        
        await processing_msg.edit_text("❌ Sorry, there was an error processing your image. The developers have been notified.")
        logger.error(f"Image processing error: {error_msg}")

async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.error("Exception while handling an update:", exc_info=context.error)
    user_id = update.effective_user.id if update and update.effective_user else None
    
    log_event(
        level="ERROR", 
        source="BOT_CORE", 
        message="Unhandled exception in bot core", 
        user_id=user_id,
        error=str(context.error)
    )

def setup_bot():
    if not TELEGRAM_BOT_TOKEN:
        print("Warning: TELEGRAM_BOT_TOKEN not set in environment.")
        return None
        
    application = Application.builder().token(TELEGRAM_BOT_TOKEN).build()

    application.add_handler(CommandHandler("start", start))
    application.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    application.add_error_handler(error_handler)

    return application
