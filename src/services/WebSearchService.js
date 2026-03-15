const axios = require('axios');
const cheerio = require('cheerio');

/**
 * WebSearchService - Recherche-Fähigkeiten
 * 
 * Unterstützt:
 * - Google Search API
 * - Bing Search API
 * - DuckDuckGo (scraping)
 * - Serper API
 * - SerpAPI
 */
class WebSearchService {
  constructor(config) {
    this.apiKeys = config.apiKeys || {};
    this.defaultEngine = config.defaultEngine || 'duckduckgo';
  }

  async search(query, options = {}) {
    const engine = options.engine || this.defaultEngine;
    const limit = options.limit || 10;
    
    console.log(`Searching with ${engine}: ${query}`);
    
    switch (engine) {
      case 'google':
        return await this.searchGoogle(query, limit, options);
      case 'bing':
        return await this.searchBing(query, limit, options);
      case 'duckduckgo':
        return await this.searchDuckDuckGo(query, limit, options);
      case 'serper':
        return await this.searchSerper(query, limit, options);
      case 'serpapi':
        return await this.searchSerpAPI(query, limit, options);
      default:
        throw new Error(`Unknown search engine: ${engine}`);
    }
  }

  async searchGoogle(query, limit, options = {}) {
    const apiKey = this.apiKeys.googleSearch || options.apiKey;
    const cx = this.apiKeys.googleSearchCx || options.cx;
    
    if (!apiKey || !cx) {
      throw new Error('Google Search API key or CX not configured');
    }

    try {
      const response = await axios.get(
        'https://www.googleapis.com/customsearch/v1',
        {
          params: {
            key: apiKey,
            cx: cx,
            q: query,
            num: Math.min(limit, 10)
          }
        }
      );

      const results = response.data.items?.map(item => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        displayLink: item.displayLink
      })) || [];

      return {
        success: true,
        engine: 'google',
        query,
        results,
        totalResults: response.data.searchInformation?.totalResults
      };
    } catch (error) {
      console.error('Google Search error:', error);
      throw error;
    }
  }

  async searchBing(query, limit, options = {}) {
    const apiKey = this.apiKeys.bing || options.apiKey;
    
    if (!apiKey) {
      throw new Error('Bing Search API key not configured');
    }

    try {
      const response = await axios.get(
        'https://api.bing.microsoft.com/v7.0/search',
        {
          params: {
            q: query,
            count: limit
          },
          headers: {
            'Ocp-Apim-Subscription-Key': apiKey
          }
        }
      );

      const results = response.data.webPages?.value?.map(item => ({
        title: item.name,
        url: item.url,
        snippet: item.snippet,
        displayUrl: item.displayUrl
      })) || [];

      return {
        success: true,
        engine: 'bing',
        query,
        results,
        totalResults: response.data.webPages?.totalEstimatedMatches
      };
    } catch (error) {
      console.error('Bing Search error:', error);
      throw error;
    }
  }

  async searchDuckDuckGo(query, limit, options = {}) {
    try {
      // DuckDuckGo HTML Scraping (keine API nötig)
      const response = await axios.get(
        'https://html.duckduckgo.com/html/',
        {
          params: { q: query },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      const $ = cheerio.load(response.data);
      const results = [];

      $('.result').slice(0, limit).each((i, elem) => {
        const $elem = $(elem);
        const title = $elem.find('.result__title').text().trim();
        const url = $elem.find('.result__url').attr('href');
        const snippet = $elem.find('.result__snippet').text().trim();

        if (title && url) {
          results.push({
            title,
            url: url.startsWith('//') ? 'https:' + url : url,
            snippet
          });
        }
      });

      return {
        success: true,
        engine: 'duckduckgo',
        query,
        results
      };
    } catch (error) {
      console.error('DuckDuckGo Search error:', error);
      throw error;
    }
  }

  async searchSerper(query, limit, options = {}) {
    const apiKey = this.apiKeys.serper || options.apiKey;
    
    if (!apiKey) {
      throw new Error('Serper API key not configured');
    }

    try {
      const response = await axios.post(
        'https://google.serper.dev/search',
        {
          q: query,
          num: limit
        },
        {
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      const results = response.data.organic?.map(item => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        position: item.position
      })) || [];

      return {
        success: true,
        engine: 'serper',
        query,
        results,
        searchParameters: response.data.searchParameters
      };
    } catch (error) {
      console.error('Serper Search error:', error);
      throw error;
    }
  }

  async searchSerpAPI(query, limit, options = {}) {
    const apiKey = this.apiKeys.serpapi || options.apiKey;
    
    if (!apiKey) {
      throw new Error('SerpAPI key not configured');
    }

    try {
      const response = await axios.get(
        'https://serpapi.com/search',
        {
          params: {
            q: query,
            api_key: apiKey,
            num: limit
          }
        }
      );

      const results = response.data.organic_results?.map(item => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        position: item.position
      })) || [];

      return {
        success: true,
        engine: 'serpapi',
        query,
        results
      };
    } catch (error) {
      console.error('SerpAPI Search error:', error);
      throw error;
    }
  }

  // Fetch full page content
  async fetchPage(url) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      
      // Entferne Scripts und Styles
      $('script, style').remove();
      
      const title = $('title').text();
      const text = $('body').text().replace(/\s+/g, ' ').trim();
      
      return {
        success: true,
        url,
        title,
        text: text.substring(0, 10000), // Erste 10k chars
        html: response.data
      };
    } catch (error) {
      console.error(`Error fetching ${url}:`, error.message);
      return {
        success: false,
        url,
        error: error.message
      };
    }
  }

  // Research Assistant
  async research(topic, depth = 3) {
    console.log(`Researching: ${topic} (depth: ${depth})`);
    
    const searchResults = await this.search(topic, { limit: depth * 3 });
    const research = [];
    
    // Fetch top results
    for (const result of searchResults.results.slice(0, depth)) {
      const page = await this.fetchPage(result.url);
      if (page.success) {
        research.push({
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          content: page.text.substring(0, 2000) // Erste 2k chars
        });
      }
    }
    
    return {
      success: true,
      topic,
      searchResults: searchResults.results,
      detailedResearch: research,
      summary: this.generateSummary(research)
    };
  }

  generateSummary(research) {
    if (research.length === 0) return 'No research data available';
    
    const titles = research.map(r => r.title).join('; ');
    const snippets = research.map(r => r.snippet).join(' ');
    
    return {
      sources: research.length,
      titles: titles.substring(0, 200),
      overview: snippets.substring(0, 500)
    };
  }

  // Multi-Query Research
  async multiQuery(queries) {
    const results = [];
    
    for (const query of queries) {
      const searchResult = await this.search(query, { limit: 5 });
      results.push({
        query,
        results: searchResult.results
      });
    }
    
    return {
      success: true,
      queries: queries.length,
      results
    };
  }
}

module.exports = WebSearchService;
