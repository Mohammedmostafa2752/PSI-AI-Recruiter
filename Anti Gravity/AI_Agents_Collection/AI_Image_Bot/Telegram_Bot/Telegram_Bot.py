import os
import base64
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton
from openai import OpenAI
from PIL import Image
from io import BytesIO
import logging
import sys
import threading
import math

# ==========================================
# LOGGING CONFIGURATION
# ==========================================
log_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
log_file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bot_logs.txt')

class FlushFileHandler(logging.FileHandler):
    def emit(self, record):
        super().emit(record)
        self.flush()

file_handler = FlushFileHandler(log_file_path, encoding='utf-8')
file_handler.setFormatter(log_formatter)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)

logger = logging.getLogger("TelegramBot")
logger.setLevel(logging.INFO)
logger.addHandler(file_handler)
logger.addHandler(console_handler)

# ==========================================
# API CONFIGURATION
# ==========================================
TELEGRAM_BOT_TOKEN = "8755881543:AAEshG8sHNNtbP43YJHu_mcwoGyt1AMYR_w"
OPENAI_API_KEY = "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"

bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)
client = OpenAI(api_key=OPENAI_API_KEY)

# ==========================================
# STATE & MEDIA GROUP TRACKING
# ==========================================
USER_STATES = {}
MEDIA_COLLECTOR = {}
MEDIA_TIMERS = {}

STATE_IDLE = 'idle'
STATE_AWAITING_ONE_PIC = 'awaiting_one_pic'
STATE_AWAITING_MULTI_SAME = 'awaiting_multi_same'
STATE_AWAITING_MULTI_DIFF = 'awaiting_multi_diff'

# ==========================================
# PROMPTS
# ==========================================
PROMPT_BASE = """
You are a highly sought-after luxury product marketer and elite AI visual editor.
YOUR CRITICAL OBJECTIVES:
1. ABSOLUTE ZERO-HALLUCINATION FIDELITY: Your absolute highest priority is preserving the EXACT text and logo on the product. You MUST NOT misspell any words, alter any letters (e.g., do not change an 'o' to an 'r' or an 'e' to a 'c'), or change the fonts. Every single micro-detail of the original product must remain 100% physically identical. Do NOT generate new text.
2. BRIGHTENED DARK-LUXURY BACKGROUND: Replace the raw background with an ultra-luxurious premium setting featuring elegant dark marble textures and warm golden ambient light (like a high-end designer boutique). HOWEVER, you must inject bright, clear spotlighting onto the product so the overall image is well-lit, vibrant, and NOT muddy or overly dark. The product itself must be brightly illuminated and pop perfectly against the luxurious background.
3. REALISTIC POSITIONING: Position the product beautifully. If displaying a T-shirt, carefully position it on an invisible, headless, and armless mannequin to give it realistic 3D volume.
"""

PROMPT_MULTI_SAME = PROMPT_BASE + """
4. MULTIPLE ANGLES FORMAT: The provided source image contains multiple photos of the SAME product arranged in a layout/grid. Enhance the overall grid into a premium multi-view marketing poster. Ensure all views match identically in color scheme, lighting, and environmental style.
"""

PROMPT_MULTI_DIFF = PROMPT_BASE + """
4. MULTIPLE PRODUCTS FORMAT: The provided source image contains a split-grid of DIFFERENT products. Enhance each product to perfection while blending them visually into one cohesive, realistic studio shot so they appear elegantly photographed side-by-side in high quality.
"""

# ==========================================
# BOT COMMANDS & INLINE KEYBOARD
# ==========================================
@bot.message_handler(commands=['start', 'help'])
@bot.message_handler(content_types=['text'])
def send_welcome(message):
    chat_id = message.chat.id
    USER_STATES[chat_id] = STATE_IDLE
    
    markup = InlineKeyboardMarkup()
    markup.row_width = 1
    markup.add(
        InlineKeyboardButton("1️⃣ One Product (Single Pic)", callback_data="opt_one_pic"),
        InlineKeyboardButton("2️⃣ Same Product (Multiple Angles)", callback_data="opt_multi_same"),
        InlineKeyboardButton("3️⃣ Multi Products (Split Pic)", callback_data="opt_multi_diff")
    )
    
    bot.send_message(
        chat_id, 
        "Hi I am your Sora editor please chose from the list down what you need exactly so I can help you:", 
        reply_markup=markup
    )

