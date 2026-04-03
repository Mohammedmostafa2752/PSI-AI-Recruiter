import os
import time
from playwright.sync_api import sync_playwright

def test_dropdown():
    html_path = r"C:\Users\mohammed.mostafa\Anti Gravity\scoring card\index.html"
    file_url = f"file:///{html_path.replace(chr(92), '/')}"
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        print(f"Opening: {file_url}")
        page.goto(file_url)
        
        # Check initial state
        form_hidden = page.evaluate("document.getElementById('evaluationForm').classList.contains('hidden')")
        print(f"Is form hidden initially? {form_hidden}")
        
        # Select "Sales Agent"
        print("Selecting Sales Agent...")
        page.select_option("#agentType", "sales")
        
        # Wait a moment for JS to process, though it should be instant
        time.sleep(1)
        
        # Check if form is visible now
        form_hidden_after = page.evaluate("document.getElementById('evaluationForm').classList.contains('hidden')")
        print(f"Is form hidden after selection? {form_hidden_after}")
        
        # Check if dynamic section has content
        html_content = page.evaluate("document.getElementById('dynamicSection').innerHTML")
        print(f"Dynamic section length: {len(html_content)}")
        if len(html_content) > 10:
            print("Dynamic content injected successfully!")
        else:
            print("ERROR: Dynamic content was not injected.")
            
        # Check console logs for errors
        
        browser.close()

if __name__ == "__main__":
    try:
        test_dropdown()
    except Exception as e:
        print(f"Test failed: {e}")
