const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

/**
 * IntegrationsService – Drittanbieter-Integrationen
 *
 * Enthält:
 *  - Spotify (Playback-Kontrolle, Suche, Playlists)
 *  - Google Calendar (Termine lesen/erstellen)
 *  - GitHub (Repos, Issues, Actions, PRs)
 */
class IntegrationsService {
  constructor(config = {}) {
    this.apiKeys  = config.apiKeys || {};
    this.store    = config.store;
    this.dataDir  = config.dataDir || './integrations';

    // Spotify State
    this._spotifyToken = null;
    this._spotifyExpiry = 0;

    // Calendar State
    this._calendarAuth = null;
  }

  async initialize() {
    await fs.mkdir(this.dataDir, { recursive: true }).catch(() => {});
    console.log('[Integrations] Initialized');
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██ SPOTIFY ██
  // ═══════════════════════════════════════════════════════════════════
  async _spotifyAuth() {
    if (this._spotifyToken && Date.now() < this._spotifyExpiry) return this._spotifyToken;
    const clientId = this.apiKeys.spotifyClientId;
    const clientSecret = this.apiKeys.spotifyClientSecret;
    if (!clientId || !clientSecret) throw new Error('Spotify: clientId und clientSecret erforderlich');

    const res = await axios.post('https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      { headers: { 'Authorization': `Basic ${Buffer.from(clientId + ':' + clientSecret).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    this._spotifyToken = res.data.access_token;
    this._spotifyExpiry = Date.now() + (res.data.expires_in * 1000) - 60000;
    return this._spotifyToken;
  }

  async _spotifyApi(endpoint, method = 'GET', data = null, userToken = null) {
    const token = userToken || await this._spotifyAuth();
    const res = await axios({ method, url: `https://api.spotify.com/v1${endpoint}`,
      headers: { 'Authorization': `Bearer ${token}` }, data, timeout: 10000 });
    return res.data;
  }

  async spotifySearch(query, type = 'track', limit = 10) {
    const data = await this._spotifyApi(`/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`);
    if (type === 'track') return (data.tracks?.items || []).map(t => ({ name: t.name, artist: t.artists[0]?.name, album: t.album?.name, uri: t.uri, duration: t.duration_ms, preview: t.preview_url }));
    if (type === 'artist') return (data.artists?.items || []).map(a => ({ name: a.name, genres: a.genres, followers: a.followers?.total, uri: a.uri }));
    return data;
  }

  async spotifyPlay(uri, userToken) {
    if (!userToken) throw new Error('Spotify: User OAuth Token erforderlich für Playback-Kontrolle');
    return this._spotifyApi('/me/player/play', 'PUT', uri ? { uris: [uri] } : undefined, userToken);
  }

  async spotifyPause(userToken) { return this._spotifyApi('/me/player/pause', 'PUT', null, userToken); }
  async spotifyNext(userToken)  { return this._spotifyApi('/me/player/next', 'POST', null, userToken); }
  async spotifyPrev(userToken)  { return this._spotifyApi('/me/player/previous', 'POST', null, userToken); }

  async spotifyNowPlaying(userToken) {
    const data = await this._spotifyApi('/me/player/currently-playing', 'GET', null, userToken);
    if (!data || !data.item) return { playing: false };
    return { playing: data.is_playing, name: data.item.name, artist: data.item.artists[0]?.name, album: data.item.album?.name, progress: data.progress_ms, duration: data.item.duration_ms };
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██ GOOGLE CALENDAR ██
  // ═══════════════════════════════════════════════════════════════════
  async _calendarApi(endpoint, method = 'GET', data = null) {
    const token = this.apiKeys.googleCalendarToken;
    if (!token) throw new Error('Google Calendar: OAuth Access Token erforderlich');
    const res = await axios({ method, url: `https://www.googleapis.com/calendar/v3${endpoint}`,
      headers: { 'Authorization': `Bearer ${token}` }, data, timeout: 10000 });
    return res.data;
  }

  async calendarList() {
    const data = await this._calendarApi('/users/me/calendarList');
    return (data.items || []).map(c => ({ id: c.id, name: c.summary, primary: c.primary }));
  }

  async calendarEvents(calendarId = 'primary', days = 7) {
    const now = new Date().toISOString();
    const future = new Date(Date.now() + days * 86400000).toISOString();
    const data = await this._calendarApi(
      `/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${now}&timeMax=${future}&singleEvents=true&orderBy=startTime`
    );
    return (data.items || []).map(e => ({
      id: e.id, title: e.summary, description: e.description,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      location: e.location, attendees: (e.attendees || []).map(a => a.email)
    }));
  }

  async calendarCreateEvent(event, calendarId = 'primary') {
    return this._calendarApi(`/calendars/${encodeURIComponent(calendarId)}/events`, 'POST', {
      summary: event.title,
      description: event.description,
      start: { dateTime: event.start, timeZone: event.timeZone || 'Europe/Berlin' },
      end: { dateTime: event.end, timeZone: event.timeZone || 'Europe/Berlin' },
      location: event.location,
      attendees: (event.attendees || []).map(email => ({ email }))
    });
  }

  async calendarDeleteEvent(eventId, calendarId = 'primary') {
    return this._calendarApi(`/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, 'DELETE');
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██ GITHUB ██
  // ═══════════════════════════════════════════════════════════════════
  async _ghApi(endpoint, method = 'GET', data = null) {
    const token = this.apiKeys.github;
    if (!token) throw new Error('GitHub: Personal Access Token erforderlich');
    const res = await axios({ method, url: `https://api.github.com${endpoint}`,
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Johnny-AI' },
      data, timeout: 15000 });
    return res.data;
  }

  async ghListRepos(user = null) {
    const endpoint = user ? `/users/${user}/repos?per_page=30&sort=updated` : '/user/repos?per_page=30&sort=updated';
    const data = await this._ghApi(endpoint);
    return data.map(r => ({ name: r.full_name, description: r.description, stars: r.stargazers_count, language: r.language, url: r.html_url, updated: r.updated_at }));
  }

  async ghListIssues(repo, state = 'open') {
    const data = await this._ghApi(`/repos/${repo}/issues?state=${state}&per_page=20`);
    return data.map(i => ({ number: i.number, title: i.title, state: i.state, author: i.user?.login, labels: i.labels?.map(l => l.name), created: i.created_at, url: i.html_url }));
  }

  async ghCreateIssue(repo, title, body, labels = []) {
    return this._ghApi(`/repos/${repo}/issues`, 'POST', { title, body, labels });
  }

  async ghListPRs(repo, state = 'open') {
    const data = await this._ghApi(`/repos/${repo}/pulls?state=${state}&per_page=20`);
    return data.map(pr => ({ number: pr.number, title: pr.title, state: pr.state, author: pr.user?.login, branch: pr.head?.ref, created: pr.created_at, url: pr.html_url }));
  }

  async ghTriggerWorkflow(repo, workflowId, ref = 'main', inputs = {}) {
    return this._ghApi(`/repos/${repo}/actions/workflows/${workflowId}/dispatches`, 'POST', { ref, inputs });
  }

  async ghListWorkflows(repo) {
    const data = await this._ghApi(`/repos/${repo}/actions/workflows`);
    return (data.workflows || []).map(w => ({ id: w.id, name: w.name, state: w.state, path: w.path }));
  }

  async ghListRuns(repo, limit = 10) {
    const data = await this._ghApi(`/repos/${repo}/actions/runs?per_page=${limit}`);
    return (data.workflow_runs || []).map(r => ({ id: r.id, name: r.name, status: r.status, conclusion: r.conclusion, branch: r.head_branch, created: r.created_at, url: r.html_url }));
  }

  async ghGetNotifications() {
    const data = await this._ghApi('/notifications?per_page=20');
    return data.map(n => ({ id: n.id, reason: n.reason, title: n.subject?.title, type: n.subject?.type, repo: n.repository?.full_name, updated: n.updated_at }));
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██ STATUS ██
  // ═══════════════════════════════════════════════════════════════════
  getStatus() {
    return {
      spotify: !!(this.apiKeys.spotifyClientId && this.apiKeys.spotifyClientSecret),
      googleCalendar: !!this.apiKeys.googleCalendarToken,
      github: !!this.apiKeys.github,
      spotifyTokenValid: Date.now() < this._spotifyExpiry
    };
  }
}

module.exports = IntegrationsService;