@bot.callback_query_handler(func=lambda call: True)
def callback_query(call):
    chat_id = call.message.chat.id
    
    if call.data == "opt_one_pic":
        USER_STATES[chat_id] = STATE_AWAITING_ONE_PIC
        bot.answer_callback_query(call.id)
        bot.send_message(chat_id, "Got it! Please upload the SINGLE photo of your product now.")
        
    elif call.data == "opt_multi_same":
        USER_STATES[chat_id] = STATE_AWAITING_MULTI_SAME
        bot.answer_callback_query(call.id)
        bot.send_message(chat_id, "Great! Please select and send multiple photos of the SAME product from DIFFERENT angles all at once.")
        
    elif call.data == "opt_multi_diff":
        USER_STATES[chat_id] = STATE_AWAITING_MULTI_DIFF
        bot.answer_callback_query(call.id)
        bot.send_message(chat_id, "Understood. Please select and send the photos of the DIFFERENT products all at once.")

# ==========================================
# PHOTO RECEIVER & TIMER
# ==========================================
@bot.message_handler(content_types=['photo'])
def handle_photo(message):
    chat_id = message.chat.id
    state = USER_STATES.get(chat_id, STATE_IDLE)
    
    if state == STATE_IDLE:
        bot.reply_to(message, "Please say 'hi' or use the /start command to choose an option first!")
        return
        
    # Get highest quality version of the photo
    file_id = message.photo[-1].file_id
    
    if chat_id not in MEDIA_COLLECTOR:
        MEDIA_COLLECTOR[chat_id] = []
        
    MEDIA_COLLECTOR[chat_id].append(file_id)
    
    # Reset the timer. Wires it up so that 3 seconds after the LAST photo arrives, we process the batch.
    if chat_id in MEDIA_TIMERS:
        MEDIA_TIMERS[chat_id].cancel()
        
    timer = threading.Timer(3.0, process_collected_photos, args=[chat_id, state])
    MEDIA_TIMERS[chat_id] = timer
    timer.start()

# ==========================================
# CORE PROCESSING LOGIC
# ==========================================
def process_collected_photos(chat_id, state):
    file_ids = MEDIA_COLLECTOR.get(chat_id, [])
    if not file_ids:
        return
        
    # Clear the collector to be ready for the next batch
    MEDIA_COLLECTOR[chat_id] = []
    
    bot.send_message(chat_id, f"Received {len(file_ids)} photo(s). Beginning download and enhancement...")
    logger.info(f"User {chat_id} triggered batch processing with {len(file_ids)} image(s) in state {state}")
    
    images = []
    for fid in file_ids:
        try:
            file_info = bot.get_file(fid)
            downloaded_file = bot.download_file(file_info.file_path)
            img = Image.open(BytesIO(downloaded_file))
            if img.mode != 'RGBA':
                img = img.convert('RGBA')
            images.append(img)
        except Exception as e:
            logger.error(f"Failed to download image {fid}: {e}")
            
    if not images:
        bot.send_message(chat_id, "Failed to download your photos correctly. Please try again.")
        return
        
    # Pick the right prompt based on state
    if state == STATE_AWAITING_MULTI_SAME:
        prompt = PROMPT_MULTI_SAME
    elif state == STATE_AWAITING_MULTI_DIFF:
        prompt = PROMPT_MULTI_DIFF
    else:
        prompt = PROMPT_BASE
        
    process_and_send_to_ai(chat_id, images, prompt)

