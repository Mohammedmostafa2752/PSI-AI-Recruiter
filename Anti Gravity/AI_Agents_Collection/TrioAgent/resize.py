import sys
from PIL import Image

try:
    img = Image.open('icon.png')
    
    # Convert to standard RGBA if necessary
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
        
    img_128 = img.resize((128, 128), Image.Resampling.LANCZOS)
    img_128.save('icon_128.png', 'PNG')
    
    img_48 = img.resize((48, 48), Image.Resampling.LANCZOS)
    img_48.save('icon_48.png', 'PNG')
    
    img_16 = img.resize((16, 16), Image.Resampling.LANCZOS)
    img_16.save('icon_16.png', 'PNG')
    
    print("Resized successfully.")
except Exception as e:
    print(f"Error resizing image: {e}")
