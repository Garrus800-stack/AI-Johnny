const axios = require('axios');
const { EventEmitter } = require('events');

/**
 * SmartHomeService – Smart-Home-Integration
 *
 * Unterstützt:
 *  - Home Assistant (REST API)
 *  - Philips Hue (lokale Bridge API)
 *  - MQTT (für Zigbee2MQTT, Tasmota, etc.)
 *  - Generische HTTP-Geräte
 */
class SmartHomeService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.homeAssistant = config.homeAssistant || null;  // { url, token }
    this.philipsHue    = config.philipsHue || null;     // { bridgeIp, username }
    this.mqtt          = config.mqtt || null;            // { url, username, password }
    this.devices       = new Map();
    this.mqttClient    = null;
  }

  async initialize() {
    // Home Assistant verbinden
    if (this.homeAssistant?.url && this.homeAssistant?.token) {
      try {
        await this._haFetch('/api/');
        console.log('[SmartHome] Home Assistant connected ✓');
        await this.syncDevices();
      } catch (e) {
        console.warn('[SmartHome] Home Assistant:', e.message);
      }
    }

    // Philips Hue verbinden
    if (this.philipsHue?.bridgeIp) {
      try {
        if (!this.philipsHue.username) {
          console.log('[SmartHome] Hue: Press bridge button, then call pairHueBridge()');
        } else {
          const lights = await this._hueFetch('/lights');
          console.log(`[SmartHome] Hue: ${Object.keys(lights).length} lights connected ✓`);
        }
      } catch (e) {
        console.warn('[SmartHome] Hue:', e.message);
      }
    }

    // MQTT verbinden
    if (this.mqtt?.url) {
      try {
        const mqtt = require('mqtt');
        this.mqttClient = mqtt.connect(this.mqtt.url, {
          username: this.mqtt.username, password: this.mqtt.password
        });
        this.mqttClient.on('connect', () => console.log('[SmartHome] MQTT connected ✓'));
        this.mqttClient.on('message', (topic, msg) => this._onMqttMessage(topic, msg));
        this.mqttClient.subscribe('#'); // Subscribe all
      } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
          console.warn('[SmartHome] MQTT-Paket fehlt. Installieren mit: npm install mqtt');
        } else {
          console.warn('[SmartHome] MQTT:', e.message);
        }
      }
    }

    console.log('[SmartHome] Initialized');
  }

  // ═══════ HOME ASSISTANT ═══════
  async _haFetch(endpoint, method = 'GET', data = null) {
    const res = await axios({
      method, url: `${this.homeAssistant.url}${endpoint}`,
      headers: { 'Authorization': `Bearer ${this.homeAssistant.token}`, 'Content-Type': 'application/json' },
      data, timeout: 10000
    });
    return res.data;
  }

  async syncDevices() {
    if (!this.homeAssistant?.url) return [];
    const states = await this._haFetch('/api/states');
    this.devices.clear();
    for (const entity of states) {
      this.devices.set(entity.entity_id, {
        id: entity.entity_id,
        name: entity.attributes?.friendly_name || entity.entity_id,
        state: entity.state,
        domain: entity.entity_id.split('.')[0],
        attributes: entity.attributes,
        source: 'homeassistant'
      });
    }
    return Array.from(this.devices.values());
  }

  async callService(domain, service, entityId, data = {}) {
    if (!this.homeAssistant?.url) throw new Error('Home Assistant not configured');
    return await this._haFetch(`/api/services/${domain}/${service}`, 'POST', {
      entity_id: entityId, ...data
    });
  }

  async turnOn(entityId, data = {})  { return this.callService(entityId.split('.')[0], 'turn_on', entityId, data); }
  async turnOff(entityId)             { return this.callService(entityId.split('.')[0], 'turn_off', entityId); }
  async toggle(entityId)              { return this.callService(entityId.split('.')[0], 'toggle', entityId); }

  async setLight(entityId, brightness, color = null) {
    const data = {};
    if (brightness !== undefined) data.brightness_pct = brightness;
    if (color) data.rgb_color = color;
    return this.callService('light', 'turn_on', entityId, data);
  }

  async setClimate(entityId, temperature, mode = null) {
    const data = { temperature };
    if (mode) data.hvac_mode = mode;
    return this.callService('climate', 'set_temperature', entityId, data);
  }

  async getEntityState(entityId) {
    if (!this.homeAssistant?.url) return null;
    return await this._haFetch(`/api/states/${entityId}`);
  }

  // ═══════ PHILIPS HUE ═══════
  async _hueFetch(endpoint, method = 'GET', data = null) {
    const res = await axios({ method, url: `http://${this.philipsHue.bridgeIp}/api/${this.philipsHue.username}${endpoint}`, data, timeout: 5000 });
    return res.data;
  }

  async pairHueBridge() {
    const res = await axios.post(`http://${this.philipsHue.bridgeIp}/api`, { devicetype: 'johnny-ai#assistant' });
    if (res.data[0]?.success?.username) {
      this.philipsHue.username = res.data[0].success.username;
      return { success: true, username: this.philipsHue.username };
    }
    return { success: false, error: res.data[0]?.error?.description || 'Press bridge button first' };
  }

  async getHueLights() {
    const lights = await this._hueFetch('/lights');
    return Object.entries(lights).map(([id, light]) => ({ id, name: light.name, on: light.state.on, brightness: light.state.bri, reachable: light.state.reachable }));
  }

  async setHueLight(lightId, on, brightness = null, hue = null, sat = null) {
    const state = { on };
    if (brightness !== null) state.bri = Math.round(brightness * 2.54); // 0-100 → 0-254
    if (hue !== null) state.hue = hue;
    if (sat !== null) state.sat = sat;
    return await this._hueFetch(`/lights/${lightId}/state`, 'PUT', state);
  }

  // ═══════ MQTT ═══════
  _onMqttMessage(topic, message) {
    try {
      const payload = JSON.parse(message.toString());
      this.emit('mqtt', { topic, payload });
    } catch (_) {
      this.emit('mqtt', { topic, payload: message.toString() });
    }
  }

  async mqttPublish(topic, payload) {
    if (!this.mqttClient) throw new Error('MQTT not connected');
    return new Promise((resolve, reject) => {
      this.mqttClient.publish(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), (err) => {
        err ? reject(err) : resolve({ success: true });
      });
    });
  }

  // ═══════ GENERISCH ═══════
  getDevices(domain = null) {
    const all = Array.from(this.devices.values());
    if (domain) return all.filter(d => d.domain === domain);
    return all;
  }

  async executeScene(sceneName) {
    return this.callService('scene', 'turn_on', `scene.${sceneName}`);
  }

  getStatus() {
    return {
      homeAssistant: !!this.homeAssistant?.url,
      philipsHue: !!this.philipsHue?.username,
      mqtt: !!this.mqttClient,
      deviceCount: this.devices.size
    };
  }
}

module.exports = SmartHomeService;