def create_grid(images, target_size=512):
    """Takes a list of PIL Images, crops them square, and maps them to a grid."""
    if len(images) == 1:
        # Just crop the single image to square
        img = images[0]
        w, h = img.size
        min_dim = min(w, h)
        left = (w - min_dim) / 2
        top = (h - min_dim) / 2
        right = (w + min_dim) / 2
        bottom = (h + min_dim) / 2
        return img.crop((left, top, right, bottom)).resize((1024, 1024), Image.LANCZOS)
        
    cols = math.ceil(math.sqrt(len(images)))
    rows = math.ceil(len(images) / cols)
    
    processed_imgs = []
    for img in images:
        w, h = img.size
        min_dim = min(w, h)
        left = (w - min_dim) / 2
        top = (h - min_dim) / 2
        right = (w + min_dim) / 2
        bottom = (h + min_dim) / 2
        img_cropped = img.crop((left, top, right, bottom)).resize((target_size, target_size), Image.LANCZOS)
        processed_imgs.append(img_cropped)
        
    grid_w = cols * target_size
    grid_h = rows * target_size
    grid_img = Image.new('RGB', (grid_w, grid_h), color=(255, 255, 255))
    
    for i, img in enumerate(processed_imgs):
        row_idx = i // cols
        col_idx = i % cols
        grid_img.paste(img.convert('RGB'), (col_idx * target_size, row_idx * target_size))
        
    # Pad the overall grid to a perfect square to ensure API compatibility
    if grid_w != grid_h:
        max_dim = max(grid_w, grid_h)
        square_img = Image.new('RGB', (max_dim, max_dim), color=(255, 255, 255))
        square_img.paste(grid_img, ((max_dim - grid_w) // 2, (max_dim - grid_h) // 2))
        return square_img
    
    return grid_img

def process_and_send_to_ai(chat_id, images, prompt):
    try:
        # Merge physical images if more than 1
        final_img = create_grid(images)
        final_img = final_img.resize((1024, 1024), Image.LANCZOS)
        
        # Determine strict bytes limitation (usually under 4MB)
        bio = BytesIO()
        final_img.save(bio, format="PNG", optimize=True)
        bio.name = 'image.png'
        bio.seek(0)
        
        size_bytes = len(bio.getvalue())
        logger.info(f"Prepared final image for OpenAI. Base size: {size_bytes} bytes")
        
        if size_bytes > 4 * 1024 * 1024:
            logger.warning("Image too large! Compressing using JPEG...")
            bio = BytesIO()
            # converting solid RGBA transparent to white base before jpeg
            rgb_img = Image.new('RGB', final_img.size, (255, 255, 255))
            if final_img.mode == 'RGBA':
                rgb_img.paste(final_img, mask=final_img.split()[3]) 
            else:
                rgb_img = final_img
                
            rgb_img.save(bio, format="JPEG", quality=85)
            bio.name = 'image.jpg'
            bio.seek(0)
            logger.info(f"Compressed size: {len(bio.getvalue())} bytes")

        logger.info("Connecting to OpenAI Image Edit API...")
        
        # Using the specified model name from previous architecture
        result = client.images.edit(
            model="gpt-image-1",
            image=bio,
            prompt=prompt
        )
        
        logger.info("Successfully received generated image from OpenAI")
        image_base64 = result.data[0].b64_json
        image_bytes = base64.b64decode(image_base64)
        
        bot.send_photo(chat_id, photo=image_bytes, caption="✨ Here is your ultra-realistic product display!")
        
        # Reset State successfully
        USER_STATES[chat_id] = STATE_IDLE
        logger.info(f"Finished pipeline for user {chat_id}")
        bot.send_message(chat_id, "Say 'hi' or use /start to upscale another product!")
        
    except Exception as e:
        logger.error(f"Error during AI Processing: {str(e)}", exc_info=True)
        bot.send_message(chat_id, f"⚠️ An error occurred during processing:\n{str(e)}\n\nPlease try again.")
        USER_STATES[chat_id] = STATE_IDLE # reset on failure too

if __name__ == "__main__":
    logger.info("Initializing multi-image Telegram Agent...")
    print("Bot is up and listening to polling...")
    try:
        bot.infinity_polling(timeout=10, long_polling_timeout=5)
    except (KeyboardInterrupt, SystemExit):
        pass
