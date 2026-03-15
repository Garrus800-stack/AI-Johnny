const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

/**
 * BrowserAutomationService - Vollständige Browser-Kontrolle
 * 
 * Features:
 * - Web Scraping
 * - Form Filling
 * - Button Clicking
 * - Screenshot Capture
 * - PDF Generation
 * - Cookie Management
 * - Authentication
 */
class BrowserAutomationService {
  constructor(config) {
    this.screenshotsDir = config.screenshotsDir;
    this.browser = null;
    this.pages = new Map();
  }

  async initialize() {
    console.log('Initializing Browser Automation Service...');
    await fs.mkdir(this.screenshotsDir, { recursive: true });
    
    // Starte Browser
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });
    
    console.log('Browser Automation Service initialized');
  }

  async navigateAndCapture(url) {
    const page = await this.browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    try {
      console.log(`Navigating to: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Screenshot
      const screenshotPath = path.join(
        this.screenshotsDir, 
        `screenshot-${Date.now()}.png`
      );
      await page.screenshot({ 
        path: screenshotPath,
        fullPage: true 
      });
      
      // HTML Content
      const html = await page.content();
      const title = await page.title();
      
      // Text Content
      const text = await page.evaluate(() => document.body.innerText);
      
      return {
        url,
        title,
        html,
        text,
        screenshot: screenshotPath,
        screenshotPath: screenshotPath,
        success: true
      };
    } finally {
      await page.close();
    }
  }

  async clickElement(url, selector, options = {}) {
    const page = await this.browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      // Warte auf Element
      await page.waitForSelector(selector, { timeout: 10000 });
      
      // Screenshot vorher
      const beforePath = path.join(
        this.screenshotsDir,
        `before-click-${Date.now()}.png`
      );
      await page.screenshot({ path: beforePath });
      
      // Click
      await page.click(selector);
      
      // Warte auf Navigation falls nötig
      if (options.waitForNavigation) {
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
      } else {
        await new Promise(r => setTimeout(r, 1000));
      }
      
      // Screenshot nachher
      const afterPath = path.join(
        this.screenshotsDir,
        `after-click-${Date.now()}.png`
      );
      await page.screenshot({ path: afterPath });
      
      return {
        success: true,
        beforeScreenshot: beforePath,
        afterScreenshot: afterPath,
        currentUrl: page.url()
      };
    } finally {
      await page.close();
    }
  }

  async fillForm(url, formData) {
    const page = await this.browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      // Fülle Felder
      for (const [selector, value] of Object.entries(formData)) {
        await page.waitForSelector(selector);
        await page.type(selector, value);
      }
      
      // Screenshot nach Füllung
      const screenshotPath = path.join(
        this.screenshotsDir,
        `form-filled-${Date.now()}.png`
      );
      await page.screenshot({ path: screenshotPath });
      
      return {
        success: true,
        screenshot: screenshotPath,
        message: 'Form filled successfully'
      };
    } finally {
      await page.close();
    }
  }

  async submitForm(url, formData, submitSelector) {
    const page = await this.browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      // Fülle Formular
      for (const [selector, value] of Object.entries(formData)) {
        await page.waitForSelector(selector);
        await page.type(selector, value);
      }
      
      // Submit
      await page.click(submitSelector);
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      
      // Screenshot nach Submit
      const screenshotPath = path.join(
        this.screenshotsDir,
        `form-submitted-${Date.now()}.png`
      );
      await page.screenshot({ path: screenshotPath });
      
      return {
        success: true,
        screenshot: screenshotPath,
        resultUrl: page.url(),
        resultText: await page.evaluate(() => document.body.innerText)
      };
    } finally {
      await page.close();
    }
  }

  async extractData(url, selectors) {
    const page = await this.browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      const data = {};
      
      for (const [key, selector] of Object.entries(selectors)) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          data[key] = await page.$eval(selector, el => el.textContent.trim());
        } catch (error) {
          data[key] = null;
        }
      }
      
      return {
        success: true,
        data,
        url
      };
    } finally {
      await page.close();
    }
  }

  async executeScript(url, script) {
    const page = await this.browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      const result = await page.evaluate(script);
      
      return {
        success: true,
        result
      };
    } finally {
      await page.close();
    }
  }

  async loginToSite(url, credentials) {
    const page = await this.browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      // Generische Login-Versuche
      const usernameSelectors = [
        'input[type="email"]',
        'input[name="username"]',
        'input[name="email"]',
        '#username',
        '#email'
      ];
      
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        '#password'
      ];
      
      // Versuche Username zu finden und auszufüllen
      for (const selector of usernameSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 2000 });
          await page.type(selector, credentials.username);
          break;
        } catch (e) {
          continue;
        }
      }
      
      // Versuche Password zu finden und auszufüllen
      for (const selector of passwordSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 2000 });
          await page.type(selector, credentials.password);
          break;
        } catch (e) {
          continue;
        }
      }
      
      // Submit
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:contains("Login")',
        'button:contains("Sign in")'
      ];
      
      for (const selector of submitSelectors) {
        try {
          await page.click(selector);
          break;
        } catch (e) {
          continue;
        }
      }
      
      // Warte auf Navigation
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      
      // Screenshot
      const screenshotPath = path.join(
        this.screenshotsDir,
        `login-result-${Date.now()}.png`
      );
      await page.screenshot({ path: screenshotPath });
      
      // Speichere Cookies
      const cookies = await page.cookies();
      
      return {
        success: true,
        screenshot: screenshotPath,
        url: page.url(),
        cookies
      };
    } finally {
      await page.close();
    }
  }

  async generatePDF(url, outputPath) {
    const page = await this.browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true
      });
      
      return {
        success: true,
        pdfPath: outputPath
      };
    } finally {
      await page.close();
    }
  }

  async monitorChanges(url, selector, intervalSeconds = 60) {
    const page = await this.browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    let previousContent = await page.$eval(selector, el => el.textContent);
    
    const monitor = setInterval(async () => {
      await page.reload({ waitUntil: 'networkidle2' });
      const currentContent = await page.$eval(selector, el => el.textContent);
      
      if (currentContent !== previousContent) {
        console.log('Change detected!');
        console.log('Previous:', previousContent);
        console.log('Current:', currentContent);
        
        // Screenshot
        const screenshotPath = path.join(
          this.screenshotsDir,
          `change-detected-${Date.now()}.png`
        );
        await page.screenshot({ path: screenshotPath });
        
        previousContent = currentContent;
        
        // Event emittieren oder Callback
        return {
          changed: true,
          previous: previousContent,
          current: currentContent,
          screenshot: screenshotPath
        };
      }
    }, intervalSeconds * 1000);
    
    return {
      success: true,
      monitorId: monitor,
      message: `Monitoring ${url} every ${intervalSeconds}s`
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = BrowserAutomationService;
