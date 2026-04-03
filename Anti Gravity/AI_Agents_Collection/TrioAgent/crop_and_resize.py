import sys
from PIL import Image

try:
    img = Image.open('icon.png')
    
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
        
    width, height = img.size
    
    # The logo in the previous generation was centered, with text "TRIO" below.
    # We will grab the square block containing the actual emblem in the middle.
    # These ratios map to standard DALL-E/Imagen app-icon-on-white framing.
    left = int(width * 0.20)
    top = int(height * 0.16)
    right = int(width * 0.80)
    bottom = int(height * 0.76)
    
    img_cropped = img.crop((left, top, right, bottom))
    
    # Save the explicitly sized Chrome variants from the pure logo crop
    img_128 = img_cropped.resize((128, 128), Image.Resampling.LANCZOS)
    img_128.save('icon_128.png', 'PNG')
    
    img_48 = img_cropped.resize((48, 48), Image.Resampling.LANCZOS)
    img_48.save('icon_48.png', 'PNG')
    
    img_16 = img_cropped.resize((16, 16), Image.Resampling.LANCZOS)
    img_16.save('icon_16.png', 'PNG')
    
    print("Cropped and resized successfully.")
except Exception as e:
    print(f"Error: {e}")
